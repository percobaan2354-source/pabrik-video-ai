const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const GEMINI_API_KEY   = (process.env.GEMINI_API_KEY || '').trim();
const TELEGRAM_TOKEN   = (process.env.TELEGRAM_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

const JUDUL  = (process.env.INPUT_JUDUL  || "Kenapa Kita Merem Saat Bersin?").trim();
const UKURAN = (process.env.INPUT_UKURAN || "9:16").trim();
const BAHASA = (process.env.INPUT_BAHASA || "Indonesia").trim();

function parseUkuran(uk) {
  const s = uk.toLowerCase();
  if (s.includes('16:9') || s.includes('youtube panjang') || s.includes('landscape')) {
    return { width: 1280, height: 720, aspect: '16/9' };
  }
  if (s.includes('4:5') || s.includes('ig feed')) {
    return { width: 720, height: 900, aspect: '4/5' };
  }
  if (s.includes('1:1') || s.includes('square')) {
    return { width: 720, height: 720, aspect: '1/1' };
  }
  return { width: 720, height: 1280, aspect: '9/16' };
}

function pilihSuaraTTS(bahasa) {
  const b = bahasa.toLowerCase();
  if (b.includes('inggris') || b.includes('english') || b.includes('en')) {
    return { langCode: 'en-US', voice: 'en-US-AndrewNeural' };
  }
  if (b.includes('jepang') || b.includes('japan') || b.includes('ja')) {
    return { langCode: 'ja-JP', voice: 'ja-JP-KeitaNeural' };
  }
  if (b.includes('korea') || b.includes('ko')) {
    return { langCode: 'ko-KR', voice: 'ko-KR-InJoonNeural' };
  }
  if (b.includes('arab') || b.includes('ar')) {
    return { langCode: 'ar-SA', voice: 'ar-SA-HamedNeural' };
  }
  if (b.includes('spanyol') || b.includes('spanish') || b.includes('es')) {
    return { langCode: 'es-ES', voice: 'es-ES-AlvaroNeural' };
  }
  return { langCode: 'id-ID', voice: 'id-ID-ArdiNeural' };
}

async function kirimPesanTelegram(teks) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: teks })
  });
}

async function kirimVideoTelegram(filePath, caption) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendVideo`;
  const form = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: 'video/mp4' });
  form.append('chat_id', TELEGRAM_CHAT_ID);
  form.append('video', blob, path.basename(filePath));
  form.append('caption', caption.slice(0, 1000));
  form.append('supports_streaming', 'true');

  const res = await fetch(url, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.ok) throw new Error('Gagal kirim video Telegram: ' + JSON.stringify(json));
}

async function buatNaskahJSON(dim, ttsInfo) {
  const prompt = `Kamu adalah penulis skrip & sutradara video animasi edukasi V8.8.
Buatkan data lengkap dalam format JSON MURNI (tanpa teks pembuka/penutup) untuk video berikut:
- Judul: "${JUDUL}"
- Bahasa Video: ${BAHASA} (kode BCP-47: ${ttsInfo.langCode})
- Ukuran: ${UKURAN} (${dim.width}x${dim.height})

ATURAN KETAT V8.8:
1. Semua teks di dalam video (tx, lines, scenes, desc, tags) wajib ditulis dalam bahasa ${BAHASA} yang natural seperti penutur asli.
2. Buat 11-13 kalimat pendek di array "lines". Format tiap elemen: ["kunci_adegan", "mood", "Kalimat dengan *kata* ditekankan.", "fx_opsional"]
   - Kunci adegan WAJIB berurutan: "title" (2 baris hook), "a" (2-3 baris fakta utama), "b" (3-4 baris bukti & visual), "cta" (2 baris ajakan di TENGAH video: misalnya "Mau bikin video kayak gini juga?" dan "Langsung aja ke *bio*."), "c" (2 baris sudut pandang/puncak), "end" (1-2 baris penutup berkesan TANPA CTA).
   - Mood: "n" (santai), "d" (dramatis), "e" (semangat), "s" (sunyi/serius).
   - FX opsional (boleh kosong ""): "b" (boom), "k" (hantaman), "c" (lonceng di baris kedua cta), "p" (pop).
