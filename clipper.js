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

  const models = ['gemini-2.5-flash', 'gemini-flash-latest'];
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
      );
      const json = await res.json();
      if (json.candidates && json.candidates[0]) {
        let raw = json.candidates[0].content.parts[0].text.trim();
        const awal = raw.indexOf('{');
        const akhir = raw.lastIndexOf('}');
        if (awal !== -1 && akhir !== -1) raw = raw.slice(awal, akhir + 1);
        return JSON.parse(raw);
      }
    } catch (e) {
      console.log(`Gagal model ${model}:`, e.message);
    }
  }
  throw new Error('Gemini gagal menganalisis transkrip.');
}

async function main() {
  if (!VIDEO_URL) throw new Error('Link video kosong!');
  await kirimPesan(`✂️ AI Clipper mulai bekerja!\n🔗 Link: ${VIDEO_URL}\n\n1/3 Mengambil transkrip & video...`);

  // Siapkan opsi anti-blokir YouTube (pakai Node.js runtime + player_client android/web + cookies jika ada)
  let opsiYtDlp = `--js-runtimes node --extractor-args "youtube:player_client=android,web"`;
  if (YOUTUBE_COOKIES) {
    fs.writeFileSync('cookies.txt', YOUTUBE_COOKIES, 'utf8');
    opsiYtDlp += ` --cookies cookies.txt`;
  }

  // Unduh subtitle otomatis (id/en) tanpa video dulu
  execSync(`yt-dlp ${opsiYtDlp} --write-auto-subs --write-subs --sub-lang "id,en" --skip-download -o "sub" "${VIDEO_URL}"`, { stdio: 'inherit' });

  const fileSub = fs.readdirSync('.').find(f => f.startsWith('sub.') && f.endsWith('.vtt'));
  if (!fileSub) {
    throw new Error('Video ini tidak memiliki subtitle/CC otomatis sehingga AI tidak bisa membaca isi pembicaraannya.');
  }

  const transkrip = bersihkanSubtitleVTT(fs.readFileSync(fileSub, 'utf8'));
  await kirimPesan('2/3 Gemini AI sedang mencari momen paling viral...');

  const momen = await cariMomenViral(transkrip);
  await kirimPesan(`🔥 Momen ditemukan!\n⏱️ ${momen.start} - ${momen.end}\n📌 ${momen.judul}\n💡 ${momen.alasan}\n\n3/3 Memotong & mengubah ke format 9:16...`);

  // Unduh video kualitas terbaik maksimal 720p/1080p mp4
  execSync(`yt-dlp ${opsiYtDlp} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "sumber.mp4" "${VIDEO_URL}"`, { stdio: 'inherit' });

  // Potong & crop tengah ke 9:16 (1080x1920)
  execSync(`ffmpeg -y -ss ${momen.start} -to ${momen.end} -i sumber.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" -c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 128k -movflags +faststart clip_jadi.mp4`, { stdio: 'inherit' });

  const caption = `✂️ KLIP VIRAL SIAP!\n\n📌 ${momen.judul}\n⏱️ Segmen: ${momen.start} - ${momen.end}\n💡 Alasan: ${momen.alasan}`;
  await kirimVideo('clip_jadi.mp4', caption);
  console.log('Selesai! Klip berhasil dikirim.');
}

main().catch(async err => {
  console.error(err);
  await kirimPesan('⚠️ AI Clipper gagal: ' + err.message);
  process.exit(1);
});
