const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const GEMINI_API_KEY      = (process.env.GEMINI_API_KEY || '').trim();
const TELEGRAM_TOKEN      = (process.env.TELEGRAM_TOKEN || '').trim();
const TELEGRAM_CHAT_ID    = (process.env.TELEGRAM_CHAT_ID || '').trim();
const ELEVENLABS_API_KEY  = (process.env.ELEVENLABS_API_KEY || '').trim();
const ELEVENLABS_VOICE_ID = (process.env.ELEVENLABS_VOICE_ID || 'nPczCjzI2devNBz1zQrb').trim();

const JUDUL  = (process.env.INPUT_JUDUL  || "Kenapa Kita Merem Saat Bersin?").trim();
const UKURAN = (process.env.INPUT_UKURAN || "9:16").trim();
const BAHASA = (process.env.INPUT_BAHASA || "Indonesia").trim();

// ============================================================
// [UPGRADE] Helper umum: jeda, timer tahap, format ukuran file
// ============================================================
const tunggu = (ms) => new Promise(r => setTimeout(r, ms));
const WAKTU_MULAI = Date.now();
function detikBerjalan() {
  return ((Date.now() - WAKTU_MULAI) / 1000).toFixed(1);
}
function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

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
  return { width: 1080, height: 1920, aspect: '9/16' };
}

function pilihSuaraTTS(bahasa) {
  const b = bahasa.toLowerCase();
  // [UPGRADE] Perbaikan bug: kata "indonesia" mengandung "es" sehingga dulu bisa salah terbaca Spanyol
  if (b.includes('indonesia') || b === 'id') {
    return { langCode: 'id-ID', voice: 'id-ID-ArdiNeural' };
  }
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

async function generateVoiceOver(teksBersih) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY kosong/belum terbaca! Cek nama Secret di GitHub Settings atau file render.yml.');
  }

  console.log(`Membuat VO wajib ElevenLabs (Voice ID: ${ELEVENLABS_VOICE_ID})...`);

  // [UPGRADE] Auto-retry sampai 3x (kalau server ElevenLabs lagi sibuk / jaringan putus)
  let errTerakhir = null;
  for (let percobaan = 1; percobaan <= 3; percobaan++) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text: teksBersih,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.80,
            style: 0.35,
            use_speaker_boost: true
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        // Error 401/403/422 = salah key / salah setting, retry tidak ada gunanya
        if ([400, 401, 403, 422].includes(res.status)) {
          throw Object.assign(new Error(`ElevenLabs menolak (${res.status}): ${errText}`), { fatal: true });
        }
        throw new Error(`ElevenLabs menolak (${res.status}): ${errText}`);
      }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error('File VO terlalu kecil, kemungkinan rusak.');
      fs.writeFileSync('vo.mp3', buf);
      console.log(`VO ElevenLabs berhasil dibuat! (${formatMB(buf.length)})`);
      return;
    } catch (err) {
      errTerakhir = err;
      if (err.fatal) throw err;
      console.log(`VO percobaan ${percobaan}/3 gagal -> ${err.message}`);
      if (percobaan < 3) await tunggu(5000 * percobaan);
    }
  }
  throw errTerakhir;
}

async function kirimPesanTelegram(teks) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  // [UPGRADE] Dibungkus try/catch supaya kegagalan notifikasi tidak ikut mematikan proses utama
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: teks.slice(0, 4000) })
    });
  } catch (e) {
    console.log('Notifikasi Telegram gagal (diabaikan):', e.message);
  }
}

async function kirimVideoTelegram(filePath, caption) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
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

