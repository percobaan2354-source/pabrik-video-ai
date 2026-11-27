/* ===== SCRIPT UTAMA: buat_video.js (Versi V52.0: Klip HD Terpotong 9:16, Sampul Sesuai Judul, Tanpa CTA, Render Terpadu) ===== */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
const PIXABAY_API_KEY = (process.env.PIXABAY_API_KEY || '').trim();
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const JUDUL = process.env.INPUT_JUDUL || process.env.JUDUL || 'Fakta Unik yang Jarang Diketahui';
const BAHASA = process.env.INPUT_BAHASA || process.env.BAHASA || 'Indonesia';
const UKURAN = process.env.INPUT_UKURAN || process.env.UKURAN || '9:16';

// V52: RES_SCALE=1 -> 720x1280 (cepat, uji coba). RES_SCALE=1.5 -> 1080x1920 (HD, lebih berat). Hanya untuk 9:16.
const RES_SCALE_ENV = Math.min(1.5, Math.max(1, Number(process.env.RES_SCALE) || 1));
// V52: keterangan transparansi di kartu akhir. Isi kosong ('') untuk menyembunyikan. Contoh: 'Visual ilustrasi (stok) • Narasi suara AI'
const DISCLOSURE_ENV = process.env.DISCLOSURE;

const COVER_HOLD_SEC = 1.65;

if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY belum diisi di Secrets!');
  process.exit(1);
}

// V52: ukuran frame klip hasil ekstraksi (diisi di proses utama sesuai ukuran video + RES_SCALE)
let FRAME_W = 720;
let FRAME_H = 1280;

function getDimensi(ukuran) {
  const u = (ukuran || '9:16').trim();
  if (u === '16:9') return { width: 1280, height: 720, aspect: '16/9', isVertical: false };
  if (u === '1:1')  return { width: 1080, height: 1080, aspect: '1/1', isVertical: false };
  if (u === '4:5')  return { width: 1080, height: 1350, aspect: '4/5', isVertical: true };
  return { width: 720, height: 1280, aspect: '9/16', isVertical: true };
}

function getBahasaConfig(bahasa) {
  const b = (bahasa || 'indonesia').toLowerCase().trim();
  if (b.includes('inggris') || b.includes('english') || b === 'en') return { langCode: 'en-US', gttsLang: 'en', edgeVoice: 'en-US-AndrewMultilingualNeural' };
  if (b.includes('jepang') || b.includes('japan') || b === 'ja') return { langCode: 'ja-JP', gttsLang: 'ja', edgeVoice: 'ja-JP-KeitaNeural' };
  if (b.includes('korea') || b === 'ko') return { langCode: 'ko-KR', gttsLang: 'ko', edgeVoice: 'ko-KR-InJoonNeural' };
  if (b.includes('arab') || b === 'ar') return { langCode: 'ar-SA', gttsLang: 'ar', edgeVoice: 'ar-SA-HamedNeural' };
  if (b.includes('spanyol') || b.includes('spanish') || b === 'es') return { langCode: 'es-ES', gttsLang: 'es', edgeVoice: 'es-ES-AlvaroNeural' };
  if (b.includes('jerman') || b.includes('german') || b === 'de') return { langCode: 'de-DE', gttsLang: 'de', edgeVoice: 'de-DE-ConradNeural' };
  if (b.includes('prancis') || b.includes('french') || b === 'fr') return { langCode: 'fr-FR', gttsLang: 'fr', edgeVoice: 'fr-FR-HenriNeural' };
  if (b.includes('mandarin') || b.includes('china') || b === 'zh') return { langCode: 'zh-CN', gttsLang: 'zh-CN', edgeVoice: 'zh-CN-YunxiNeural' };
  if (b.includes('malay') || b === 'ms') return { langCode: 'ms-MY', gttsLang: 'ms', edgeVoice: 'ms-MY-OsmanNeural' };
  return { langCode: 'id-ID', gttsLang: 'id', edgeVoice: 'id-ID-ArdiNeural' };
}

const tunggu = (ms) => new Promise(r => setTimeout(r, ms));

async function kirimPesanTelegram(pesan) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: pesan, parse_mode: 'Markdown' })
    });
  } catch (e) {
    console.error('Gagal kirim pesan Telegram:', e.message);
  }
}

function deteksiPrimeTimeHariIni() {
  const now = new Date();
  const jamWib = (now.getUTCHours() + 7) % 24;
  const hari = now.getDay();
  let targetJamRamai = 18;
  if (hari === 0 || hari === 6) targetJamRamai = 16;
  else if (hari === 5) targetJamRamai = 20;
  return { jamWib, targetJamRamai };
}

function pilihTemaVisualDariJudul(judul) {
  const q = (judul || '').toLowerCase();
  const presets = [
    { re: /tidur|bangun|mimpi|alarm|malam|sirkadian|insomnia|otak|saraf|ditatap|mata/, theme: { name: 'night_neuro', bg1: '#0b132b', bg2: '#1c2541', card: '#141e38', accent: '#38bdf8', accent2: '#f59e0b', text: '#f8fafc' } },
    { re: /sains|fisika|kimia|atom|listrik|energi|cahaya|gelombang|teknologi|robot|ai\b|kuantum/, theme: { name: 'cyber_lab', bg1: '#071921', bg2: '#0f2e3d', card: '#0d2633', accent: '#06b6d4', accent2: '#22c55e', text: '#ecfeff' } },
    { re: /sejarah|kuno|kerajaan|romawi|mesir|abad|dinasti|piramida|perang|nusantara|katedral|istana/, theme: { name: 'ancient_gold', bg1: '#1c140d', bg2: '#332214', card: '#291b10', accent: '#f59e0b', accent2: '#ef4444', text: '#fef3c7' } },
    { re: /alam|hewan|laut|hutan|gunung|bumi|samudra|tumbuhan|ikan|burung|cuaca|mercusuar|layangan/, theme: { name: 'emerald_wild', bg1: '#062019', bg2: '#0e3b2e', card: '#0a2e24', accent: '#10b981', accent2: '#eab308', text: '#ecfdf5' } },
    { re: /horor|misteri|hantu|mistis|angker|rahasia|gelap|hilang|konspirasi/, theme: { name: 'crimson_mystery', bg1: '#180912', bg2: '#2e1022', card: '#240c1a', accent: '#f43f5e', accent2: '#a855f7', text: '#fff1f2' } },
    { re: /bisnis|uang|kaya|sukses|ekonomi|saham|emas|kerja|miliarder|makan|lapar/, theme: { name: 'royal_wealth', bg1: '#0f172a', bg2: '#1e293b', card: '#162033', accent: '#eab308', accent2: '#38bdf8', text: '#f8fafc' } }
  ];
  for (const p of presets) {
    if (p.re.test(q)) return p.theme;
  }
  return { name: 'indigo_spark', bg1: '#0f172a', bg2: '#1e293b', card: '#141e38', accent: '#38bdf8', accent2: '#f59e0b', text: '#f8fafc' };
}

