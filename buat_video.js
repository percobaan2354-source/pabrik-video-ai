const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, spawn } = require('child_process');
const { chromium } = require('playwright');

const GEMINI_API_KEY      = (process.env.GEMINI_API_KEY || '').trim();
const TELEGRAM_TOKEN      = (process.env.TELEGRAM_TOKEN || '').trim();
const TELEGRAM_CHAT_ID    = (process.env.TELEGRAM_CHAT_ID || '').trim();
const ELEVENLABS_API_KEY  = (process.env.ELEVENLABS_API_KEY || '').trim();
const ELEVENLABS_VOICE_ID = (process.env.ELEVENLABS_VOICE_ID || 'nPczCjzI2devNBz1zQrb').trim();

const JUDUL  = (process.env.INPUT_JUDUL  || "Kenapa Kita Merem Saat Bersin?").trim();
const UKURAN = (process.env.INPUT_UKURAN || "9:16").trim();
const BAHASA = (process.env.INPUT_BAHASA || "Indonesia").trim();

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
  if (s.includes('16:9') || s.includes('youtube long') || s.includes('youtube panjang') || s.includes('facebook') || s.includes('fb') || s.includes('landscape')) {
    return { width: 1280, height: 720, aspect: '16/9', isVertical: false };
  }
  if (s.includes('4:5') || s.includes('feed')) {
    return { width: 720, height: 900, aspect: '4/5', isVertical: true };
  }
  if (s.includes('1:1') || s.includes('square')) {
    return { width: 720, height: 720, aspect: '1/1', isVertical: false };
  }
  return { width: 720, height: 1280, aspect: '9/16', isVertical: true };
}

function pilihSuaraTTS(bahasa) {
  const b = bahasa.toLowerCase();
  if (b.includes('indonesia') || b === 'id') return { langCode: 'id-ID' };
  if (b.includes('inggris') || b.includes('english') || b.includes('en')) return { langCode: 'en-US' };
  if (b.includes('jepang') || b.includes('japan') || b.includes('ja')) return { langCode: 'ja-JP' };
  if (b.includes('korea') || b.includes('ko')) return { langCode: 'ko-KR' };
  if (b.includes('arab') || b.includes('ar')) return { langCode: 'ar-SA' };
  if (b.includes('spanyol') || b.includes('spanish') || b.includes('es')) return { langCode: 'es-ES' };
  return { langCode: 'id-ID' };
}

