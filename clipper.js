const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GEMINI_API_KEY   = (process.env.GEMINI_API_KEY || '').trim();
const TELEGRAM_TOKEN   = (process.env.TELEGRAM_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const VIDEO_URL        = (process.env.INPUT_URL || '').trim();
const YOUTUBE_COOKIES  = (process.env.YOUTUBE_COOKIES || '').trim();

async function kirimPesan(teks) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: teks.slice(0, 4000) })
    });
  } catch (e) {
    console.log('Gagal kirim pesan:', e.message);
  }
}

async function kirimVideo(filePath, caption) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendVideo`;
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(filePath)], { type: 'video/mp4' });
  form.append('chat_id', TELEGRAM_CHAT_ID);
  form.append('video', blob, path.basename(filePath));
  form.append('caption', caption.slice(0, 1000));
  form.append('supports_streaming', 'true');

  const res = await fetch(url, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.ok) throw new Error('Gagal kirim video: ' + JSON.stringify(json));
}

function bersihkanSubtitleVTT(vttText) {
  const lines = vttText.split('\n');
  const hasil = [];
  let waktuAktif = '';
  let teksSebelumnya = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:')) continue;
    if (line.includes('-->')) {
      waktuAktif = line.split('-->')[0].trim().split('.')[0];
      continue;
    }
    const bersih = line.replace(/<[^>]+>/g, '').trim();
    if (bersih && bersih !== teksSebelumnya) {
      hasil.push(`[${waktuAktif}] ${bersih}`);
      teksSebelumnya = bersih;
    }
  }
  return hasil.join('\n').slice(0, 28000);
}

async function cariMomenViral(transkrip) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY kosong! Periksa GitHub Secrets.');
  }

  const prompt = `Kamu adalah editor video viral TikTok/Shorts profesional.
Baca transkrip video ber-timestamp di bawah ini, lalu pilih SATU momen paling menarik, emosional, lucu, atau bikin penasaran dengan durasi antara 30 sampai 55 detik.

ATURAN:
- "start" dan "end" wajib format "HH:MM:SS" sesuai timestamp transkrip.
- Pastikan selisih waktu end dikurangi start adalah 30-55 detik.
- Keluarkan HANYA JSON murni tanpa teks tambahan:
{
  "start": "00:01:15",
  "end": "00:01:58",
  "judul": "Judul Hook Viral #Shorts",
  "alasan": "Alasan singkat kenapa momen ini berpotensi viral"
}

TRANSKRIP:
${transkrip}`;

  const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
  let errorTerakhir = '';

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        }
      );
      const json = await res.json();
      if (json.candidates && json.candidates[0]) {
        let raw = json.candidates[0].content.parts[0].text.trim();
        const awal = raw.indexOf('{');
        const akhir = raw.lastIndexOf('}');
        if (awal !== -1 && akhir !== -1) raw = raw.slice(awal, akhir + 1);
        return JSON.parse(raw);
      } else {
        errorTerakhir = json.error ? json.error.message : JSON.stringify(json);
        console.log(`Respon API ${model}:`, errorTerakhir);
      }
    } catch (e) {
      errorTerakhir = e.message;
      console.log(`Gagal model ${model}:`, e.message);
    }
  }
  throw new Error(`Gemini gagal menganalisis transkrip (${errorTerakhir})`);
}

async function main() {
  if (!VIDEO_URL) throw new Error('Link video kosong!');
  await kirimPesan(`✂️ AI Clipper mulai bekerja!\n🔗 Link: ${VIDEO_URL}\n\n1/3 Mengambil transkrip & video...`);

  // Siapkan opsi anti-blokir YouTube (pakai Node.js runtime + remote challenge solver + cookies jika ada)
  let opsiYtDlp = `--js-runtimes node --remote-components ejs:github`;
  if (YOUTUBE_COOKIES) {
    fs.writeFileSync('cookies.txt', YOUTUBE_COOKIES, 'utf8');
    opsiYtDlp += ` --cookies cookies.txt`;
  }

  // Unduh subtitle satu per satu dengan jeda untuk menghindari HTTP Error 429 (Too Many Requests)
  for (const lang of ['id', 'en']) {
    try {
      execSync(`yt-dlp ${opsiYtDlp} --ignore-no-formats-error --sleep-subtitles 5 --write-auto-subs --write-subs --sub-lang "${lang}" --skip-download -o "sub" "${VIDEO_URL}"`, { stdio: 'inherit' });
    } catch (e) {
      console.log(`Subtitle bahasa '${lang}' dilewati/limit:`, e.message);
    }
    const cekSub = fs.readdirSync('.').find(f => f.startsWith('sub.') && f.endsWith('.vtt'));
    if (cekSub) break;
  }

  // Prioritaskan subtitle Bahasa Indonesia (sub.id.vtt) jika ada, kalau tidak ambil yang tersedia
  const daftarSub = fs.readdirSync('.').filter(f => f.startsWith('sub.') && f.endsWith('.vtt'));
  const fileSub = daftarSub.find(f => f.includes('.id.')) || daftarSub[0];
  if (!fileSub) {
    throw new Error('Video ini tidak memiliki subtitle/CC otomatis atau terkena limit YouTube (429). Coba video lain atau tunggu beberapa menit.');
  }

  const transkrip = bersihkanSubtitleVTT(fs.readFileSync(fileSub, 'utf8'));
  await kirimPesan('2/3 Gemini AI sedang mencari momen paling viral...');

  const momen = await cariMomenViral(transkrip);
  await kirimPesan(`🔥 Momen ditemukan!\n⏱️ ${momen.start} - ${momen.end}\n📌 ${momen.judul}\n💡 ${momen.alasan}\n\n3/3 Memotong, menempel subtitle & mengubah ke format 9:16...`);

  // Unduh video kualitas terbaik maksimal 720p/1080p mp4
  execSync(`yt-dlp ${opsiYtDlp} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "sumber.mp4" "${VIDEO_URL}"`, { stdio: 'inherit' });

  // Konversi VTT ke SRT dan potong segmen waktunya agar pas dengan clip_jadi.mp4
  execSync(`ffmpeg -y -ss ${momen.start} -to ${momen.end} -i "${fileSub}" sub_klip.srt`, { stdio: 'inherit' });

  // Potong, crop tengah ke 9:16 (1080x1920), dan tempel subtitle bergaya Shorts/TikTok
  const gayaSub = "FontName=DejaVu Sans,FontSize=16,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=55";
  execSync(`ffmpeg -y -ss ${momen.start} -to ${momen.end} -i sumber.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920,subtitles=sub_klip.srt:force_style='${gayaSub}'" -c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 128k -movflags +faststart clip_jadi.mp4`, { stdio: 'inherit' });

  const caption = `✂️ KLIP VIRAL SIAP!\n\n📌 ${momen.judul}\n⏱️ Segmen: ${momen.start} - ${momen.end}\n💡 Alasan: ${momen.alasan}`;
  await kirimVideo('clip_jadi.mp4', caption);
  console.log('Selesai! Klip berhasil dikirim.');
}

main().catch(async err => {
  console.error(err);
  await kirimPesan('⚠️ AI Clipper gagal: ' + err.message);
  process.exit(1);
});