function rapikanNaskah(data, dim, ttsInfo) {
  if (!data || typeof data !== 'object') throw new Error('Naskah dari Gemini bukan objek JSON yang valid.');
  if (!Array.isArray(data.lines)) throw new Error('Naskah dari Gemini tidak punya array "lines".');

  data.lines = data.lines.filter(l => Array.isArray(l) && l.length >= 3 && typeof l[2] === 'string' && l[2].trim() !== '');
  // V52: CTA dihapus total. Baris ber-kunci "cta" dibuang supaya VO-nya juga tidak ikut terbaca.
  data.lines = data.lines.filter(l => String(l[0] || '').toLowerCase() !== 'cta');
  if (data.lines.length < 4) throw new Error('Naskah dari Gemini terlalu pendek / format "lines" rusak.');

  data.lines = data.lines.map((l) => {
    const sc = l[0] || 'b1';
    const mood = l[1] || 'n';
    const text = l[2].trim();
    const fx = l[3] || '';
    let meta = (l[4] && typeof l[4] === 'object') ? l[4] : {};

    if (sc !== 'end') {
      if (!meta.mode) {
        meta.mode = (sc === 'title' || sc === 'a' || sc === 'c') ? 'pip_broll' : 'full_broll';
      }
      if (!meta.videoQuery && meta.query) meta.videoQuery = meta.query;
      meta.videoQuery = String(meta.videoQuery || '').trim();
      meta.altQuery = String(meta.altQuery || '').trim();
      let kw = meta.keywords;
      if (typeof kw === 'string') kw = kw.split(',');
      if (!Array.isArray(kw)) kw = [];
      meta.keywords = [...new Set(kw.map(k => String(k || '').trim()).filter(Boolean))].slice(0, 5);
      if (!meta.videoQuery && meta.keywords.length) meta.videoQuery = meta.keywords[0];
      // PENTING: sengaja TIDAK ada query cadangan topik umum / 'nature' (biar visual tidak maksa di luar VO)
    } else {
      meta = null;
    }
    return [sc, mood, text, fx, meta];
  });

  const defaultTx = {
    kicker: 'FAKTA UNIK',
    t1: 'FAKTA',
    t2: 'MENGEJUTKAN',
    watch: 'tonton sampai habis',
    src: 'Sumber'
  };

  data.tx = Object.assign({}, defaultTx, (data.tx && typeof data.tx === 'object') ? data.tx : {});
  if (typeof data.title !== 'string' || !data.title.trim()) data.title = JUDUL;
  if (typeof data.desc  !== 'string' || !data.desc.trim())  data.desc  = `${data.title} - tonton sampai habis dan tulis pendapatmu di komentar!`;
  if (typeof data.tags  !== 'string' || !data.tags.trim())  data.tags  = '#faktaunik #edukasi #storytelling';
  if (!Array.isArray(data.src) || data.src.length === 0) data.src = ['Sumber Terverifikasi'];
  if (!data.varian) data.varian = 'v' + (Date.now() % 999);
  data.coverQuery = bersihkanQuery(data.coverQuery || '');

  if (dim.aspect === '9/16') {
    if (!data.title.toLowerCase().includes('#shorts')) data.title += ' #Shorts';
    if (!data.tags.toLowerCase().includes('#shorts')) data.tags += ' #Shorts';
  }

  data.visualTheme = (data.visualTheme && typeof data.visualTheme === 'object' && data.visualTheme.accent)
    ? Object.assign(pilihTemaVisualDariJudul(JUDUL), data.visualTheme)
    : pilihTemaVisualDariJudul(JUDUL);

  data.lang = ttsInfo.langCode;
  data.width = dim.width;
  data.height = dim.height;
  data.coverHold = COVER_HOLD_SEC;
  if (DISCLOSURE_ENV !== undefined) data.disclosure = DISCLOSURE_ENV;
  if (PIXABAY_API_KEY) data.pixabayApiKey = PIXABAY_API_KEY;
  return data;
}

/* ===== PIXABAY VIDEO DOWNLOADER + FRAME SEQUENCE EXTRACTOR (V52: HD + potong 9:16 langsung dari sumber) ===== */
function curlGetJson(url) {
  try {
    const out = execSync(
      `curl -sL --max-time 18 -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" "${url}"`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    return JSON.parse(out);
  } catch (_) {
    return null;
  }
}

// Filter ffmpeg: potong tengah sesuai rasio video (dengan sisa 20% lebar supaya Ken Burns masih bisa geser), lalu skala ke tinggi frame.
// Dikerjakan LANGSUNG dari file asli Pixabay (bukan dari mp4 hasil kompres ulang) supaya tajam.
function filterFrameKlip() {
  const rasio = FRAME_W / FRAME_H;
  if (rasio < 1) return `crop='min(iw,ih*${rasio.toFixed(5)}*1.2)':ih,scale=-2:${FRAME_H}:flags=lanczos`;
  return `scale=${FRAME_W}:-2:flags=lanczos`;
}

function downloadAndNormalizeVideo(url, rawFile, finalMp4, idx, maxSec = 6) {
  try {
    execSync(
      `curl -sL --fail --max-time 60 -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" "${url}" -o "${rawFile}"`,
      { stdio: 'pipe' }
    );
    if (!fs.existsSync(rawFile) || fs.statSync(rawFile).size < 10000) {
      if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile);
      return null;
    }
    const vf = filterFrameKlip();

    // mp4 hanya cadangan kalau frame gagal dimuat browser
    execSync(
      `ffmpeg -y -i "${rawFile}" -an -t ${maxSec} -vf "${vf},fps=30" -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -movflags +faststart "${finalMp4}"`,
      { stdio: 'pipe' }
    );
    if (!fs.existsSync(finalMp4) || fs.statSync(finalMp4).size <= 8000) {
      try { fs.unlinkSync(rawFile); } catch (_) {}
      return null;
    }

    // Frame JPEG 15fps dari FILE ASLI (kualitas -q:v 3). Template V52 mem-blend antar frame supaya gerakan halus.
    const frameDir = `media/clip_${idx}_frames`;
    fs.rmSync(frameDir, { recursive: true, force: true });
    fs.mkdirSync(frameDir, { recursive: true });
    execSync(
      `ffmpeg -y -i "${rawFile}" -an -t ${maxSec} -vf "${vf},fps=15" -q:v 3 "${frameDir}/f_%03d.jpg"`,
      { stdio: 'pipe' }
    );
    try { fs.unlinkSync(rawFile); } catch (_) {}
    const frameFiles = fs.readdirSync(frameDir)
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .map(f => `${frameDir}/${f}`);
    if (!frameFiles.length) return null;

    return { mp4: finalMp4, frames: frameFiles, fps: 15 };
  } catch (_) {
    try { if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile); } catch (__) {}
    try { if (fs.existsSync(finalMp4)) fs.unlinkSync(finalMp4); } catch (__) {}
    return null;
  }
}

function downloadPhotoFallback(url, outFile) {
  try {
    execSync(
      `curl -sL --fail --max-time 30 -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" "${url}" -o "${outFile}"`,
      { stdio: 'pipe' }
    );
    if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 4096) {
      if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
      return false;
    }
    const head = fs.readFileSync(outFile, { encoding: 'utf8', flag: 'r' }).slice(0, 80).toLowerCase();
    if (head.includes('<!doctype') || head.includes('<html')) {
      fs.unlinkSync(outFile);
      return false;
    }
    return true;
  } catch (_) {
    try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch (__) {}
    return false;
  }
}

/* ===== PENCARIAN PIXABAY 2 TAHAP + CEK KESESUAIAN ===== */
const ALLOW_PHOTO_FALLBACK = true; // true = kalau video tidak ada tapi FOTO yang sesuai VO ada, pakai foto. false = langsung kartu teks.
const KATA_UMUM = new Set(['the','a','an','of','in','on','at','and','with','for','to','person','people','man','woman','men','women','human','someone','view','scene','video','background','close','up','slow','motion']);