3. "src": berikan 2 sumber riset nyata dan kredibel terkait topik judul.
4. "broll": isi teks visual pendukung singkat sesuai tema judul.

KELUARKAN HANYA JSON DENGAN STRUKTUR PERSIS INI:
{
  "title": "Judul Menarik Sesuai Bahasa",
  "varian": "v${Date.now() % 999}",
  "lang": "${ttsInfo.langCode}",
  "width": ${dim.width},
  "height": ${dim.height},
  "desc": "Deskripsi singkat YouTube 2 kalimat + ajakan diskusi.",
  "tags": "#faktaunik #edukasi #shorts",
  "src": ["Nama Lembaga / Jurnal 1", "Nama Institusi / Studi 2"],
  "tx": {
    "kicker": "FAKTA UNIK",
    "t1": "KATA ATAS",
    "t2": "KATA BAWAH?",
    "cvA": "Tahukah kamu",
    "cvB": "?",
    "cvC": "Hook singkat 4-6 kata di sampul",
    "watch": "tonton sampai habis",
    "ctaA": "Mau bikin video",
    "ctaB": "kayak gini?",
    "ctaSub": "Prompt otomatis siap pakai",
    "ctaBio": "LINK DI BIO",
    "src": "Sumber",
    "chap": "Bab",
    "lb1": "DATA RISET",
    "lb2": "KOMENTAR PENONTON"
  },
  "broll": {
    "b1_title": "JUDUL B-ROLL 1",
    "b1_sub": "Subjudul singkat 1",
    "b2_user": "@PenontonPenasaran",
    "b2_comment": "Komentar singkat relevan",
    "b3_title": "PERBANDINGAN DATA",
    "b3_sub": "Subjudul data singkat",
    "b4_title": "FAKTA KUNCI",
    "b4_sub": "Ringkasan bukti singkat"
  },
  "scenes": {
    "title": ["Pembuka", "hook cerita"],
    "a": ["Fakta Utama", "penjelasan"],
    "b": ["Bukti & Fakta", "visual pendukung"],
    "cta": ["Mau bikin video begini?", "cek link di bio"],
    "c": ["Sudut Pandang", "kesimpulan"],
    "end": ["Penutup", "refleksi"]
  },
  "lines": [
    ["title", "d", "Kalimat hook pertama dengan *penekanan*.", "b"],
    ["title", "n", "Kalimat kedua pengantar cerita."],
    ["a", "n", "Kalimat fakta pertama."],
    ["a", "e", "Kalimat fakta kedua yang *mengejutkan*."],
    ["b", "d", "Kalimat bukti pertama.", "k"],
    ["b", "n", "Kalimat bukti kedua."],
    ["b", "s", "Kalimat bukti ketiga."],
    ["cta", "n", "Mau bikin video kayak gini juga?"],
    ["cta", "e", "Langsung aja ke *bio*.", "c"],
    ["c", "n", "Kalimat sudut pandang pribadi."],
    ["c", "d", "Kalimat puncak cerita.", "b"],
    ["end", "s", "Kalimat penutup yang meninggalkan *kesan*."]
  ]
}`;

  const models = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemma-3-27b-it", "gemini-flash-latest"];
  let lastApiError = "";

  for (let putaran = 1; putaran <= 5; putaran++) {
    for (const model of models) {
      try {
        console.log(`Putaran ${putaran}: mencoba ${model}...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const payload = JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        });
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(45000),
          body: payload
        });
        const json = await res.json();
        if (json.candidates && json.candidates[0]) {
          let raw = json.candidates[0].content.parts[0].text.trim();
          const awal = raw.indexOf('{');
          const akhir = raw.lastIndexOf('}');
          if (awal !== -1 && akhir !== -1) {
            raw = raw.slice(awal, akhir + 1);
          }
          return JSON.parse(raw);
        }
        lastApiError = `${model}: ${JSON.stringify(json.error || json)}`;
        console.log(`Gagal (${model}) ->`, lastApiError);
      } catch (err) {
        lastApiError = `${model} timeout/network: ${err.message}`;
        console.log(`Timeout/Error jaringan (${model}) ->`, err.message);
      }
    }
    console.log("Menunggu 8 detik sebelum putaran berikutnya...");
    await new Promise(r => setTimeout(r, 8000));
  }
  throw new Error('Gagal menghasilkan naskah dari Gemini API setelah 5x putaran. Detail: ' + lastApiError);
}