// [UPGRADE] Kirim sebagai dokumen (cadangan kalau sendVideo gagal / file terlalu besar)
async function kirimDokumenTelegram(filePath, caption) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`;
  const form = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: 'video/mp4' });
  form.append('chat_id', TELEGRAM_CHAT_ID);
  form.append('document', blob, path.basename(filePath));
  form.append('caption', caption.slice(0, 1000));

  const res = await fetch(url, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.ok) throw new Error('Gagal kirim dokumen Telegram: ' + JSON.stringify(json));
}

// [UPGRADE] Pengaman struktur JSON dari Gemini: isi otomatis bagian yang hilang supaya template tidak error
function rapikanNaskah(data, dim, ttsInfo) {
  if (!data || typeof data !== 'object') throw new Error('Naskah dari Gemini bukan objek JSON yang valid.');

  if (!Array.isArray(data.lines)) throw new Error('Naskah dari Gemini tidak punya array "lines".');
  data.lines = data.lines.filter(l => Array.isArray(l) && l.length >= 3 && typeof l[2] === 'string' && l[2].trim() !== '');
  if (data.lines.length < 3) throw new Error('Naskah dari Gemini terlalu pendek / format "lines" rusak.');

  const defaultTx = {
    kicker: 'FAKTA UNIK', t1: 'KATA ATAS', t2: 'KATA BAWAH?',
    cvA: 'Tahukah kamu', cvB: '?', cvC: JUDUL,
    watch: 'tonton sampai habis',
    ctaA: 'Mau bikin video', ctaB: 'kayak gini?',
    ctaSub: 'Prompt otomatis siap pakai', ctaBio: 'LINK DI BIO',
    src: 'Sumber', chap: 'Bab', lb1: 'DATA RISET', lb2: 'KOMENTAR PENONTON'
  };
  const defaultBroll = {
    b1_title: 'DATA RISET', b1_sub: 'Fakta pendukung',
    b2_user: '@PenontonPenasaran', b2_comment: 'Wah baru tahu!',
    b3_title: 'PERBANDINGAN DATA', b3_sub: 'Data singkat',
    b4_title: 'FAKTA KUNCI', b4_sub: 'Ringkasan bukti'
  };
  const defaultScenes = {
    title: ['Pembuka', 'hook cerita'],
    a: ['Fakta Utama', 'penjelasan'],
    b: ['Bukti & Fakta', 'visual pendukung'],
    cta: ['Mau bikin video begini?', 'cek link di bio'],
    c: ['Sudut Pandang', 'kesimpulan'],
    end: ['Penutup', 'refleksi']
  };

  data.tx     = Object.assign({}, defaultTx,     (data.tx     && typeof data.tx     === 'object') ? data.tx     : {});
  data.broll  = Object.assign({}, defaultBroll,  (data.broll  && typeof data.broll  === 'object') ? data.broll  : {});
  data.scenes = Object.assign({}, defaultScenes, (data.scenes && typeof data.scenes === 'object') ? data.scenes : {});

  if (typeof data.title !== 'string' || !data.title.trim()) data.title = JUDUL;
  if (typeof data.desc  !== 'string' || !data.desc.trim())  data.desc  = `${data.title} - tonton sampai habis dan tulis pendapatmu di komentar!`;
  if (typeof data.tags  !== 'string' || !data.tags.trim())  data.tags  = '#faktaunik #edukasi #shorts';
  if (!Array.isArray(data.src)) data.src = [];
  if (!data.varian) data.varian = 'v' + (Date.now() % 999);

  if (dim.aspect === '9/16') {
    if (!data.title.toLowerCase().includes('#shorts')) data.title += ' #Shorts';
    if (!data.tags.toLowerCase().includes('#shorts')) data.tags += ' #Shorts';
  }

  data.lang   = ttsInfo.langCode;
  data.width  = dim.width;
  data.height = dim.height;
  return data;
}

async function buatNaskahJSON(dim, ttsInfo) {
  const prompt = `Kamu adalah penulis skrip & sutradara video animasi edukasi V8.8.
Buatkan data lengkap dalam format JSON MURNI (tanpa teks pembuka/penutup) untuk video berikut:
- Judul: "${JUDUL}"
- Bahasa Video: ${BAHASA} (kode BCP-47: ${ttsInfo.langCode})
- Ukuran: ${UKURAN} (${dim.width}x${dim.height})