function bersihkanQuery(query) {
  return (query || '').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Kata inti dari query (tanpa kata umum). Dipakai untuk memastikan hasil Pixabay benar2 nyambung dengan query.
function kataIntiQuery(query) {
  return bersihkanQuery(query).toLowerCase().split(' ').filter(w => w.length >= 3 && !KATA_UMUM.has(w));
}

function stem(w) {
  return w.length > 5 ? w.slice(0, 5) : (w.length > 4 ? w.slice(0, 4) : w);
}

// Hasil dianggap relevan kalau minimal 1 kata inti query muncul di tag / slug halaman hasil Pixabay.
function hitRelevan(hit, query) {
  const inti = kataIntiQuery(query);
  if (!inti.length) return true;
  const hay = ((hit.tags || '') + ' ' + (hit.pageURL || '')).toLowerCase();
  return inti.some(w => hay.includes(stem(w)));
}

// V52: pilih versi video yang paling dekat 1080p (dulu selalu 'small' = burik). 4K dihindari karena berat.
function pilihUrlVideoTerbaik(h) {
  const v = h.videos || {};
  const kandidat = ['large', 'medium', 'small', 'tiny'].map(k => v[k]).filter(x => x && x.url);
  if (!kandidat.length) return '';
  const penalti = (x) => {
    const tinggi = Number(x.height) || 0;
    if (!tinggi) return 5000;
    return tinggi >= 1080 ? (tinggi - 1080) : (1080 - tinggi) * 3;
  };
  kandidat.sort((a, b) => penalti(a) - penalti(b));
  return kandidat[0].url;
}

const PIXABAY_VIDEO_CACHE = {};
function cariVideoPixabay(query) {
  if (!PIXABAY_API_KEY) return [];
  const qClean = bersihkanQuery(query);
  if (!qClean) return [];
  const key = qClean.toLowerCase();
  if (PIXABAY_VIDEO_CACHE[key]) return PIXABAY_VIDEO_CACHE[key];

  const base = `https://pixabay.com/api/videos/?key=${encodeURIComponent(PIXABAY_API_KEY)}&q=${encodeURIComponent(qClean)}&safesearch=true&per_page=20`;
  let hasil = [];
  // coba resolusi tinggi dulu, turun bertahap kalau hasilnya sedikit
  for (const extra of ['&min_width=1920&min_height=1080', '&min_width=1280&min_height=720', '']) {
    const vJson = curlGetJson(base + extra);
    const hits = (vJson && Array.isArray(vJson.hits)) ? vJson.hits : [];
    hasil = hits
      .slice()
      .sort((a, b) => ((b.duration >= 6) - (a.duration >= 6)))
      .map(h => ({ url: pilihUrlVideoTerbaik(h), tags: h.tags || '', pageURL: h.pageURL || '' }))
      .filter(h => h.url && hitRelevan(h, qClean));
    if (hasil.length >= 2) break;
  }

  PIXABAY_VIDEO_CACHE[key] = hasil;
  return hasil;
}

const PIXABAY_FOTO_CACHE = {};
function cariFotoPixabay(query) {
  if (!PIXABAY_API_KEY) return [];
  const qClean = bersihkanQuery(query);
  if (!qClean) return [];
  const key = qClean.toLowerCase();
  if (PIXABAY_FOTO_CACHE[key]) return PIXABAY_FOTO_CACHE[key];

  const base = `https://pixabay.com/api/?key=${encodeURIComponent(PIXABAY_API_KEY)}&q=${encodeURIComponent(qClean)}&image_type=photo&safesearch=true&per_page=10`;
  let hasil = [];
  for (const extra of ['&min_width=1080', '']) {
    const pJson = curlGetJson(base + extra);
    // V52: largeImageURL dulu (webformatURL cuma 640px = burik)
    hasil = ((pJson && pJson.hits) || [])
      .map(h => ({ url: h.largeImageURL || h.webformatURL || '', tags: h.tags || '', pageURL: h.pageURL || '' }))
      .filter(h => h.url && hitRelevan(h, qClean));
    if (hasil.length >= 2) break;
  }

  PIXABAY_FOTO_CACHE[key] = hasil;
  return hasil;
}

async function siapkanMediaPixabayLokal(videoData) {
  fs.mkdirSync('media', { recursive: true });
  if (!PIXABAY_API_KEY) {
    console.warn('PERINGATAN: PIXABAY_API_KEY kosong di GitHub Secrets!');
  } else {
    console.log(`PIXABAY_API_KEY aktif (${PIXABAY_API_KEY.slice(0, 6)}...). Cari video sesuai VO: Tahap 1 (naskah) -> Tahap 2 (keyword terdekat).`);
  }

  const usedUrls = new Set();
  let berhasilT1 = 0, berhasilT2 = 0, berhasilFoto = 0;
  const tanpaMedia = [];

  for (let i = 0; i < videoData.lines.length; i++) {
    const l = videoData.lines[i];
    const sc = l[0];
    if (sc === 'end') continue;

    const meta = (l[4] && typeof l[4] === 'object') ? l[4] : (l[4] = {});
    meta.noMedia = false;

    // TAHAP 1: deteksi lewat naskah (adegan persis dari kalimat VO)
    const tahap1 = [...new Set([meta.videoQuery, meta.altQuery].map(q => bersihkanQuery(q)).filter(Boolean))];
    // TAHAP 2: deteksi lewat keyword yang paling mendekati isi VO (BUKAN topik umum / nature)
    const tahap2 = [...new Set((meta.keywords || []).map(q => bersihkanQuery(q)).filter(Boolean))]
      .filter(q => !tahap1.map(x => x.toLowerCase()).includes(q.toLowerCase()));

    console.log(`   [Baris ${i + 1}] VO: "${l[2].replace(/\*/g, '')}"`);
    console.log(`             Tahap 1 (naskah)  : ${tahap1.join(' | ') || '-'}`);
    console.log(`             Tahap 2 (keyword) : ${tahap2.join(' | ') || '-'}`);

    const urutan = [
      ...tahap1.map(q => ({ q, tahap: 1 })),
      ...tahap2.map(q => ({ q, tahap: 2 }))
    ];

    let videoOk = false;
    let cadanganPakaiUlang = null; // klip yang relevan tapi sudah dipakai baris lain (dipakai hanya kalau tidak ada yang baru)

    for (const { q: qTry, tahap } of urutan) {
      const hits = cariVideoPixabay(qTry);
      if (!hits.length) {
        console.log(`             - "${qTry}" (tahap ${tahap}): tidak ada video yang nyambung`);
        continue;
      }
      const belumDipakai = hits.filter(h => !usedUrls.has(h.url));
      if (!belumDipakai.length && !cadanganPakaiUlang) cadanganPakaiUlang = { hit: hits[0], qTry, tahap };

      for (const chosen of belumDipakai.slice(0, 3)) {
        const rawFile = `media/raw_${i}.mp4`;
        const finalMp4 = `media/clip_${i}.mp4`;
        const normRes = downloadAndNormalizeVideo(chosen.url, rawFile, finalMp4, i);
        if (normRes) {
          usedUrls.add(chosen.url);
          meta.videoUrl = normRes.mp4;
          meta.videoFrames = normRes.frames;
          meta.videoFps = normRes.fps;
          meta.matchTahap = tahap;
          meta.matchQuery = qTry;
          if (tahap === 1) berhasilT1++; else berhasilT2++;
          videoOk = true;
          console.log(`   [Baris ${i + 1}] SUKSES Video (Tahap ${tahap}, "${qTry}", tag: ${chosen.tags}) -> ${finalMp4} (${normRes.frames.length} frame)`);
          break;
        }
      }
      if (videoOk) break;
    }

    if (!videoOk && cadanganPakaiUlang) {
      const { hit, qTry, tahap } = cadanganPakaiUlang;
      const rawFile = `media/raw_${i}.mp4`;
      const finalMp4 = `media/clip_${i}.mp4`;
      const normRes = downloadAndNormalizeVideo(hit.url, rawFile, finalMp4, i);
      if (normRes) {
        meta.videoUrl = normRes.mp4;
        meta.videoFrames = normRes.frames;
        meta.videoFps = normRes.fps;
        meta.matchTahap = tahap;
        meta.matchQuery = qTry;
        if (tahap === 1) berhasilT1++; else berhasilT2++;
        videoOk = true;
        console.log(`   [Baris ${i + 1}] SUKSES Video pakai ulang klip relevan (Tahap ${tahap}, "${qTry}") -> ${finalMp4}`);
      }
    }

    if (videoOk) continue;

    // Video tidak ada yang pas -> coba FOTO dengan query yang SAMA (tetap sesuai VO, bukan topik acak)
    let fotoOk = false;
    if (ALLOW_PHOTO_FALLBACK) {
      for (const { q: qTry, tahap } of urutan) {
        const pHits = cariFotoPixabay(qTry);
        const chosenP = pHits.find(h => !usedUrls.has(h.url)) || pHits[0];
        if (!chosenP) continue;
        const localJpg = `media/photo_${i}.jpg`;
        if (downloadPhotoFallback(chosenP.url, localJpg)) {
          usedUrls.add(chosenP.url);
          meta.photoUrl = localJpg;
          meta.matchTahap = tahap;
          meta.matchQuery = qTry;
          berhasilFoto++;
          fotoOk = true;
          console.log(`   [Baris ${i + 1}] SUKSES Foto (Tahap ${tahap}, "${qTry}", tag: ${chosenP.tags}) -> ${localJpg}`);
          break;
        }
      }
    }

    if (!fotoOk) {
      // TIDAK MEMAKSA: tidak ada visual yang nyambung -> template V52 melanjutkan klip sebelumnya / kartu teks, bukan klip acak
      meta.noMedia = true;
      tanpaMedia.push(i + 1);
      console.log(`   [Baris ${i + 1}] TIDAK ADA visual Pixabay yang pas dengan VO -> tidak dipaksa.`);
    }
  }

  console.log(`Ringkasan B-Roll: Tahap 1 (naskah) ${berhasilT1} video | Tahap 2 (keyword) ${berhasilT2} video | Foto ${berhasilFoto} | Tanpa visual ${tanpaMedia.length}${tanpaMedia.length ? ' -> baris ' + tanpaMedia.join(', ') : ''}`);
}

// V52: visual sampul khusus yang menyesuaikan JUDUL (coverQuery dari Gemini). Kalau gagal, template memakai klip baris pertama.
async function siapkanVisualSampul(videoData) {
  if (!PIXABAY_API_KEY || !videoData.coverQuery) return;
  const kandidatQuery = [videoData.coverQuery];
  const first = videoData.lines[0] && videoData.lines[0][4];
  if (first && first.videoQuery) kandidatQuery.push(first.videoQuery);

  for (const q of kandidatQuery) {
    const hits = cariVideoPixabay(q);
    for (const chosen of hits.slice(0, 3)) {
      const res = downloadAndNormalizeVideo(chosen.url, 'media/raw_cover.mp4', 'media/clip_cover.mp4', 'cover', 3);
      if (res) {
        videoData.coverFrames = res.frames;
        videoData.coverFps = res.fps;
        console.log(`   [Sampul] SUKSES visual sampul "${q}" (tag: ${chosen.tags}) -> ${res.frames.length} frame`);
        return;
      }
    }
  }
  console.log('   [Sampul] Tidak ada visual khusus, template memakai klip baris pertama.');
}

async function buatNaskahJSON(dim, ttsInfo) {
  const jumlahKalimat = dim.isVertical
    ? '9-11 kalimat storytelling santai & mengalir (maksimal 9-12 kata per kalimat agar total durasi baca 38-50 detik)'
    : '12-15 kalimat padat dan informatif (untuk video landscape 16:9)';

  const prompt = `Kamu adalah sutradara video dokumenter & editor B-Roll Pixabay profesional.
Buatkan data video lengkap dalam format JSON MURNI (tanpa markdown/teks pembuka) untuk topik:
- Judul: "${JUDUL}"
- Bahasa Video: ${BAHASA} (kode BCP-47: ${ttsInfo.langCode})
- Ukuran: ${UKURAN} (${dim.width}x${dim.height})

ATURAN ORIGINALITAS (WAJIB, supaya video layak monetisasi YouTube dan tidak terlihat produksi massal):
- Narasi harus punya SUDUT PANDANG dan analisis sendiri, bukan rangkuman generik. Sertakan detail spesifik (nama, angka, tempat, penyebab-akibat) yang masuk akal.
- Kalimat pertama adalah hook yang kuat dan spesifik, bukan pertanyaan klise. Kalimat terakhir memberi insight atau pertanyaan yang memancing diskusi.
- Jangan menyalin teks dari sumber mana pun. Jangan mengarang fakta, nama, atau kutipan. Kalau tidak bisa diverifikasi, gunakan frasa seperti "menurut cerita yang beredar".
- Jangan klaim "kisah nyata" atau "terbukti" kalau tidak yakin. Judul dan isi tidak boleh menyesatkan (tanpa clickbait bohong).
- Variasikan struktur dan jumlah adegan antar video. DILARANG membuat adegan ajakan membeli/menjual/promosi apa pun (tidak ada CTA).

ATURAN KERAS PENCARIAN VIDEO PIXABAY (WAJIB DIPATUHI):
Pixabay HANYA paham kata kunci visual konkret dalam BAHASA INGGRIS (kata benda/aksi nyata yang bisa direkam kamera).
Untuk SETIAP kalimat VO, isi 3 field berikut. Visual HARUS menggambarkan isi kalimat VO itu, JANGAN pernah visual yang tidak nyambung:
1. "videoQuery" = TAHAP 1 (deteksi dari naskah): adegan PERSIS yang diucapkan di kalimat VO, 2-3 kata Inggris.
   - VO: "Ada orang lain yang berlayar" -> "videoQuery": "person sailing boat"
   - VO: "Orang bermain layangan di lapangan" -> "videoQuery": "flying kite park"
2. "altQuery" = TAHAP 1 versi lain dari adegan YANG SAMA (sinonim/sudut pandang lain, tetap isi VO yang sama): misal "sailing ship ocean".
3. "keywords" = TAHAP 2 (cadangan kalau tahap 1 tidak ketemu): array 3-5 keyword Inggris pendek (1-2 kata), urut dari yang PALING MENDEKATI suara VO.
   - VO: "Ada orang lain yang berlayar" -> "keywords": ["sailing", "steering ship", "boat captain", "sailboat sea"]
   - DILARANG keyword umum/tidak nyambung seperti "nature", "landscape", "people lifestyle", "city", "sky clouds" kalau VO tidak membahasnya.
   - DILARANG istilah abstrak/medis/kimia ("ghrelin hormone", "amygdala", "dopamine molecule"); ganti dengan adegan kamera nyata yang paling dekat artinya.
   - Kalau kalimat sangat abstrak, tetap tulis keyword konkret terdekat dengan isi kalimat. Kalau Pixabay tidak punya, sistem tidak akan memaksa visual asal-asalan.
4. "coverQuery" (di level atas JSON) = adegan visual sinematik untuk SAMPUL yang paling mewakili JUDUL, 2-3 kata Inggris konkret (contoh judul tentang ayah yang berjalan jauh demi anak -> "father walking road").
5. Variasikan mode visual antara "pip_broll" (video B-Roll di kotak atas + karakter utama reaction di bawah) pada "title", "a", "c", dan "full_broll" (video B-Roll layar penuh) pada "b1" sampai "b6".
6. Buat ${jumlahKalimat} di array "lines":
   Format: ["kunci_adegan", "mood", "Kalimat VO dengan *kata* ditekankan.", "fx_opsional", META_VISUAL]
   Kunci adegan yang boleh dipakai (urut, sesuai kebutuhan): "title" (pertama), "b1", "b2", "a", "b3", "b4", "b5", "b6", "c", lalu "end" (terakhir, META_VISUAL null). DILARANG memakai kunci "cta".

KELUARKAN HANYA JSON DENGAN STRUKTUR INI:
{
  "title": "Judul Menarik Sesuai Bahasa",
  "varian": "v${Date.now() % 999}",
  "lang": "${ttsInfo.langCode}",
  "width": ${dim.width},
  "height": ${dim.height},
  "desc": "Deskripsi singkat 2 kalimat + ajakan diskusi di komentar.",
  "tags": "#faktaunik #edukasi #storytelling",
  "src": ["Sumber Riset 1", "Sumber Riset 2"],
  "coverQuery": "scene that matches the title",
  "visualTheme": {
    "name": "tema_unik",
    "bg1": "#0b132b",
    "bg2": "#1c2541",
    "card": "#141e38",
    "accent": "#38bdf8",
    "accent2": "#f59e0b",
    "text": "#f8fafc"
  },
  "tx": {
    "kicker": "FAKTA UNIK",
    "t1": "KATA ATAS",
    "t2": "KATA BAWAH?",
    "watch": "tonton sampai habis",
    "src": "Sumber"
  },
  "lines": [
    ["title", "d", "Kalimat pembuka dengan *kata kunci* sesuai judul.", "", {"mode":"pip_broll","videoQuery":"exact scene from this VO","altQuery":"same scene other words","keywords":["closest keyword","next closest","next closest"],"kicker":"FENOMENA","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["b1", "n", "Kalimat kedua sesuai topik.", "p", {"mode":"full_broll","videoQuery":"exact scene from this VO","altQuery":"same scene other words","keywords":["closest keyword","next closest","next closest"],"kicker":"FAKTA","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["b2", "e", "Kalimat ketiga sesuai topik.", "p", {"mode":"full_broll","videoQuery":"exact scene from this VO","altQuery":"same scene other words","keywords":["closest keyword","next closest","next closest"],"kicker":"PROSES","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["a", "n", "Kalimat keempat dari karakter.", "", {"mode":"pip_broll","videoQuery":"exact scene from this VO","altQuery":"same scene other words","keywords":["closest keyword","next closest","next closest"],"kicker":"DETAIL","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["b3", "d", "Kalimat kelima sesuai topik.", "p", {"mode":"full_broll","videoQuery":"exact scene from this VO","altQuery":"same scene other words","keywords":["closest keyword","next closest","next closest"],"kicker":"SAINS","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["b4", "e", "Kalimat keenam sesuai topik.", "p", {"mode":"full_broll","videoQuery":"exact scene from this VO","altQuery":"same scene other words","keywords":["closest keyword","next closest","next closest"],"kicker":"DAMPAK","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["b5", "d", "Kalimat ketujuh kesimpulan visual.", "p", {"mode":"full_broll","videoQuery":"exact scene from this VO","altQuery":"same scene other words","keywords":["closest keyword","next closest","next closest"],"kicker":"KESIMPULAN","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
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
      if (valid.length > 0) models = [...new Set([...models, ...valid])];
    }
  } catch (e) {}

  for (let putaran = 1; putaran <= 3; putaran++) {
    for (const model of models) {
      try {
        console.log(`Putaran ${putaran}: mencoba ${model}...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(65000),
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
      } catch (err) {}
    }
    await tunggu(4000);
  }
  throw new Error('Gagal menghasilkan naskah dari Gemini API.');
}