/* ===== GENERATOR AUDIO BACKSOUND LEMBUT & SFX TRANSISI RENYAH (WAV) ===== */
function generateBgmAndSfxWav(filePath, durationSec, videoData) {
  const sr = 44100;
  const numSamples = Math.ceil(durationSec * sr);
  const left = new Float32Array(numSamples);
  const right = new Float32Array(numSamples);

  const seedStr = (videoData.title || '') + '|' + (videoData.varian || '');
  let seed = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    seed ^= seedStr.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  seed = seed >>> 0;

  // 6 Skala Melodi Backsound berbeda untuk tiap video
  const SCALES = [
    [261.63, 329.63, 392.00, 493.88, 523.25, 392.00],
    [220.00, 261.63, 329.63, 392.00, 440.00, 329.63],
    [293.66, 349.23, 440.00, 523.25, 587.33, 440.00],
    [196.00, 246.94, 293.66, 369.99, 392.00, 293.66],
    [246.94, 293.66, 369.99, 440.00, 493.88, 369.99],
    [174.61, 220.00, 261.63, 329.63, 349.23, 261.63]
  ];
  const scale = SCALES[seed % SCALES.length];
  const beatDur = 0.42 + (seed % 5) * 0.04;

  // 1. Sintesis Backsound Melodis Stereo (Dikecilkan agar pas di latar belakang, tapi tetap terasa)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sr;
    const step = Math.floor(t / beatDur);
    const localT = t - step * beatDur;
    const env = Math.sin(Math.min(1, localT / 0.06) * (Math.PI / 2)) * Math.exp(-localT * 2.1);

    const freq = scale[(step + (seed % 4)) % scale.length];
    const bassFreq = scale[0] * 0.5;
    const bassEnv = Math.exp(-((t % (beatDur * 2)) * 1.6));

    const lead = (Math.sin(2 * Math.PI * freq * t) * 0.70 + Math.sin(2 * Math.PI * freq * 2 * t) * 0.20) * env * 0.068;
    const pad = Math.sin(2 * Math.PI * (freq * 0.5) * t + 0.4) * 0.032;
    const bass = Math.sin(2 * Math.PI * bassFreq * t) * bassEnv * 0.058;

    const pan = Math.sin(t * 0.7) * 0.25;
    left[i]  = (lead * (1 - pan)) + pad + bass;
    right[i] = (lead * (1 + pan)) + pad + bass;
  }

  // 2. SFX Transisi Sosmed (Whip-Whoosh + Sub-Punch + Crisp Chime) yang Jelas Terdengar
  const lines = Array.isArray(videoData.lines) ? videoData.lines : [];
  let prevSc = null;
  const totalLines = lines.length || 1;
  lines.forEach((l, idx) => {
    const sc = l[0];
    if (sc !== prevSc) {
      prevSc = sc;
      const startSec = idx === 0 ? 0.45 : (idx / totalLines) * Math.max(1, durationSec - 1.5);
      const startSample = Math.floor(startSec * sr);
      const sfxLen = Math.floor(0.32 * sr);
      for (let j = 0; j < sfxLen && (startSample + j) < numSamples; j++) {
        const u = j / sfxLen;
        const env = Math.sin(u * Math.PI);
        // Whip-Whoosh sweep frekuensi tinggi agar menembus suara VO
        const fSweep = 220 + u * 960;
        const whoosh = Math.sin(2 * Math.PI * fSweep * (j / sr)) * env * 0.52;
        // Crisp Pop & Chime di awal transisi
        const pop = (u < 0.28) ? Math.sin(2 * Math.PI * 1050 * (j / sr)) * (1 - u / 0.28) * 0.44 : 0;
        // Sub-Bass Thump
        const sub = Math.sin(2 * Math.PI * (110 - u * 55) * (j / sr)) * (1 - u) * 0.48;
        left[startSample + j]  += whoosh + pop + sub;
        right[startSample + j] += whoosh + pop + sub;
      }
    }
  });

  const dataSize = numSamples * 4;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sr, 24);
  buffer.writeUInt32LE(sr * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const lVal = Math.max(-1, Math.min(1, left[i]));
    const rVal = Math.max(-1, Math.min(1, right[i]));
    buffer.writeInt16LE(Math.round(lVal * 32767), offset);
    buffer.writeInt16LE(Math.round(rVal * 32767), offset + 2);
    offset += 4;
  }
  fs.writeFileSync(filePath, buffer);
}

async function generateVoiceOver(teksBersih) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY kosong/belum terbaca!');
  }

  console.log(`Membuat VO wajib ElevenLabs (Voice ID: ${ELEVENLABS_VOICE_ID})...`);
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
            stability: 0.48,
            similarity_boost: 0.80,
            style: 0.30,
            use_speaker_boost: true
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
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