ATURAN KETAT V8.8:
1. Semua teks di dalam video (tx, lines, scenes, desc, tags) wajib ditulis dalam bahasa ${BAHASA} yang natural seperti penutur asli.
2. Buat ${dim.aspect === '9/16' ? '8-10 kalimat SANGAT SINGKAT (maksimal 10-12 kata per kalimat agar total durasi baca di bawah 50 detik untuk YouTube Shorts)' : '11-13 kalimat pendek'} di array "lines". Format tiap elemen: ["kunci_adegan", "mood", "Kalimat dengan *kata* ditekankan.", "fx_opsional"]
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
          // [UPGRADE] Hasil di-parse lalu dirapikan/divalidasi; kalau rusak otomatis lanjut ke model berikutnya
          const hasil = JSON.parse(raw);
          return rapikanNaskah(hasil, dim, ttsInfo);
        }
        lastApiError = `${model}: ${JSON.stringify(json.error || json)}`;
        console.log(`Gagal (${model}) ->`, lastApiError);
      } catch (err) {
        lastApiError = `${model} timeout/network/format: ${err.message}`;
        console.log(`Timeout/Error jaringan/format (${model}) ->`, err.message);
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

  // [UPGRADE] Notifikasi awal ke Telegram
  await kirimPesanTelegram(`🏭 Pabrik Video mulai bekerja!\n\n📌 Judul: ${JUDUL}\n📐 Ukuran: ${UKURAN}\n🌐 Bahasa: ${BAHASA}`);

  console.log('1/4 Meracik naskah & adegan V8.8...');
  const videoData = await buatNaskahJSON(dim, ttsInfo);
  console.log(`   (naskah selesai, ${detikBerjalan()} detik berjalan, ${videoData.lines.length} kalimat)`);

  // Simpan metadata ke data.json agar dibaca otomatis oleh upload_youtube.py
  fs.writeFileSync('data.json', JSON.stringify(videoData, null, 2), 'utf8');

  console.log('2/4 Membuat suara Voice Over (VO) ElevenLabs...');
  const teksBersih = videoData.lines.map(l => l[2].replace(/\*/g, '')).join(' ');
  await generateVoiceOver(teksBersih);
  console.log(`   (VO selesai, ${detikBerjalan()} detik berjalan)`);
  await kirimPesanTelegram('✅ Naskah & suara VO selesai. Sekarang merender video...');

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

  // [UPGRADE] try/finally: browser & server selalu ditutup walau render gagal (tidak menggantung)
  try {
    const context = await browser.newContext({
      viewport: { width: dim.width, height: dim.height },
      acceptDownloads: true
    });
    const page = await context.newPage();

    // [UPGRADE] Log error dari dalam halaman HTML supaya gampang debug di GitHub Actions
    page.on('pageerror', e => console.log('[Halaman] Error JS:', e.message));
    page.on('console', msg => {
      if (msg.type() === 'error') console.log('[Halaman] console.error:', msg.text());
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 240000 });
    await page.goto('http://localhost:8080/render_siap.html?autorender=1', { waitUntil: 'networkidle' });

    const download = await downloadPromise;
    await download.saveAs('hasil_mentah.webm');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(`   (render browser selesai, ${detikBerjalan()} detik berjalan)`);

  console.log('Mengemas MP4 final (H.264 + AAC jernih tanpa gema)...');
  execSync(`ffmpeg -y -i hasil_mentah.webm -i vo.mp3 -map 0:v:0 -map 1:a:0 -c:v libx264 -preset veryfast -crf 21 -r 30 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart video_jadi.mp4`, { stdio: 'inherit' });

  // [UPGRADE] Info tambahan: ukuran file & durasi video (ffprobe opsional, aman kalau gagal)
  const ukuranFile = fs.statSync('video_jadi.mp4').size;
  let durasiTeks = '-';
  try {
    const d = parseFloat(execSync('ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 video_jadi.mp4').toString().trim());
    if (!isNaN(d)) durasiTeks = d.toFixed(1) + ' detik';
  } catch (e) { /* abaikan */ }

  const infoYoutube = `🎬 VIDEO SELESAI DIRENDER!\n\n📌 Judul:\n${videoData.title}\n\n📝 Deskripsi:\n${videoData.desc}\n\n📚 Sumber:\n${videoData.src.map(s => '- ' + s).join('\n')}\n\n🏷️ Tags:\n${videoData.tags}`;

  // [UPGRADE] Kirim video; kalau terlalu besar (>49MB) atau gagal, kirim sebagai dokumen
  const infoTeknis = `\n\n⏱️ Durasi: ${durasiTeks} | 💾 ${formatMB(ukuranFile)} | 🕐 Proses: ${detikBerjalan()} dtk`;
  if (ukuranFile > 49 * 1024 * 1024) {
    console.log('File > 49MB, dikirim sebagai dokumen...');
    await kirimDokumenTelegram('video_jadi.mp4', infoYoutube);
  } else {
    try {
      await kirimVideoTelegram('video_jadi.mp4', infoYoutube);
    } catch (e) {
      console.log('sendVideo gagal, mencoba kirim sebagai dokumen ->', e.message);
      await kirimDokumenTelegram('video_jadi.mp4', infoYoutube);
    }
  }

  // [UPGRADE] Caption Telegram dibatasi 1000 huruf, jadi info lengkap + teknis dikirim juga sebagai pesan teks
  await kirimPesanTelegram(infoYoutube + infoTeknis);
  console.log('Selesai! Video sudah dikirim ke Telegram.');
}

main().catch(async err => {
  console.error(err);
  await kirimPesanTelegram('⚠️ Pabrik Video gagal merender: ' + err.message);
  process.exit(1);
});