function parseElevenLabsAlignment(fullText, lineRanges, alignment) {
  if (!alignment || !Array.isArray(alignment.characters) || !Array.isArray(alignment.character_start_times_seconds)) return null;
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds || starts;
  const joinedAlign = chars.join('');

  const lineTimings = [];
  let searchCursor = 0;

  for (let idx = 0; idx < lineRanges.length; idx++) {
    const lr = lineRanges[idx];
    const cleanLine = lr.cleanText;
    let foundIdx = joinedAlign.indexOf(cleanLine, searchCursor);
    if (foundIdx === -1) foundIdx = lr.startChar;

    const endCharIdx = Math.min(chars.length - 1, foundIdx + cleanLine.length - 1);
    const ss = starts[foundIdx] ?? (idx > 0 ? lineTimings[idx - 1].se + 0.05 : 0);
    const se = ends[endCharIdx] ?? (ss + 1.5);
    searchCursor = Math.min(chars.length, foundIdx + cleanLine.length);

    const words = lr.words;
    const wordTimes = [];
    let wCursor = foundIdx;
    for (let w = 0; w < words.length; w++) {
      const wClean = words[w];
      let wPos = joinedAlign.indexOf(wClean, wCursor);
      if (wPos === -1 || wPos > endCharIdx + 2) wPos = Math.min(endCharIdx, wCursor);
      const wEndPos = Math.min(endCharIdx, wPos + Math.max(0, wClean.length - 1));
      const ws = starts[wPos] ?? ss;
      const we = ends[wEndPos] ?? se;
      wordTimes.push([Number(ws.toFixed(3)), Number(Math.max(ws + 0.04, we).toFixed(3))]);
      wCursor = Math.min(chars.length, wPos + wClean.length);
    }

    lineTimings.push({
      ss: Number(ss.toFixed(3)),
      se: Number(Math.max(ss + 0.25, se).toFixed(3)),
      wordTimes
    });
  }
  return lineTimings;
}

