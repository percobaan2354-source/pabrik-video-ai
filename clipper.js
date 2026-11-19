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

function waktuKeDetik(ts) {
  const bersih = ts.trim().split(' ')[0].replace(',', '.');
  const bagian = bersih.split(':');
  if (bagian.length === 3) {
    return parseInt(bagian[0], 10) * 3600 + parseInt(bagian[1], 10) * 60 + parseFloat(bagian[2]);
  }
  if (bagian.length === 2) {
    return parseInt(bagian[0], 10) * 60 + parseFloat(bagian[1]);
  }
  return parseFloat(bagian[0]) || 0;
}

function detikKeAss(totalDetik) {
  const d = Math.max(0, totalDetik);
  const jam = Math.floor(d / 3600);
  const menit = Math.floor((d % 3600) / 60);
  const detik = Math.floor(d % 60);
  const centi = Math.floor((d - Math.floor(d)) * 100);
  return `${jam}:${String(menit).padStart(2, '0')}:${String(detik).padStart(2, '0')}.${String(centi).padStart(2, '0')}`;
}

function buatSubtitleASSDariVTT(vttPath, assPath, startClipStr, endClipStr) {
  const startClip = waktuKeDetik(startClipStr);
  const endClip = waktuKeDetik(endClipStr);
  const durasiClip = endClip - startClip;

  const rawVtt = fs.readFileSync(vttPath, 'utf8').replace(/\r/g, '');
  const blokVtt = rawVtt.split('\n\n').map(b => b.trim()).filter(Boolean);

  // Ekstrak seluruh kata beserta timestamp persisnya dari VTT YouTube
  const daftarKataGlobal = [];
  let teksBlokSebelumnya = '';

  for (const blok of blokVtt) {
    const baris = blok.split('\n');
    const idxWaktu = baris.findIndex(l => l.includes('-->'));
    if (idxWaktu === -1) continue;

    const [mulaiStr, selesaiStr] = baris[idxWaktu].split('-->');
    const blokMulai = waktuKeDetik(mulaiStr);
    const blokSelesai = waktuKeDetik(selesaiStr);

    // Abaikan cue rolling transisi super pendek (< 0.12 detik) yang merupakan duplikat tampilan VTT YouTube
    if (blokSelesai - blokMulai < 0.12) continue;

    // Ambil baris teks utama (pada VTT auto-caption YouTube, baris terakhir di cue adalah baris baru yang sedang diucapkan)
    const barisTeks = baris.slice(idxWaktu + 1).filter(l => l.trim());
    if (barisTeks.length === 0) continue;

    const barisAktif = barisTeks[barisTeks.length - 1];
    const teksPolos = barisAktif.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!teksPolos || teksPolos === teksBlokSebelumnya) continue;
    teksBlokSebelumnya = teksPolos;

    // Cek apakah VTT memiliki timestamp per kata: contoh "kata1<00:01:12.340><c> kata2</c>"
    const regexTagWaktu = /<(\d{2}:\d{2}:\d{2}\.\d{3})>/g;
    if (regexTagWaktu.test(barisAktif)) {
      const token = barisAktif.split(/(<\d{2}:\d{2}:\d{2}\.\d{3}>)/g);
      let waktuKataSaatIni = blokMulai;

      for (const bagian of token) {
        const cocokWaktu = bagian.match(/^<(\d{2}:\d{2}:\d{2}\.\d{3})>$/);
        if (cocokWaktu) {
          waktuKataSaatIni = waktuKeDetik(cocokWaktu[1]);
        } else {
          const bersih = bagian.replace(/<[^>]+>/g, '').trim();
          if (bersih) {
            for (const w of bersih.split(/\s+/)) {
              daftarKataGlobal.push({ kata: w, start: waktuKataSaatIni, end: blokSelesai });
            }
          }
        }
      }
    } else {
      // Fallback jika VTT tidak memiliki tag waktu per kata: bagi waktu sesuai bobot jumlah karakter
      const kataKata = teksPolos.split(/\s+/);
      const totalHuruf = kataKata.reduce((acc, k) => acc + k.length, 0) || 1;
      let kursorWaktu = blokMulai;

      for (const w of kataKata) {
        const porsiDurasi = ((w.length / totalHuruf) * (blokSelesai - blokMulai));
        daftarKataGlobal.push({
          kata: w,
          start: kursorWaktu,
          end: kursorWaktu + porsiDurasi
        });
        kursorWaktu += porsiDurasi;
      }
    }
  }

  // Rapikan waktu selesai tiap kata agar menyambung ke kata berikutnya tanpa tumpang tindih atau terlalu cepat hilang
  for (let i = 0; i < daftarKataGlobal.length - 1; i++) {
    const nextStart = daftarKataGlobal[i + 1].start;
    if (nextStart > daftarKataGlobal[i].start) {
      daftarKataGlobal[i].end = Math.min(nextStart, daftarKataGlobal[i].start + 1.5);
    }
  }

  // Filter hanya kata yang masuk di dalam rentang klip [startClip, endClip] dan geser waktunya ke 00:00
  const kataDalamKlip = daftarKataGlobal
    .filter(item => item.end > startClip && item.start < endClip)
    .map(item => ({
      kata: item.kata,
      start: Math.max(0, item.start - startClip),
      end: Math.min(durasiClip, item.end - startClip)
    }))
    .filter(item => item.end > item.start + 0.02);

  // Kelompokkan menjadi 3-4 kata per baris tampilan dengan waktu mulai dari kata pertama hingga kata terakhir di grup
  const grupBaris = [];
  let tampung = [];

  for (let i = 0; i < kataDalamKlip.length; i++) {
    const item = kataDalamKlip[i];
    const jedaAntarKata = tampung.length > 0 ? item.start - tampung[tampung.length - 1].end : 0;

    // Pecah baris baru jika jeda bicara > 0.45 detik, sudah 4 kata, atau > 22 huruf
    const teksSementara = [...tampung.map(x => x.kata), item.kata].join(' ');
    if (tampung.length > 0 && (jedaAntarKata > 0.45 || tampung.length >= 4 || teksSementara.length > 22)) {
      grupBaris.push(tampung);
      tampung = [];
    }
    tampung.push(item);
  }
  if (tampung.length > 0) grupBaris.push(tampung);

  const headerAss = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ViralSub,DejaVu Sans,64,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,80,80,340,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = grupBaris.map((grup, idx) => {
    const tStart = grup[0].start;
    let tEnd = grup[grup.length - 1].end;

    // Pastikan tidak tumpang tindih dengan baris berikutnya dan beri sedikit nafas baca
    if (idx < grupBaris.length - 1) {
      const nextStart = grupBaris[idx + 1][0].start;
      tEnd = Math.min(nextStart, Math.max(tEnd, tStart + 0.35));
    } else {
      tEnd = Math.min(durasiClip, Math.max(tEnd, tStart + 0.5));
    }

    const kataBerwarna = grup.map((obj, i) => {
      if (grup.length > 1 && i === grup.length - 1) {
        return `{\\c&H0000FFFF&}${obj.kata}{\\c&H00FFFFFF&}`;
      }
      return obj.kata;
    }).join(' ');

    const animasi = `{\\fscx85\\fscy85\\t(0,70,\\fscx103\\fscy103)\\t(70,130,\\fscx100\\fscy100)}`;
    return `Dialogue: 0,${detikKeAss(tStart)},${detikKeAss(tEnd)},ViralSub,,0,0,0,,${animasi}${kataBerwarna}`;
  });

  fs.writeFileSync(assPath, headerAss + events.join('\n') + '\n', 'utf8');
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

  // Siapkan opsi anti-blokir YouTube (pakai Node.js runtime + remote challenge solver + browser impersonate + cookies jika ada)
  let opsiYtDlp = `--js-runtimes node --remote-components ejs:github --impersonate chrome`;
  if (YOUTUBE_COOKIES) {
    fs.writeFileSync('cookies.txt', YOUTUBE_COOKIES, 'utf8');
    opsiYtDlp += ` --cookies cookies.txt`;
  }

  // Unduh subtitle satu per satu dengan jeda untuk menghindari HTTP Error 429 (Too Many Requests)
  for (const lang of ['id', 'en']) {
    try {
      execSync(`yt-dlp ${opsiYtDlp} --ignore-no-formats-error --sleep-subtitles 3 --sub-format vtt --write-auto-subs --write-subs --sub-lang "${lang}" --skip-download -o "sub" "${VIDEO_URL}"`, { stdio: 'inherit' });
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
  await kirimPesan(`🔥 Momen ditemukan!\n⏱️ ${momen.start} - ${momen.end}\n📌 ${momen.judul}\n💡 ${momen.alasan}\n\n3/3 Memotong, menyinkronkan subtitle & mengubah ke format 9:16...`);

  // Unduh video kualitas terbaik maksimal 720p/1080p mp4
  execSync(`yt-dlp ${opsiYtDlp} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "sumber.mp4" "${VIDEO_URL}"`, { stdio: 'inherit' });

  // Buat subtitle ASS langsung dari VTT asli dengan timestamp per kata yang sudah disinkronkan ke momen.start
  buatSubtitleASSDariVTT(fileSub, 'sub_klip.ass', momen.start, momen.end);

  // Potong, crop tengah ke 9:16 (1080x1920), dan tempel subtitle ASS
  execSync(`ffmpeg -y -ss ${momen.start} -to ${momen.end} -i sumber.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920,ass=sub_klip.ass" -c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 128k -movflags +faststart clip_jadi.mp4`, { stdio: 'inherit' });

  const caption = `✂️ KLIP VIRAL SIAP!\n\n📌 ${momen.judul}\n⏱️ Segmen: ${momen.start} - ${momen.end}\n💡 Alasan: ${momen.alasan}`;
  await kirimVideo('clip_jadi.mp4', caption);
  console.log('Selesai! Klip berhasil dikirim.');
}

main().catch(async err => {
  console.error(err);
  await kirimPesan('⚠️ AI Clipper gagal: ' + err.message);
  process.exit(1);
});
