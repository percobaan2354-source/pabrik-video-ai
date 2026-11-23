const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, spawn } = require('child_process');
const { chromium } = require('playwright');

const GEMINI_API_KEY        = (process.env.GEMINI_API_KEY || '').trim();
const TELEGRAM_TOKEN        = (process.env.TELEGRAM_TOKEN || '').trim();
const TELEGRAM_CHAT_ID      = (process.env.TELEGRAM_CHAT_ID || '').trim();
const ELEVENLABS_API_KEY    = (process.env.ELEVENLABS_API_KEY || '').trim();
const ELEVENLABS_VOICE_ID   = (process.env.ELEVENLABS_VOICE_ID || 'nPczCjzI2devNBz1zQrb').trim();
const YOUTUBE_CLIENT_ID     = (process.env.YOUTUBE_CLIENT_ID || '').trim();
const YOUTUBE_CLIENT_SECRET = (process.env.YOUTUBE_CLIENT_SECRET || '').trim();
const YOUTUBE_REFRESH_TOKEN = (process.env.YOUTUBE_REFRESH_TOKEN || '').trim();

const JUDUL  = (process.env.INPUT_JUDUL  || "Kenapa Kita Merem Saat Bersin?").trim();
const UKURAN = (process.env.INPUT_UKURAN || "9:16").trim();
const BAHASA = (process.env.INPUT_BAHASA || "Indonesia").trim();

const COVER_HOLD_SEC = 1.35; // Jeda sampul di awal sebelum VO & subtitle dimulai

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