async function buatAudioElevenLabs(lines, outPath) {
  if (!ELEVENLABS_API_KEY) return null;

  const lineRanges = [];
  let fullText = '';
  for (let i = 0; i < lines.length; i++) {
    const clean = lines[i][2].replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    const words = clean.split(' ').filter(Boolean);
    const startChar = fullText.length;
    fullText += clean;
    const endChar = fullText.length;
    lineRanges.push({ cleanText: clean, words, startChar, endChar });
    if (i < lines.length - 1) fullText += '\n';
  }

  const modelsToTry = ['eleven_multilingual_v2', 'eleven_flash_v2_5'];
  for (const modelId of modelsToTry) {
    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/with-timestamps?output_format=mp3_44100_128`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({
          text: fullText,
          model_id: modelId,
          voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.35, use_speaker_boost: true }
        })
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (!json.audio_base64) continue;

      fs.writeFileSync(outPath, Buffer.from(json.audio_base64, 'base64'));
      const alignment = json.normalized_alignment || json.alignment;
      return parseElevenLabsAlignment(fullText, lineRanges, alignment);
    } catch (err) {}
  }
  return null;
}

async function buatAudioTTS(lines, outPath, ttsInfo) {
  const elTimings = await buatAudioElevenLabs(lines, outPath);
  if (elTimings && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) return elTimings;

  const teksBersih = lines.map(l => l[2].replace(/\*/g, '').trim()).join(' ... ');
  fs.writeFileSync('naskah_vo.txt', teksBersih, 'utf8');
  try {
    execSync(`edge-tts --voice "${ttsInfo.edgeVoice}" --rate="+4%" --file naskah_vo.txt --write-media "${outPath}"`, { stdio: 'inherit' });
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) return null;
  } catch (e) {}

  const pyCmd = `python3 -c "from gtts import gTTS; text=open('naskah_vo.txt').read(); gTTS(text=text, lang='${ttsInfo.gttsLang}').save('${outPath}')"`;
  execSync(pyCmd, { stdio: 'inherit' });
  return null;
}

function pilihBgmSkalaDariJudul(judul, seedNum) {
  const q = (judul || '').toLowerCase();
  const genreScales = [
    { re: /kamar mandi|mandi|keramik|gema|reverb|akustik|nyanyi|air|laut/, notes: [293.66, 349.23, 440.00, 523.25], tempo: 1.35, lp: 1350 },
    { re: /horor|hantu|mistis|angker|kuburan|kutukan|misteri|gelap|malam|tidur|alarm|hilang|mercusuar/, notes: [146.83, 174.61, 220.00, 261.63], tempo: 0.85, lp: 780 },
    { re: /sejarah|kuno|kerajaan|romawi|mesir|abad|dinasti|piramida|perang|nusantara|katedral|istana|bangun/, notes: [220.00, 261.63, 293.66, 392.00], tempo: 0.95, lp: 920 },
    { re: /sains|antariksa|planet|teknologi|robot|ai\b|kuantum|listrik|lampu/, notes: [261.63, 311.13, 392.00, 466.16], tempo: 1.50, lp: 1500 },
    { re: /psikologi|otak|pikiran|mental|stres|mimpi|kebiasaan|menguap|mulut|etika|ditatap|mata/, notes: [246.94, 293.66, 369.99, 440.00], tempo: 0.90, lp: 850 },
    { re: /bisnis|sukses|kaya|miliarder|saham|uang|ekonomi|emas/, notes: [261.63, 329.63, 392.00, 523.25], tempo: 1.40, lp: 1250 },
    { re: /perang|bencana|gempa|tsunami|api|bahaya|bertahan/, notes: [164.81, 196.00, 220.00, 246.94], tempo: 1.25, lp: 800 }
  ];
  for (const g of genreScales) {
    if (g.re.test(q)) return g;
  }
  const fallbackPool = [
    { notes: [261.63, 329.63, 392.00, 493.88], tempo: 1.15, lp: 950 },
    { notes: [293.66, 369.99, 440.00, 554.37], tempo: 1.25, lp: 1100 },
    { notes: [196.00, 246.94, 293.66, 369.99], tempo: 1.00, lp: 880 },
    { notes: [220.00, 277.18, 329.63, 415.30], tempo: 1.30, lp: 1050 }
  ];
  return fallbackPool[seedNum % fallbackPool.length];
}

function mixAudioWithBgmAndSfx(voPath, sceneTimes, totalLenSec, seedNum, outWavPath, judulVideo = '') {
  const bgmTemp = 'bgm_temp.wav';
  const sfxTemp = 'sfx_temp.wav';

  const bgmSpec = pilihBgmSkalaDariJudul(judulVideo, seedNum);
  const notes = bgmSpec.notes;
  const shift = 1 + ((seedNum % 5) - 2) * 0.025;
  const fA = (notes[0] * shift).toFixed(2);
  const fB = (notes[1] * shift).toFixed(2);
  const fC = (notes[2] * shift).toFixed(2);
  const fBass = (notes[0] * 0.5 * shift).toFixed(2);
  const rate = bgmSpec.tempo.toFixed(2);

  execSync(
    `ffmpeg -y -f lavfi -i "sine=frequency=${fA}:duration=${totalLenSec}" ` +
    `-f lavfi -i "sine=frequency=${fB}:duration=${totalLenSec}" ` +
    `-f lavfi -i "sine=frequency=${fC}:duration=${totalLenSec}" ` +
    `-f lavfi -i "sine=frequency=${fBass}:duration=${totalLenSec}" ` +
    `-filter_complex "` +
    `[0:a]aeval='val(0)*max(0,sin(2*PI*${rate}*t))':c=same,volume=0.075[a0];` +
    `[1:a]aeval='val(0)*max(0,sin(2*PI*${rate}*t+2.1))':c=same,volume=0.065[a1];` +
    `[2:a]aeval='val(0)*max(0,sin(2*PI*${rate}*t+4.2))':c=same,volume=0.065[a2];` +
    `[3:a]volume=0.085[a3];` +
    `[a0][a1][a2][a3]amix=inputs=4:normalize=0,lowpass=f=${bgmSpec.lp},aecho=0.8:0.7:180:0.35[out]" ` +
    `-map "[out]" -ar 44100 -ac 2 "${bgmTemp}"`,
    { stdio: 'pipe' }
  );

  const triggers = [];
  const usedScenes = new Set();
  for (const st of sceneTimes) {
    if (!usedScenes.has(st.sc) && st.t0 > 0.1) {
      usedScenes.add(st.sc);
      triggers.push({ t: st.t0, type: st.fx || 'whoosh' });
    } else if (st.fx === 'c' || st.fx === 'p') {
      triggers.push({ t: st.t0, type: st.fx });
    }
  }

  if (triggers.length > 0) {
    const inputs = [`-f lavfi -i "anullsrc=r=44100:cl=stereo:d=${totalLenSec}"`];
    const filters = [];
    const activeTr = triggers.slice(0, 14);
    activeTr.forEach((tr, idx) => {
      const delayMs = Math.max(0, Math.round(tr.t * 1000));
      if (tr.type === 'c') {
        inputs.push(`-f lavfi -i "sine=frequency=1174.66:duration=0.28"`);
        filters.push(`[${idx + 1}:a]afade=t=in:ss=0:d=0.015,afade=t=out:st=0.06:d=0.22,volume=0.35,adelay=${delayMs}|${delayMs}[s${idx}]`);
      } else if (tr.type === 'p') {
        inputs.push(`-f lavfi -i "sine=frequency=780:duration=0.14"`);
        filters.push(`[${idx + 1}:a]afade=t=in:ss=0:d=0.01,afade=t=out:st=0.03:d=0.11,volume=0.38,adelay=${delayMs}|${delayMs}[s${idx}]`);
      } else {
        inputs.push(`-f lavfi -i "anoisesrc=color=pink:duration=0.30:amplitude=0.5"`);
        filters.push(`[${idx + 1}:a]bandpass=f=750:width_type=h:w=900,afade=t=in:ss=0:d=0.08,afade=t=out:st=0.12:d=0.18,volume=0.85,adelay=${delayMs}|${delayMs}[s${idx}]`);
      }
    });
    const mixLabels = ['[0:a]', ...activeTr.map((_, i) => `[s${i}]`)].join('');
    filters.push(`${mixLabels}amix=inputs=${activeTr.length + 1}:normalize=0[sfxout]`);

    execSync(
      `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filters.join(';')}" -map "[sfxout]" -ar 44100 -ac 2 "${sfxTemp}"`,
      { stdio: 'pipe' }
    );
  } else {
    execSync(`ffmpeg -y -f lavfi -i "anullsrc=r=44100:cl=stereo:d=${totalLenSec}" -ar 44100 -ac 2 "${sfxTemp}"`, { stdio: 'pipe' });
  }

  const voDelayMs = Math.round(COVER_HOLD_SEC * 1000);
  execSync(
    `ffmpeg -y -i "${voPath}" -i "${bgmTemp}" -i "${sfxTemp}" ` +
    `-filter_complex "[0:a]adelay=${voDelayMs}|${voDelayMs},apad=whole_dur=${totalLenSec},volume=1.25[vo];[1:a]volume=1.0[bgm];[2:a]volume=1.15[sfx];[vo][bgm][sfx]amix=inputs=3:normalize=0,alimiter=limit=0.96[final]" ` +
    `-map "[final]" -t ${totalLenSec} -ar 44100 -ac 2 "${outWavPath}"`,
    { stdio: 'pipe' }
  );
}