function rapikanNaskah(data, dim, ttsInfo) {
  if (!data || typeof data !== 'object') throw new Error('Naskah dari Gemini bukan objek JSON yang valid.');
  if (!Array.isArray(data.lines)) throw new Error('Naskah dari Gemini tidak punya array "lines".');

  data.lines = data.lines.filter(l => Array.isArray(l) && l.length >= 3 && typeof l[2] === 'string' && l[2].trim() !== '');
  if (data.lines.length < 4) throw new Error('Naskah dari Gemini terlalu pendek / format "lines" rusak.');

  const defaultTx = {
    kicker: 'FAKTA UNIK',
    t1: 'FAKTA',
    t2: 'MENGEJUTKAN',
    watch: 'tonton sampai habis',
    ctaA: 'Mau bikin video',
    ctaB: 'kayak gini?',
    ctaSub: 'Prompt otomatis siap pakai • Tinggal tempel & jalankan',
    ctaBio: 'LINK DI BIO',
    src: 'Sumber'
  };

  data.tx = Object.assign({}, defaultTx, (data.tx && typeof data.tx === 'object') ? data.tx : {});
  if (typeof data.title !== 'string' || !data.title.trim()) data.title = JUDUL;
  if (typeof data.desc  !== 'string' || !data.desc.trim())  data.desc  = `${data.title} - tonton sampai habis dan tulis pendapatmu di komentar!`;
  if (typeof data.tags  !== 'string' || !data.tags.trim())  data.tags  = '#faktaunik #edukasi #storytelling';
  if (!Array.isArray(data.src) || data.src.length === 0) data.src = ['Sumber Terverifikasi'];
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
  const jumlahKalimat = dim.isVertical
    ? '9-10 kalimat storytelling santai & mengalir (maksimal 10-12 kata per kalimat agar total durasi baca 38-50 detik)'
    : '12-15 kalimat padat dan informatif (untuk video landscape 16:9)';

  const prompt = `Kamu adalah penulis skrip & sutradara video animasi storytelling 3D V30.0.
Buatkan data lengkap dalam format JSON MURNI (tanpa teks pembuka/penutup) untuk video berikut:
- Judul: "${JUDUL}"
- Bahasa Video: ${BAHASA} (kode BCP-47: ${ttsInfo.langCode})
- Ukuran: ${UKURAN} (${dim.width}x${dim.height})

ATURAN KETAT V30.0:
1. Gaya bahasa wajib seperti bercerita santai (*storytelling* yang enak didengar, mengalir alami, tidak kaku) dalam bahasa ${BAHASA}.
2. Buat ${jumlahKalimat} di dalam array "lines". Berikan tanda koma/titik yang jelas antar kalimat agar jeda intonasi suara terdeteksi presisi.
   Format tiap elemen: ["kunci_adegan", "mood", "Kalimat dengan *kata* ditekankan.", "fx_opsional", "objek_visual_3d"]
   - Kunci adegan WAJIB menggunakan urutan ini:
     * "title" (1 baris pembuka langsung ke topik utama yang santai & bikin penasaran)
     * "b1" (1-2 baris penjelasan visual B-Roll full layar pertama)
     * "a" (1-2 baris cerita utama dari karakter)
     * "b2" (1-2 baris detail mikro B-Roll kecil)
     * "b3" (1-2 baris bukti perbandingan / mekanisme B-Roll full layar kedua)
     * "cta" (2 baris ajakan di TENGAH video: baris 1 "Mau bikin video kayak gini juga?" dan baris 2 "Langsung aja cek *link di bio*.")
     * "c" (1-2 baris sudut pandang / refleksi karakter)
     * "b4" (1-2 baris puncak fakta B-Roll full layar ketiga)
     * "end" (1 baris penutup berkesan TANPA CTA)
   - Mood: "n" (santai), "d" (dramatis), "e" (semangat), "s" (tenang).
   - FX opsional (boleh kosong ""): "b" (boom), "k" (hantaman), "c" (lonceng di baris kedua cta), "p" (pop).
   - objek_visual_3d: tuliskan 1-2 kata benda utama yang sedang dibahas di baris itu (contoh: "tutup pulpen", "jalur napas", "pabrik industri", "jam dinding", "jantung", "singa") agar model 3D muncul 100% sesuai ucapan VO!
3. "tx":
   - "kicker": kategori singkat 1-2 kata (contoh: "SAINS TUBUH", "FAKTA UNIK", "PSIKOLOGI").
   - "t1": 1-2 kata judul besar baris atas di sampul (maksimal 14 huruf).
   - "t2": 1-2 kata judul besar baris bawah di sampul (maksimal 14 huruf).
4. "src": berikan 2 sumber riset nyata dan kredibel terkait topik judul.

KELUARKAN HANYA JSON DENGAN STRUKTUR PERSIS INI:
{
  "title": "Judul Menarik Sesuai Bahasa",
  "varian": "v${Date.now() % 999}",
  "lang": "${ttsInfo.langCode}",
  "width": ${dim.width},
  "height": ${dim.height},
  "desc": "Deskripsi singkat 2 kalimat + ajakan diskusi di komentar.",
  "tags": "#faktaunik #edukasi #storytelling",
  "src": ["Nama Lembaga / Jurnal 1", "Nama Institusi / Studi 2"],
  "tx": {
    "kicker": "FAKTA UNIK",
    "t1": "KATA ATAS",
    "t2": "KATA BAWAH?",
    "watch": "tonton sampai habis",
    "ctaA": "Mau bikin video",
    "ctaB": "kayak gini?",
    "ctaSub": "Prompt otomatis siap pakai • Tinggal tempel & jalankan",
    "ctaBio": "LINK DI BIO",
    "src": "Sumber"
  },
  "lines": [
    ["title", "d", "Kalimat pembuka pertama dengan *penekanan*.", "b", "objek utama"],
    ["b1", "n", "Kalimat visual pertama yang menjelaskan objek utama.", "p", "objek utama"],
    ["a", "n", "Kalimat fakta utama dari karakter.", "", ""],
    ["b2", "e", "Kalimat detail mikro yang *mengejutkan*.", "p", "objek mikro"],
    ["b3", "d", "Kalimat perbandingan sebelum dan sesudah.", "k", "mekanisme"],
    ["cta", "n", "Mau bikin video kayak gini juga?", "", ""],
    ["cta", "e", "Langsung aja cek *link di bio*.", "c", ""],
    ["c", "n", "Kalimat sudut pandang dan refleksi.", "", ""],
    ["b4", "d", "Kalimat puncak bukti terpenting.", "b", "bukti industri"],
    ["end", "s", "Kalimat penutup yang meninggalkan *kesan*.", "", ""]
  ]
}`;

  let models = ["gemini-3-flash-preview", "gemini-flash-latest"];
  try {
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
    const listJson = await listRes.json();
    if (Array.isArray(listJson.models)) {
      const valid = listJson.models
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace('models/', ''))
        .filter(n => /flash|pro/i.test(n) && !/embedding|vision|aqa|tts|image|2\.5/i.test(n));
      if (valid.length > 0) {
        models = [...new Set([...models, ...valid])];
      }
    }
  } catch (e) { /* pakai daftar bawaan */ }

  let lastApiError = "";

  for (let putaran = 1; putaran <= 3; putaran++) {
    for (const model of models) {
      try {
        console.log(`Putaran ${putaran}: mencoba ${model}...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(45000),
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const json = await res.json();
        if (json.candidates && json.candidates[0]) {
          let raw = json.candidates[0].content.parts[0].text.trim();
          const awal = raw.indexOf('{');
          const akhir = raw.lastIndexOf('}');
          if (awal !== -1 && akhir !== -1) raw = raw.slice(awal, akhir + 1);
          const hasil = JSON.parse(raw);
          return rapikanNaskah(hasil, dim, ttsInfo);
        }
        lastApiError = `${model}: ${JSON.stringify(json.error || json)}`;
        console.log(`Gagal (${model}) ->`, lastApiError);
      } catch (err) {
        lastApiError = `${model} error: ${err.message}`;
        console.log(`Error (${model}) ->`, err.message);
      }
    }
    await tunggu(5000);
  }
  throw new Error('Gagal menghasilkan naskah dari Gemini API. Detail: ' + lastApiError);
}

async function main() {
  console.log(`Mulai produksi V30.0: "${JUDUL}" (${UKURAN}, ${BAHASA})`);
  const dim = parseUkuran(UKURAN);
  const ttsInfo = pilihSuaraTTS(BAHASA);

  await kirimPesanTelegram(
    `🏭 Pabrik Video 3D V30.0 mulai bekerja!\n\n` +
    `📌 Judul: ${JUDUL}\n` +
    `📐 Ukuran: ${UKURAN} (${dim.width}x${dim.height})\n` +
    `🌐 Bahasa: ${BAHASA}`
  );

  console.log('1/4 Meracik naskah & adegan 3D V30.0...');
  const videoData = await buatNaskahJSON(dim, ttsInfo);
  console.log(`   (naskah selesai, ${detikBerjalan()} detik berjalan, ${videoData.lines.length} kalimat)`);

  fs.writeFileSync('data.json', JSON.stringify(videoData, null, 2), 'utf8');

  console.log('2/4 Membuat suara Voice Over (VO) ElevenLabs...');
  const teksBersih = videoData.lines.map(l => l[2].replace(/\*/g, '')).join(' ');
  await generateVoiceOver(teksBersih);
  console.log(`   (VO selesai, ${detikBerjalan()} detik berjalan)`);
  await kirimPesanTelegram('✅ Naskah & suara VO selesai. Sekarang merender video 3D HD + Backsound + SFX...');

  console.log('3/4 Merakit file HTML V30.0...');
  let html = fs.readFileSync('template.html', 'utf8');
  html = html.replace('__TITLE__', videoData.title);
  html = html.replace('__ASPECT__', dim.aspect);
  html = html.replace('__VIDEO_DATA_JSON__', JSON.stringify(videoData));
  fs.writeFileSync('render_siap.html', html, 'utf8');

  console.log('4/4 Merender video HD 30 FPS di cloud...');
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
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader'
    ]
  });

  try {
    const context = await browser.newContext({
      viewport: { width: dim.width, height: dim.height },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    page.on('pageerror', e => console.log('[Halaman] Error JS:', e.message));

    await page.goto('http://localhost:8080/render_siap.html?autorender=1', { waitUntil: 'networkidle' });

    await page.waitForFunction(() => window.__ASSETS_READY === true, null, {
      timeout: 60000,
      polling: 200
    });

    const totalDetik = await page.evaluate(() => window.__VIDEO_LEN || 40);
    const fps = 30;
    const totalFrame = Math.ceil(totalDetik * fps);
    console.log(`   Merender ${totalFrame} frame (${totalDetik} detik @ ${fps} FPS)...`);

    // Buat backsound lembut & SFX transisi renyah sesuai durasi video
    generateBgmAndSfxWav('bgm_sfx.wav', totalDetik, videoData);

    const ffArgs = [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-r', String(fps),
      '-i', 'pipe:0',
      '-i', 'vo.mp3',
      '-i', 'bgm_sfx.wav',
      '-filter_complex', '[1:a]volume=1.15[vo];[2:a]volume=1.05[bgm];[vo][bgm]amix=inputs=2:duration=first:normalize=0[aout]',
      '-map', '0:v:0',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-movflags', '+faststart',
      'video_jadi.mp4'
    ];
    const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });

    for (let f = 0; f < totalFrame; f++) {
      const tSec = f / fps;
      const b64 = await page.evaluate((t) => {
        window.__renderFrameAt(t);
        const dataUrl = document.getElementById('cv').toDataURL('image/jpeg', 0.92);
        return dataUrl.split(',')[1];
      }, tSec);

      const frameBuf = Buffer.from(b64, 'base64');
      if (!ff.stdin.write(frameBuf)) {
        await new Promise(resolve => ff.stdin.once('drain', resolve));
      }

      if (f % 150 === 0) {
        console.log(`   Progres render: ${Math.round((f / totalFrame) * 100)}% (${f}/${totalFrame} frame)`);
      }
    }

    ff.stdin.end();
    await new Promise((resolve, reject) => {
      ff.on('close', code => code === 0 ? resolve() : reject(new Error('FFmpeg keluar dengan kode ' + code)));
      ff.on('error', reject);
    });
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(`   (render selesai, ${detikBerjalan()} detik berjalan)`);

  const ukuranFile = fs.statSync('video_jadi.mp4').size;
  let durasiTeks = '-';
  try {
    const d = parseFloat(execSync('ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 video_jadi.mp4').toString().trim());
    if (!isNaN(d)) durasiTeks = d.toFixed(1) + ' detik';
  } catch (e) { /* abaikan */ }

  const infoYoutube = `🎬 VIDEO 3D V30.0 SELESAI DIRENDER!\n\n📌 Judul:\n${videoData.title}\n\n📝 Deskripsi:\n${videoData.desc}\n\n📚 Sumber:\n${videoData.src.map(s => '- ' + s).join('\n')}\n\n🏷️ Tags:\n${videoData.tags}`;

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

  await kirimPesanTelegram(infoYoutube + infoTeknis);
  console.log('Selesai! Video sudah dikirim ke Telegram.');
}

main().catch(async err => {
  console.error(err);
  await kirimPesanTelegram('⚠️ Pabrik Video gagal merender: ' + err.message);
  process.exit(1);
});