/* ===== GENERATOR AUDIO BACKSOUND LEMBUT & SFX WHOOSH SOSMED REALISTIS (WAV) ===== */
function generateBgmAndSfxWav(filePath, durationSec, videoData, sceneTimes) {
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

  for (let i = 0; i < numSamples; i++) {
    const t = i / sr;
    const step = Math.floor(t / beatDur);
    const localT = t - step * beatDur;
    const env = Math.sin(Math.min(1, localT / 0.06) * (Math.PI / 2)) * Math.exp(-localT * 2.1);

    const freq = scale[(step + (seed % 4)) % scale.length];
    const bassFreq = scale[0] * 0.5;
    const bassEnv = Math.exp(-((t % (beatDur * 2)) * 1.6));

    const lead = (Math.sin(2 * Math.PI * freq * t) * 0.70 + Math.sin(2 * Math.PI * freq * 2 * t) * 0.20) * env * 0.062;
    const pad = Math.sin(2 * Math.PI * (freq * 0.5) * t + 0.4) * 0.028;
    const bass = Math.sin(2 * Math.PI * bassFreq * t) * bassEnv * 0.050;

    const pan = Math.sin(t * 0.7) * 0.25;
    left[i]  = (lead * (1 - pan)) + pad + bass;
    right[i] = (lead * (1 + pan)) + pad + bass;
  }

  let rngState = (seed ^ 0x9e3779b9) >>> 0;
  function nextNoise() {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    return ((rngState >>> 0) / 2147483648) - 1;
  }

  function addRealWhooshSfx(startSec, variant) {
    const startSample = Math.floor(startSec * sr);
    const sfxLen = Math.floor(0.30 * sr);
    const v = variant % 3;

    let y1 = 0, y2 = 0, x1 = 0, x2 = 0;
    for (let j = 0; j < sfxLen && (startSample + j) < numSamples; j++) {
      const u = j / sfxLen;
      const env = Math.sin(Math.pow(u, 0.75) * Math.PI);
      const rawNoise = nextNoise();

      const fc = v === 0
        ? (350 + Math.pow(u, 1.3) * 2050)
        : (v === 1 ? (2600 * Math.pow(0.16, u)) : (400 + u * 2400));
      const Q = v === 1 ? 3.2 : 2.1;

      const w0 = (2 * Math.PI * fc) / sr;
      const alpha = Math.sin(w0) / (2 * Q);
      const b0 = alpha, b1 = 0, b2 = -alpha;
      const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;

      const y = (b0 / a0) * rawNoise + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
      x2 = x1; x1 = rawNoise;
      y2 = y1; y1 = y;

      let sampleVal = y * env * 2.6;

      if (v === 2 && u > 0.12) {
        const cu = (u - 0.12) / 0.88;
        const chime = Math.sin(2 * Math.PI * 1318.5 * (j / sr)) * Math.exp(-cu * 5.5) * 0.18;
        sampleVal += chime;
      }

      const stereoPan = v === 0 ? (u - 0.5) * 0.4 : (0.5 - u) * 0.4;
      left[startSample + j]  += sampleVal * (1 - stereoPan);
      right[startSample + j] += sampleVal * (1 + stereoPan);
    }
  }

  const transitions = [];
  let prevSc = null;
  (sceneTimes || []).forEach((st) => {
    if (st.sc !== prevSc) {
      prevSc = st.sc;
      transitions.push(st.t0);
    }
  });

  transitions.forEach((tSec, idx) => {
    addRealWhooshSfx(Math.max(0.05, tSec - 0.04), idx);
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

/* ===== MODUL AUTO-UPLOAD YOUTUBE DATA API V3 ===== */
async function getYouTubeAccessToken() {
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
    throw new Error('Secrets YouTube (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN) kosong atau belum dipetakan di workflow YAML.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
      refresh_token: YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Gagal menukar Refresh Token YouTube: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function uploadKeYouTube(filePath, videoData) {
  console.log('5/5 Mengunggah video otomatis ke YouTube...');
  const accessToken = await getYouTubeAccessToken();
  const fileSize = fs.statSync(filePath).size;

  const fullDescription =
    `${videoData.desc}\n\n` +
    `Sumber:\n${(videoData.src || []).map(s => '- ' + s).join('\n')}\n\n` +
    `${videoData.tags}`;

  const cleanTags = (videoData.tags || '')
    .split(/[\s,]+/)
    .map(t => t.replace(/^#/, '').trim())
    .filter(Boolean)
    .slice(0, 15);

  const metadata = {
    snippet: {
      title: (videoData.title || JUDUL).slice(0, 100),
      description: fullDescription.slice(0, 4900),
      tags: cleanTags,
      categoryId: '27' // 27 = Education
    },
    status: {
      privacyStatus: 'public', // Akan otomatis terkunci Private jika aplikasi OAuth belum terverifikasi
      selfDeclaredMadeForKids: false
    }
  };

  // Langkah A: Inisiasi Resumable Upload
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(fileSize),
        'X-Upload-Content-Type': 'video/mp4'
      },
      body: JSON.stringify(metadata)
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Gagal inisiasi upload YouTube (${initRes.status}): ${errText}`);
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new Error('URL resumable upload tidak diterima dari YouTube.');
  }

  // Langkah B: Kirim file biner video_jadi.mp4
  const videoBuffer = fs.readFileSync(filePath);
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(fileSize),
      'Content-Type': 'video/mp4'
    },
    body: videoBuffer
  });

  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.id) {
    throw new Error(`Gagal upload file ke YouTube (${uploadRes.status}): ${JSON.stringify(uploadData)}`);
  }

  const isShort = (videoData.width < videoData.height);
  const videoUrl = isShort
    ? `https://youtube.com/shorts/${uploadData.id}`
    : `https://youtu.be/${uploadData.id}`;

  console.log(`   (Upload YouTube selesai! ID: ${uploadData.id}, Status: ${uploadData.status?.privacyStatus})`);
  return {
    id: uploadData.id,
    url: videoUrl,
    privacyStatus: uploadData.status?.privacyStatus || 'private'
  };
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

  data.lang      = ttsInfo.langCode;
  data.width     = dim.width;
  data.height    = dim.height;
  data.coverHold = COVER_HOLD_SEC;
  return data;
}

async function buatNaskahJSON(dim, ttsInfo) {
  const jumlahKalimat = dim.isVertical
    ? '9-10 kalimat storytelling santai & mengalir (maksimal 10-12 kata per kalimat agar total durasi baca 38-50 detik)'
    : '12-15 kalimat padat dan informatif (untuk video landscape 16:9)';

  const prompt = `Kamu adalah penulis skrip & sutradara video animasi storytelling 3D V33.0.
Buatkan data lengkap dalam format JSON MURNI (tanpa teks pembuka/penutup) untuk video berikut:
- Judul: "${JUDUL}"
- Bahasa Video: ${BAHASA} (kode BCP-47: ${ttsInfo.langCode})
- Ukuran: ${UKURAN} (${dim.width}x${dim.height})

ATURAN KETAT V33.0 (WAJIB SINKRON NASKAH VO <-> VISUAL B-ROLL):
1. Gaya bahasa wajib seperti bercerita santai (*storytelling* yang enak didengar, mengalir alami, tidak kaku) dalam bahasa ${BAHASA}.
2. Buat ${jumlahKalimat} di dalam array "lines". Berikan tanda koma/titik yang jelas antar kalimat agar jeda intonasi suara terdeteksi presisi.
   Format tiap elemen: ["kunci_adegan", "mood", "Kalimat VO dengan *kata* ditekankan.", "fx_opsional", {"obj":"kata kunci objek di kalimat VO","kicker":"KATEGORI","title":"JUDUL 2 KATA SESUAI VO","sub":"Penjelasan singkat 3-4 kata sesuai VO"}]
   - Kunci adegan WAJIB menggunakan urutan ini:
     * "title" (1 baris pembuka langsung ke topik utama yang santai & bikin penasaran)
     * "b1" (1-2 baris visual B-Roll full layar pertama — visual WAJIB menggambarkan persis apa yang diucapkan VO pada baris "b1" ini!)
     * "a" (1-2 baris cerita utama dari karakter)
     * "b2" (1-2 baris visual B-Roll kotak kecil — visual WAJIB menggambarkan persis apa yang diucapkan VO pada baris "b2" ini, dan WAJIB berbeda dari b1!)
     * "b3" (1-2 baris visual B-Roll full layar kedua — visual WAJIB menggambarkan persis apa yang diucapkan VO pada baris "b3" ini, dan WAJIB berbeda dari b1 & b2!)
     * "cta" (2 baris ajakan di TENGAH video: baris 1 "Mau bikin video kayak gini juga?" dan baris 2 "Langsung aja cek *link di bio*.")
     * "c" (1-2 baris sudut pandang / refleksi karakter)
     * "b4" (1-2 baris visual B-Roll full layar ketiga — visual WAJIB menggambarkan persis apa yang diucapkan VO pada baris "b4" ini, dan WAJIB berbeda dari b1, b2, & b3!)
     * "end" (1 baris penutup berkesan TANPA CTA)
   - Contoh konsistensi VO & elemen ke-5 pada adegan B-Roll:
     * Jika VO di b1 berkata: "Banyak yang menyangka lubang ini biar *tinta* nggak macet." -> elemen ke-5 wajib: {"obj":"tinta pena","kicker":"MITOS UMUM","title":"TINTA & PENA","sub":"Anggapan Soal Tinta Kering"}
     * Jika VO di b1 berkata: "Bayangkan ada *topi melayang* di udara tanpa tali." -> elemen ke-5 wajib: {"obj":"topi melayang","kicker":"ILUSI VISUAL","title":"TOPI MELAYANG","sub":"Melayang Bebas di Udara"}
   - Mood: "n" (santai), "d" (dramatis), "e" (semangat), "s" (tenang).
   - FX opsional (boleh kosong ""): "c" (lonceng di baris kedua cta), "p" (pop).
3. "tx":
   - "kicker": kategori singkat 1-2 kata (contoh: "SAINS TUBUH", "FAKTA UNIK", "PSIKOLOGI", "SEJARAH").
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
    ["title", "d", "Kalimat pembuka pertama dengan *penekanan*.", "", null],
    ["b1", "n", "Kalimat visual pertama sesuai naskah.", "p", {"obj":"objek utama vo","kicker":"FAKTA UTAMA","title":"JUDUL B1","sub":"Keterangan B1"}],
    ["a", "n", "Kalimat fakta utama dari karakter.", "", null],
    ["b2", "e", "Kalimat detail mikro sesuai naskah.", "p", {"obj":"objek mikro vo","kicker":"DETAIL MIKRO","title":"JUDUL B2","sub":"Keterangan B2"}],
    ["b3", "d", "Kalimat mekanisme sesuai naskah.", "", {"obj":"objek mekanisme vo","kicker":"MEKANISME","title":"JUDUL B3","sub":"Keterangan B3"}],
    ["cta", "n", "Mau bikin video kayak gini juga?", "", null],
    ["cta", "e", "Langsung aja cek *link di bio*.", "c", null],
    ["c", "n", "Kalimat sudut pandang dan refleksi.", "", null],
    ["b4", "d", "Kalimat puncak bukti sesuai naskah.", "", {"obj":"objek puncak vo","kicker":"BUKTI NYATA","title":"JUDUL B4","sub":"Keterangan B4"}],
    ["end", "s", "Kalimat penutup yang meninggalkan *kesan*.", "", null]
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
  console.log(`Mulai produksi V33.0: "${JUDUL}" (${UKURAN}, ${BAHASA})`);
  const dim = parseUkuran(UKURAN);
  const ttsInfo = pilihSuaraTTS(BAHASA);

  await kirimPesanTelegram(
    `🏭 Pabrik Video 3D V33.0 mulai bekerja!\n\n` +
    `📌 Judul: ${JUDUL}\n` +
    `📐 Ukuran: ${UKURAN} (${dim.width}x${dim.height})\n` +
    `🌐 Bahasa: ${BAHASA}`
  );

  console.log('1/5 Meracik naskah & adegan 3D V33.0...');
  const videoData = await buatNaskahJSON(dim, ttsInfo);
  console.log(`   (naskah selesai, ${detikBerjalan()} detik berjalan, ${videoData.lines.length} kalimat)`);

  fs.writeFileSync('data.json', JSON.stringify(videoData, null, 2), 'utf8');

  console.log('2/5 Membuat suara Voice Over (VO) ElevenLabs...');
  const teksBersih = videoData.lines.map(l => l[2].replace(/\*/g, '')).join(' ');
  await generateVoiceOver(teksBersih);
  console.log(`   (VO selesai, ${detikBerjalan()} detik berjalan)`);
  await kirimPesanTelegram('✅ Naskah & suara VO selesai. Sekarang merender video 3D HD + Watermark @raii.punyacerita...');

  console.log('3/5 Merakit file HTML V33.0...');
  let html = fs.readFileSync('template.html', 'utf8');
  html = html.replace('__TITLE__', videoData.title);
  html = html.replace('__ASPECT__', dim.aspect);
  html = html.replace('__VIDEO_DATA_JSON__', JSON.stringify(videoData));
  fs.writeFileSync('render_siap.html', html, 'utf8');

  console.log('4/5 Merender video HD 30 FPS di cloud...');
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
    const sceneTimes = await page.evaluate(() => window.__SCENE_TIMES || []);
    const fps = 30;
    const totalFrame = Math.ceil(totalDetik * fps);
    console.log(`   Merender ${totalFrame} frame (${totalDetik} detik @ ${fps} FPS)...`);

    generateBgmAndSfxWav('bgm_sfx.wav', totalDetik, videoData, sceneTimes);

    const delayMs = Math.round(COVER_HOLD_SEC * 1000);
    const ffArgs = [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-r', String(fps),
      '-i', 'pipe:0',
      '-i', 'vo.mp3',
      '-i', 'bgm_sfx.wav',
      '-filter_complex', `[1:a]adelay=${delayMs}|${delayMs},volume=1.18[vo];[2:a]volume=1.05[bgm];[vo][bgm]amix=inputs=2:duration=longest:normalize=0[aout]`,
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

  const infoYoutube = `🎬 VIDEO 3D V33.0 SELESAI DIRENDER!\n\n📌 Judul:\n${videoData.title}\n\n📝 Deskripsi:\n${videoData.desc}\n\n📚 Sumber:\n${videoData.src.map(s => '- ' + s).join('\n')}\n\n🏷️ Tags:\n${videoData.tags}`;

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

  // Upload otomatis ke YouTube
  let infoUploadYT = '';
  try {
    const hasilYT = await uploadKeYouTube('video_jadi.mp4', videoData);
    infoUploadYT =
      `\n\n📺 AUTO-UPLOAD YOUTUBE BERHASIL!\n` +
      `🔗 Link: ${hasilYT.url}\n` +
      `🔒 Status: ${hasilYT.privacyStatus.toUpperCase()} (Buka YouTube Studio di HP untuk ubah ke Public)`;
  } catch (ytErr) {
    console.error('Upload YouTube gagal:', ytErr.message);
    infoUploadYT = `\n\n⚠️ Auto-Upload YouTube gagal: ${ytErr.message}`;
  }

  await kirimPesanTelegram(infoYoutube + infoTeknis + infoUploadYT);
  console.log('Selesai! Video sudah dikirim ke Telegram & diproses ke YouTube.');
}

main().catch(async err => {
  console.error(err);
  await kirimPesanTelegram('⚠️ Pabrik Video gagal merender: ' + err.message);
  process.exit(1);
});