function mulaiServerLokal(dir) {
  const mime = {
    '.html': 'text/html', '.js': 'application/javascript',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.json': 'application/json'
  };
  const server = http.createServer((req, res) => {
    const cleanUrl = decodeURIComponent((req.url || '/').split('?')[0]);
    const filePath = path.join(dir, cleanUrl === '/' ? 'index.html' : cleanUrl);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const range = req.headers.range;
      if (range && (ext === '.mp4' || ext === '.webm')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10) || 0;
        const end = (parts[1] && parts[1].trim() !== '') ? parseInt(parts[1], 10) : stat.size - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': (end - start) + 1,
          'Content-Type': mime[ext] || 'video/mp4'
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Accept-Ranges': 'bytes',
          'Content-Length': stat.size,
          'Content-Type': mime[ext] || 'application/octet-stream'
        });
        fs.createReadStream(filePath).pipe(res);
      }
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function cariFileKarakter() {
  const kandidat = ['karakter.png', 'character.png', 'char.png', 'avatar.png', 'karakter.webp', 'character.webp'];
  for (const f of kandidat) {
    if (fs.existsSync(f)) return f;
  }
  return '';
}

async function kirimVideoTelegram(videoPath, data) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  console.log('Mengirim hasil video ke Telegram...');
  const caption = `🎬 *VIDEO V52.0 (KLIP HD, SAMPUL SESUAI JUDUL, TANPA CTA) SELESAI!*\n\n📍 *Judul:*\n${data.title}\n\n📝 *Deskripsi:*\n${data.desc}\n\n📚 *Sumber:*\n${(data.src || []).map(s => '- ' + s).join('\n')}\n\n🏷️ *Tags:*\n${data.tags}\n\n⚠️ *Sebelum upload:* cek isi fakta, dan isi pertanyaan "konten ubahan/sintetis" di YouTube Studio sesuai kondisi (misal suara AI).`;

  try {
    const form = new FormData();
    form.append('chat_id', TELEGRAM_CHAT_ID);
    form.append('caption', caption.slice(0, 1024));
    form.append('parse_mode', 'Markdown');
    form.append('video', new Blob([fs.readFileSync(videoPath)], { type: 'video/mp4' }), 'video_cerita.mp4');

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`, { method: 'POST', body: form });
    const json = await res.json();
    if (!json.ok) console.error('Gagal kirim video Telegram:', json);
    else console.log('Sukses kirim video ke Telegram!');
  } catch (e) {
    console.error('Error kirim video Telegram:', e.message);
  }
}

(async () => {
  try {
    const dim = getDimensi(UKURAN);
    const ttsInfo = getBahasaConfig(BAHASA);
    const { jamWib, targetJamRamai } = deteksiPrimeTimeHariIni();

    // V52: skala render (hanya 9:16). Canvas template, viewport browser, frame klip, dan output ffmpeg semuanya ikut skala ini.
    const resScale = (dim.aspect === '9/16') ? RES_SCALE_ENV : 1;
    const outW = Math.round(dim.width * resScale);
    const outH = Math.round(dim.height * resScale);
    FRAME_W = outW;
    FRAME_H = outH;

    console.log(`=== MEMULAI PRODUKSI VIDEO V52.0 (${UKURAN} | ${BAHASA} | output ${outW}x${outH}) ===`);
    if (jamWib > targetJamRamai) {
      await kirimPesanTelegram(`⚠️ *STATUS: PENDING / ANTREAN GESER*\n\nKamu membuat video pada pukul ${jamWib}:00 WIB (melewati jam ramai ${targetJamRamai}:00 WIB hari ini).\nSistem otomatis menggeser jadwal publikasi ke slot prime time berikutnya!`);
    } else {
      await kirimPesanTelegram(`🔔 *INFO PRA-RAMAI*\n\nJam ramai hari ini terdeteksi pukul *${targetJamRamai}:00 WIB*. Video sedang diproses tepat waktu!`);
    }

    console.log('1. Menyusun naskah & kata kunci video nyata sesuai tiap kalimat VO...');
    const videoData = await buatNaskahJSON(dim, ttsInfo);
    videoData.resScale = resScale;

    console.log('2. Mengunduh video asli Pixabay (HD) & memotong sesuai rasio video...');
    await siapkanMediaPixabayLokal(videoData);
    await siapkanVisualSampul(videoData);

    console.log('3. Membuat suara Voice Over...');
    const exactTimings = await buatAudioTTS(videoData.lines, 'vo.mp3', ttsInfo);
    if (exactTimings) videoData.lineTimings = exactTimings;

    videoData.audioUrl = 'vo.mp3';
    const charFile = cariFileKarakter();
    if (charFile) videoData.charUrl = charFile;

    await kirimPesanTelegram(`✅ *Naskah, video B-Roll Pixabay, & suara VO selesai.*\nSekarang merender video HD + karakter reaction...`);

    console.log('4. Merakit index.html dari template.html...');
    let tpl = fs.readFileSync('template.html', 'utf8');
    const safeTitle = videoData.title.replace(/"/g, '&quot;');
    const safeJson = JSON.stringify(videoData).replace(/<\/script>/gi, '<\\/script>');

    tpl = tpl.replace('__TITLE__', () => safeTitle)
             .replace('__ASPECT__', () => dim.aspect)
             .replace('__VIDEO_DATA_JSON__', () => safeJson)
             .replace(/__PIXABAY_API_KEY__/g, () => PIXABAY_API_KEY);

    const serverCleanCss = `<style>
      .poster, .bar, .tl, .toast { display: none !important; opacity: 0 !important; visibility: hidden !important; }
      body, .app, .frame { width: ${outW}px !important; height: ${outH}px !important; max-width: none !important; padding: 0 !important; margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
      canvas#cv { width: ${outW}px !important; height: ${outH}px !important; }
    </style></head>`;
    tpl = tpl.replace('</head>', () => serverCleanCss);

    const renderBridgeScript = `<script>
      window.__ASSETS_READY = false;
      window.__VIDEO_LEN = typeof LEN !== 'undefined' ? LEN : 40;
      window.__SCENE_TIMES = [];
      let __bridgePrevLine = -1;

      window.__renderFrameAt = async function(tSec) {
        // V52: bekukan loop animasi bawaan supaya tidak menimpa frame yang sedang dirender
        window.__FREEZE = true;
        if (typeof playing !== 'undefined') playing = false;
        if (typeof LEN !== 'undefined') window.__VIDEO_LEN = LEN;
        const t = Math.min(Math.max(0, Number(tSec) || 0), window.__VIDEO_LEN);
        if (typeof tm !== 'undefined') tm = t;
        if (typeof A !== 'undefined') A = t;
        if (typeof DT !== 'undefined') DT = 1 / 30;
        if (typeof lineAt === 'function' && typeof COVER_HOLD !== 'undefined') {
          li = t < COVER_HOLD ? 0 : lineAt(t);
        }
        const curSc = (typeof COVER_HOLD !== 'undefined' && t < COVER_HOLD) ? 'cover' : (L[li] ? L[li][0] : 'a');
        if ((typeof pScene !== 'undefined' && pScene !== curSc) || __bridgePrevLine !== li) {
          trT = t;
          trDir = (li % 2 === 0) ? 1 : -1;
          pScene = curSc;
          __bridgePrevLine = li;
        }

        if (typeof LINE_BROLL_MAP !== 'undefined' && LINE_BROLL_MAP[li] && typeof COVER_HOLD !== 'undefined' && t >= COVER_HOLD) {
          const item = LINE_BROLL_MAP[li];
          const cur = L[li];
          const hasSeq = Boolean(item && item.frameImgs && item.frameImgs.length > 0);
          if (!hasSeq && item && item.videoEl && item.videoReady && cur && item.videoEl.duration && Number.isFinite(item.videoEl.duration)) {
            const relT = Math.max(0, t - cur.t0) % item.videoEl.duration;
            if (Math.abs(item.videoEl.currentTime - relT) > 0.025) {
              await new Promise(resolve => {
                let done = false;
                const fin = () => { if (!done) { done = true; resolve(); } };
                item.videoEl.addEventListener('seeked', fin, { once: true });
                setTimeout(fin, 250);
                try { item.videoEl.currentTime = relT; } catch (_) { fin(); }
              });
            }
          }
        }

        if (typeof now !== 'undefined') now = t;
        if (typeof charTick === 'function') charTick();
        // V52: skala canvas (resScale) — wajib sama seperti loop bawaan template
        if (typeof PORT !== 'undefined' && PORT) X.setTransform(CW / W, 0, 0, CH / H, 0, 0);
        X.save();
        X.clearRect(0, 0, W, H);
        const fn = (typeof SCN !== 'undefined' && SCN[curSc]) ? SCN[curSc] : (typeof SCN !== 'undefined' ? SCN.a : null);
        const lineStart = (L[li] && typeof L[li].t0 === 'number') ? L[li].t0 : 0;
        if (fn) fn((typeof COVER_HOLD !== 'undefined' && t < COVER_HOLD) ? t : Math.max(0, t - lineStart));
        X.restore();
        if (typeof drawSubs === 'function') drawSubs();
        if (typeof drawWatermark === 'function') drawWatermark();
        if (typeof ov !== 'undefined') X.drawImage(ov, 0, 0, W, H);
        if (typeof PORT !== 'undefined' && !PORT && typeof composeFrame === 'function') composeFrame();
      };

      (function waitReadyPoll(){
        const iv = setInterval(async () => {
          if (window.__READY__ === true || window.__APP_READY__ === true) {
            clearInterval(iv);
            if (typeof LEN !== 'undefined') window.__VIDEO_LEN = LEN;
            if (typeof L !== 'undefined') {
              window.__SCENE_TIMES = L.map(x => ({ sc: x[0], t0: x.t0 || 0, fx: x[3] || '' }));
            }
            window.__ASSETS_READY = true;
          }
        }, 50);
      })();
    </script></body>`;
    tpl = tpl.replace('</body>', () => renderBridgeScript);
    fs.writeFileSync('index.html', tpl, 'utf8');

    console.log('5. Menjalankan browser & merekam frame video HD...');
    const { server, port } = await mulaiServerLokal(process.cwd());
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    });
    const page = await browser.newPage({
      viewport: { width: outW, height: outH },
      deviceScaleFactor: 1
    });

    const pageErrors = [];
    page.on('pageerror', err => {
      pageErrors.push(err.message);
      console.error('Browser PageError:', err.message);
    });
    await page.goto(`http://127.0.0.1:${port}/index.html?autorender=1`, { waitUntil: 'domcontentloaded' });

    try {
      await page.waitForFunction(() => window.__ASSETS_READY === true, { timeout: 120000 });
    } catch (e) {
      try { await browser.close(); } catch (_) {}
      try { server.close(); } catch (_) {}
      if (pageErrors.length > 0) {
        throw new Error('Template.html error di browser: ' + pageErrors.slice(0, 3).join(' | '));
      }
      throw e;
    }

    const mediaStats = await page.evaluate(() => {
      const items = Object.values(window.LINE_BROLL_MAP || {});
      return {
        total: items.length,
        vidReady: items.filter(x => x && (x.videoReady || (x.frameImgs && x.frameImgs.length > 0))).length,
        picReady: items.filter(x => x && x.photoReady).length
      };
    });
    console.log(`Status Browser Media: ${mediaStats.vidReady} video aktif, ${mediaStats.picReady} foto aktif dari ${mediaStats.total} adegan.`);

    const totalLenSec = await page.evaluate(() => window.__VIDEO_LEN);
    const sceneTimes = await page.evaluate(() => window.__SCENE_TIMES || []);
    const fps = 30;
    const totalFrames = Math.ceil(totalLenSec * fps);

    console.log(`Total durasi: ${totalLenSec} detik (${totalFrames} frame pada ${fps}fps)...`);
    fs.rmSync('frames', { recursive: true, force: true });
    fs.mkdirSync('frames', { recursive: true });

    for (let f = 0; f < totalFrames; f++) {
      const tSec = f / fps;
      await page.evaluate((t) => window.__renderFrameAt(t), tSec);
      const framePath = path.join('frames', `f_${String(f).padStart(5, '0')}.jpg`);
      await page.screenshot({
        path: framePath,
        type: 'jpeg',
        quality: 95,
        clip: { x: 0, y: 0, width: outW, height: outH }
      });
      if (f % 150 === 0) console.log(`Render progress: ${f}/${totalFrames} frame...`);
    }

    await browser.close();
    server.close();

    console.log('6. Menggabungkan BGM + SFX + VO & merender MP4 final...');
    const seedNum = Array.from(videoData.title).reduce((a, c) => a + c.charCodeAt(0), 0);
    mixAudioWithBgmAndSfx('vo.mp3', sceneTimes, totalLenSec, seedNum, 'mixed_audio.wav', videoData.title);

    execSync(
      `ffmpeg -y -framerate ${fps} -i frames/f_%05d.jpg -i mixed_audio.wav ` +
      `-vf "scale=${outW}:${outH}:flags=lanczos,setsar=1" ` +
      `-c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest output_final.mp4`,
      { stdio: 'inherit' }
    );

    console.log('7. Mengirim hasil video ke Telegram...');
    await kirimVideoTelegram('output_final.mp4', videoData);

    console.log('=== SEMUA PROSES SELESAI 100%! ===');
  } catch (err) {
    console.error('TERJADI ERROR:', err);
    await kirimPesanTelegram(`❌ *GAGAL RENDER VIDEO!*\n\nError: \`${err.message}\``);
    process.exit(1);
  }
})();