async function main() {
  console.log(`Mulai produksi: "${JUDUL}" (${UKURAN}, ${BAHASA})`);
  const dim = parseUkuran(UKURAN);
  const ttsInfo = pilihSuaraTTS(BAHASA);

  console.log('1/4 Meracik naskah & adegan V8.8...');
  const videoData = await buatNaskahJSON(dim, ttsInfo);

  console.log('2/4 Membuat suara Voice Over (VO)...');
  const teksBersih = videoData.lines.map(l => l[2].replace(/\*/g, '')).join(' ');
  fs.writeFileSync('naskah_vo.txt', teksBersih, 'utf8');
  execSync(`edge-tts --voice "${ttsInfo.voice}" --rate="+6%" --pitch="+2Hz" --file naskah_vo.txt --write-media vo.mp3`, { stdio: 'inherit' });

  console.log('3/4 Merakit file HTML V8.8...');
  let html = fs.readFileSync('template.html', 'utf8');
  html = html.replace('__TITLE__', videoData.title);
  html = html.replace('__ASPECT__', dim.aspect);
  html = html.replace('__VIDEO_DATA_JSON__', JSON.stringify(videoData));
  fs.writeFileSync('render_siap.html', html, 'utf8');

  console.log('4/4 Merender video di cloud...');
  const server = http.createServer((req, res) => {
    const reqUrl = req.url.split('?')[0];
    const filePath = path.join(__dirname, reqUrl === '/' ? 'render_siap.html' : reqUrl);
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(filePath);
    const mime = { '.html': 'text/html', '.png': 'image/png', '.mp3': 'audio/mpeg' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise(r => server.listen(8080, r));

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    viewport: { width: dim.width, height: dim.height },
    acceptDownloads: true
  });
  const page = await context.newPage();

  const downloadPromise = page.waitForEvent('download', { timeout: 240000 });
  await page.goto('http://localhost:8080/render_siap.html?autorender=1', { waitUntil: 'networkidle' });

  const download = await downloadPromise;
  await download.saveAs('hasil_mentah.webm');
  await browser.close();
  server.close();

  console.log('Mengemas MP4 final (H.264 + AAC jernih tanpa gema)...');
  execSync(`ffmpeg -y -i hasil_mentah.webm -i vo.mp3 -map 0:v:0 -map 1:a:0 -c:v libx264 -preset veryfast -crf 21 -r 30 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart video_jadi.mp4`, { stdio: 'inherit' });

  const infoYoutube = `🎬 VIDEO SELESAI DIRENDER!\n\n📌 Judul:\n${videoData.title}\n\n📝 Deskripsi:\n${videoData.desc}\n\n📚 Sumber:\n${videoData.src.map(s => '- ' + s).join('\n')}\n\n🏷️ Tags:\n${videoData.tags}`;
  await kirimVideoTelegram('video_jadi.mp4', infoYoutube);
  console.log('Selesai! Video sudah dikirim ke Telegram.');
}

main().catch(async err => {
  console.error(err);
  await kirimPesanTelegram('⚠️ Pabrik Video gagal merender: ' + err.message);
  process.exit(1);
});
