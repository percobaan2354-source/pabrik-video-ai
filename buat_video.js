/* ===== SCRIPT UTAMA: buat_video.js (Versi V55.2: Self-Healing Quality-Gate + Context-Aware Vision Audit + Main-Subject Fallback + Auto Upload YouTube Shorts) ===== */
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

/* Secrets YouTube Data API v3 untuk Auto-Upload Shorts */
const YT_CLIENT_ID = (process.env.YT_CLIENT_ID || '').trim();
const YT_CLIENT_SECRET = (process.env.YT_CLIENT_SECRET || '').trim();
const YT_REFRESH_TOKEN = (process.env.YT_REFRESH_TOKEN || '').trim();
const YT_PRIVACY = (process.env.YT_PRIVACY || 'public').trim();
const YT_PRIVACY_FALLBACK = (process.env.YT_PRIVACY_FALLBACK || 'private').trim();

/* ===== PENGATURAN QUALITY-GATE V55.2 ===== */
const QC_MIN_SCORE = Number(process.env.QC_MIN_SCORE) || 7;
const MAX_VO_SEC = Number(process.env.MAX_VO_SEC) || 52;
const VISION_QC = (process.env.VISION_QC || '1') !== '0';

const RAW_INPUT = (process.env.INPUT_JUDUL || process.env.JUDUL || 'Fakta Unik yang Jarang Diketahui').trim();
const IS_BLUEPRINT = RAW_INPUT.length > 140 || /JUDUL SIAP COPY|BREAKDOWN VISUAL|Keyword Pixabay/i.test(RAW_INPUT);

function ekstrakJudulDariInput(raw) {
  if (!IS_BLUEPRINT) return raw;
  const mJudul = raw.match(/JUDUL SIAP COPY[^:\n]*:\s*\n+([^\n]+)/i)
              || raw.match(/JUDUL[^:\n]*:\s*([^\n]+)/i);
  if (mJudul && mJudul[1]) {
    return mJudul[1].replace(/^[\["'*-\s]+|[\]"'*\s]+$/g, '').trim();
  }
  const barisPertama = raw.split('\n').map(b => b.trim()).find(b => b.length > 8 && !b.startsWith('🎯'));
  return (barisPertama || 'Fakta Dunia Alam & Satwa').slice(0, 100);
}

const JUDUL = ekstrakJudulDariInput(RAW_INPUT);
const BLUEPRINT_TEKS = IS_BLUEPRINT ? RAW_INPUT : '';
const BAHASA = process.env.INPUT_BAHASA || process.env.BAHASA || 'Indonesia';
const UKURAN = process.env.INPUT_UKURAN || process.env.UKURAN || '9:16';

const RES_SCALE_ENV = Math.min(1.5, Math.max(1, Number(process.env.RES_SCALE) || 1));
const DISCLOSURE_ENV = process.env.DISCLOSURE;
const COVER_HOLD_SEC = 1.65;

if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY belum diisi di Secrets!');
  process.exit(1);
}

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
    { re: /tidur|bangun|mimpi|alarm|malam|sirkadian|insomnia|otak|saraf|ditatap|mata/, theme: { name: 'night_neuro', bg1: '#070c18', bg2: '#111b30', card: '#0d1526', accent: '#38bdf8', accent2: '#eab308', text: '#f1f5f9' } },
    { re: /sains|fisika|kimia|atom|listrik|energi|cahaya|gelombang|teknologi|robot|ai\b|kuantum/, theme: { name: 'cyber_lab', bg1: '#051117', bg2: '#0b212b', card: '#091b24', accent: '#22d3ee', accent2: '#34d399', text: '#ecfeff' } },
    { re: /sejarah|kuno|kerajaan|romawi|mesir|abad|dinasti|piramida|perang|nusantara|katedral|istana/, theme: { name: 'ancient_gold', bg1: '#120d08', bg2: '#21170e', card: '#1a120b', accent: '#f59e0b', accent2: '#fb923c', text: '#fef3c7' } },
    { re: /alam|hewan|laut|hutan|gunung|bumi|samudra|tumbuhan|ikan|burung|cuaca|gurita|hiu|paus|ubur|lebah|kupu|serigala|elang|hantu|bunglon|katak/, theme: { name: 'emerald_wild', bg1: '#051410', bg2: '#0b261f', card: '#081e18', accent: '#10b981', accent2: '#eab308', text: '#ecfdf5' } },
    { re: /horor|misteri|hantu|mistis|angker|rahasia|gelap|hilang|konspirasi/, theme: { name: 'crimson_mystery', bg1: '#11060d', bg2: '#210b18', card: '#190812', accent: '#fb7185', accent2: '#c084fc', text: '#fff1f2' } },
    { re: /bisnis|uang|kaya|sukses|ekonomi|saham|emas|kerja|miliarder|makan|lapar|tukang pos|surat|desa|tabung|rumah/, theme: { name: 'royal_wealth', bg1: '#090e1a', bg2: '#131c31', card: '#0f172a', accent: '#eab308', accent2: '#38bdf8', text: '#f8fafc' } }
  ];
  for (const p of presets) {
    if (p.re.test(q)) return p.theme;
  }
  return { name: 'emerald_wild', bg1: '#051410', bg2: '#0b261f', card: '#081e18', accent: '#10b981', accent2: '#eab308', text: '#ecfdf5' };
}

function cekAturanKonten(judul, lines) {
  const re = /\b(pacar|pacaran|pasangan|kekasih|percintaan|romansa|romantis|pernikahan|menikah|suami|istri|mantan|patah hati|selingkuh)\b/i;
  const teks = [judul, ...(lines || []).map(l => (l && l[2]) || '')].join(' ');
  const m = teks.match(re);
  if (m) throw new Error(`Topik melanggar aturan niche (terdeteksi kata "${m[0]}"). Video dibatalkan otomatis, tidak diupload.`);
}

let MODEL_CACHE = null;
async function ambilDaftarModel() {
  if (MODEL_CACHE) return MODEL_CACHE;
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
  MODEL_CACHE = models;
  return models;
}

async function geminiGenerate(parts, { timeoutMs = 65000, rounds = 1, maxModels = 99 } = {}) {
  const models = (await ambilDaftarModel()).slice(0, maxModels);
  for (let r = 1; r <= rounds; r++) {
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({ contents: [{ parts }] })
        });
        const json = await res.json();
        const p = json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts;
        const teks = Array.isArray(p) ? p.map(x => x.text || '').join('').trim() : '';
        if (teks) return teks;
      } catch (_) {}
    }
    if (r < rounds) await tunggu(4000);
  }
  return null;
}

function ekstrakJson(raw) {
  if (!raw) return null;
  const awal = raw.indexOf('{');
  const akhir = raw.lastIndexOf('}');
  if (awal === -1 || akhir === -1) return null;
  try { return JSON.parse(raw.slice(awal, akhir + 1)); } catch (_) { return null; }
}

/* ===== V55.2: PARSER BLUEPRINT LOKAL (MENDUKUNG FORMAT V1 MAUPUN V2 SATWA LIAR) ===== */
function bersihBp(s) {
  return String(s || '').replace(/[\[\]"“”]/g, '').replace(/\*\*/g, '').trim();
}

function parseBlueprint(raw) {
  try {
    const ambil = (re) => { const m = raw.match(re); return m ? bersihBp(m[1]) : ''; };
    const t1 = ambil(/Teks Atas Sampul\s*:\s*([^\n]+)/i);
    const t2 = ambil(/Teks Bawah Sampul\s*:\s*([^\n]+)/i);
    const coverQuery = ambil(/Keyword Pixabay Sampul Utama\s*:\s*([^\n]+)/i);
    const coverAlt = ambil(/Keyword Pixabay Sampul Backup\s*:\s*([^\n]+)/i);

    const MOOD = { title: 'd', b1: 'n', b2: 'e', a: 'n', b3: 'd', b4: 'e', b5: 'n', b6: 'e', c: 'd', end: 's' };
    const FX = { b1: 'p', b2: 'p', b3: 'p', b4: 'p', b5: 'p', b6: 'p' };
    const KICKER = { title: 'FENOMENA', b1: 'FAKTA', b2: 'FAKTA', a: 'SAINS ALAM', b3: 'MEKANISME', b4: 'DETAIL', b5: 'DAMPAK', b6: 'DAMPAK', c: 'INSIGHT' };

    const blok = raw.split(/\n\s*\d+\.\s*\[/).slice(1);
    const lines = [];
    for (const b of blok) {
      const head = b.match(/^\s*([a-z0-9]+)(?:\s*[-–—]\s*([^\]\n]*))?\]/i);
      if (!head) continue;
      const sc = head[1].toLowerCase();
      const judulLayarField = bersihBp((b.match(/Judul Layar\s*:\s*([^\n]+)/i) || [])[1]);
      const label = (judulLayarField || bersihBp(head[2]) || KICKER[sc] || 'FAKTA ALAM').toUpperCase().slice(0, 28);
      const vo = bersihBp((b.match(/Kalimat VO\s*:\s*([^\n]+)/i) || [])[1]);
      if (!vo || vo.split(/\s+/).length < 3) continue;
      const visual = bersihBp((b.match(/Visual Adegan\s*:\s*([^\n]+)/i) || [])[1]);
      const utama = bersihBp((b.match(/Keyword Pixabay Utama\s*:\s*([^\n]+)/i) || [])[1]);
      const backup = bersihBp((b.match(/Keyword Pixabay Backup\s*:\s*([^\n]+)/i) || [])[1]);
      const sub = visual.length > 64 ? visual.slice(0, 64).replace(/\s+\S*$/, '') : visual;

      if (sc === 'end') {
        lines.push(['end', MOOD.end, vo, '', null]);
      } else {
        lines.push([sc, MOOD[sc] || 'n', vo, FX[sc] || '', {
          mode: (sc === 'title' || sc === 'a' || sc === 'c') ? 'pip_broll' : 'full_broll',
          videoQuery: utama,
          altQuery: backup,
          keywords: [utama, backup].filter(Boolean),
          kicker: KICKER[sc] || 'FAKTA',
          title: label,
          sub
        }]);
      }
    }
    if (lines.length < 7 || lines[lines.length - 1][0] !== 'end') return null;

    const mSrc = raw.match(/SUMBER RISET\s*:\s*\n((?:[ \t]*[-•*][^\n]*\n?)+)/i);
    const src = mSrc ? mSrc[1].split('\n').map(s => bersihBp(s.replace(/^[ \t]*[-•*]\s*/, ''))).filter(Boolean) : [];
    const isAlam = /laut|gurita|hiu|paus|ubur|ikan|penyu|kuda laut|burung|elang|hantu|lebah|kupu|serigala|bunglon|katak|hewan|satwa|gunung|petir|bintang|bulan|palung/i.test(JUDUL + ' ' + raw);

    return {
      coverQuery, coverAlt, src, lines,
      tx: {
        kicker: isAlam ? 'FAKTA ALAM' : 'PSIKOLOGI',
        t1: t1 || 'FAKTA',
        t2: t2 || 'MENGEJUTKAN',
        watch: 'tonton sampai habis',
        src: 'Sumber'
      }
    };
  } catch (_) {
    return null;
  }
}

async function buatDeskripsiTags(judul, lines) {
  const vo = lines.map(l => l[2].replace(/\*/g, '')).join(' ');
  const teks = await geminiGenerate([{ text:
`Buat deskripsi & tag YouTube Shorts (bahasa Indonesia) untuk video berjudul "${judul}".
Isi video: ${vo.slice(0, 900)}
Keluarkan HANYA JSON murni: {"desc":"2 kalimat ringkas + ajakan diskusi di komentar","tags":"#faktaunik #sains #edukasi + 2-3 tag relevan lain"}` }], { timeoutMs: 30000, rounds: 2, maxModels: 4 });
  const j = ekstrakJson(teks);
  return (j && typeof j === 'object') ? j : {};
}

/* ===== AUTO QUALITY-GATE: BERSIHKAN KEYWORD & SUMBER RISET OTOMATIS ===== */
function sanitasiKeywordBroll(q) {
  let clean = bersihkanQuery(q).toLowerCase();
  if (!clean) return '';
  if (/\b(empty room|indoors|hall|hallway|lobby|mall|street|corridor|plaza)\b/.test(clean)) {
    if (/walk|pac|foot|feet|step/.test(clean)) return 'shoes walking floor';
    if (/phone|call|smart/.test(clean)) return 'hand holding phone';
    return 'dark bedroom clock';
  }
  return clean;
}

/* ===== V55.2: FALLBACK HABITAT ALAM/SATWA AGAR TIDAK PERNAH JATUH KE KOTAK TEKS KOSONG ===== */
function tentukanFallbackHabitat(judul) {
  const q = (judul || '').toLowerCase();
  if (/laut|gurita|hiu|paus|ubur|ikan|penyu|kuda laut|samudra|terumbu|palung/.test(q)) {
    return ['deep ocean dark', 'underwater light rays', 'ocean waves dark'];
  }
  if (/burung|elang|hantu|gagak|sayap|terbang|langit|kolibri/.test(q)) {
    return ['dark forest night', 'misty mountains dark', 'night sky clouds'];
  }
  if (/lebah|kupu|serangga|laba|capung|semut|kunang/.test(q)) {
    return ['forest leaves macro', 'water droplets slow', 'dark nature macro'];
  }
  if (/bintang|bulan|angkasa|planet|galaksi|gerhana|meteor/.test(q)) {
    return ['milky way stars', 'full moon night', 'nebula galaxy space'];
  }
  return ['dark forest night', 'foggy forest mist', 'water droplets slow'];
}

function ringkasSumberRiset(srcList) {
  if (!Array.isArray(srcList) || !srcList.length) return ['National Geographic Wildlife'];
  return srcList.slice(0, 2).map(s => {
    let clean = String(s || '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+[:–—-]\s+.*$|:.*$/, '')
      .replace(/\.$/, '')
      .trim();
    const kata = clean.split(/\s+/).filter(Boolean).slice(0, 4);
    return kata.length ? kata.join(' ') : 'National Geographic Wildlife';
  });
}

function rapikanNaskah(data, dim, ttsInfo) {
  if (!data || typeof data !== 'object') throw new Error('Naskah dari Gemini bukan objek JSON yang valid.');
  if (!Array.isArray(data.lines)) throw new Error('Naskah dari Gemini tidak punya array "lines".');

  data.lines = data.lines.filter(l => Array.isArray(l) && l.length >= 3 && typeof l[2] === 'string' && l[2].trim() !== '');
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
      meta.videoQuery = sanitasiKeywordBroll(meta.videoQuery || '');
      meta.altQuery = sanitasiKeywordBroll(meta.altQuery || '');
      let kw = meta.keywords;
      if (typeof kw === 'string') kw = kw.split(',');
      if (!Array.isArray(kw)) kw = [];
      meta.keywords = [...new Set(kw.map(k => sanitasiKeywordBroll(k)).filter(Boolean))].slice(0, 5);
      if (!meta.videoQuery && meta.keywords.length) meta.videoQuery = meta.keywords[0];
    } else {
      meta = null;
    }
    return [sc, mood, text, fx, meta];
  });

  const isAlam = /laut|gurita|hiu|paus|ubur|ikan|penyu|kuda laut|burung|elang|hantu|lebah|kupu|serigala|bunglon|katak|hewan|satwa|gunung|petir|bintang|bulan|palung/i.test(JUDUL);
  const defaultTx = {
    kicker: isAlam ? 'FAKTA ALAM' : 'PSIKOLOGI',
    t1: 'FAKTA',
    t2: 'MENGEJUTKAN',
    watch: 'tonton sampai habis',
    src: 'Sumber'
  };

  data.tx = Object.assign({}, defaultTx, (data.tx && typeof data.tx === 'object') ? data.tx : {});
  if (/kisah nyata/i.test(data.tx.kicker)) data.tx.kicker = defaultTx.kicker;
  if (typeof data.title !== 'string' || !data.title.trim()) data.title = JUDUL;
  if (typeof data.desc  !== 'string' || !data.desc.trim())  data.desc  = `${data.title} - tonton sampai habis dan tulis pendapatmu di komentar!`;
  if (typeof data.tags  !== 'string' || !data.tags.trim())  data.tags  = '#faktaunik #sains #edukasi';

  data.src = ringkasSumberRiset(data.src);

  if (!data.varian) data.varian = 'v' + (Date.now() % 999);
  data.coverQuery = sanitasiKeywordBroll(data.coverQuery || '');
  data.coverAlt = sanitasiKeywordBroll(data.coverAlt || '');

  if (dim.aspect === '9/16') {
    if (!data.title.toLowerCase().includes('#shorts')) data.title += ' #Shorts';
    if (!data.tags.toLowerCase().includes('#shorts')) data.tags += ' #Shorts';
  }

  data.visualTheme = pilihTemaVisualDariJudul(JUDUL);
  data.lang = ttsInfo.langCode;
  data.width = dim.width;
  data.height = dim.height;
  data.coverHold = COVER_HOLD_SEC;
  if (DISCLOSURE_ENV !== undefined) data.disclosure = DISCLOSURE_ENV;
  if (PIXABAY_API_KEY) data.pixabayApiKey = PIXABAY_API_KEY;
  return data;
}

/* ===== PIXABAY VIDEO DOWNLOADER + FRAME SEQUENCE EXTRACTOR (ANTI-BURIK) ===== */
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

function filterFrameKlip() {
  const rasio = FRAME_W / FRAME_H;
  if (rasio < 1) return `crop='min(iw,ih*${rasio.toFixed(5)}*1.15)':ih,scale=${FRAME_W}:${FRAME_H}:flags=lanczos,unsharp=3:3:0.35:3:3:0.0`;
  return `scale=${FRAME_W}:${FRAME_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${FRAME_W}:${FRAME_H}`;
}

function downloadAndNormalizeVideo(url, rawFile, finalMp4, idx, maxSec = 6) {
  try {
    execSync(
      `curl -sL --fail --max-time 60 -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" "${url}" -o "${rawFile}"`,
      { stdio: 'pipe' }
    );
    if (!fs.existsSync(rawFile) || fs.statSync(rawFile).size < 15000) {
      if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile);
      return null;
    }
    const vf = filterFrameKlip();

    execSync(
      `ffmpeg -y -i "${rawFile}" -an -t ${maxSec} -vf "${vf},fps=30" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -movflags +faststart "${finalMp4}"`,
      { stdio: 'pipe' }
    );
    if (!fs.existsSync(finalMp4) || fs.statSync(finalMp4).size <= 10000) {
      try { fs.unlinkSync(rawFile); } catch (_) {}
      return null;
    }

    const frameDir = `media/clip_${idx}_frames`;
    fs.rmSync(frameDir, { recursive: true, force: true });
    fs.mkdirSync(frameDir, { recursive: true });
    execSync(
      `ffmpeg -y -i "${rawFile}" -an -t ${maxSec} -vf "${vf},fps=18" -q:v 2 "${frameDir}/f_%03d.jpg"`,
      { stdio: 'pipe' }
    );
    try { fs.unlinkSync(rawFile); } catch (_) {}
    const frameFiles = fs.readdirSync(frameDir)
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .map(f => `${frameDir}/${f}`);
    if (!frameFiles.length) return null;

    return { mp4: finalMp4, frames: frameFiles, fps: 18 };
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
    if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 8192) {
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

function cekKecerahan(mp4) {
  try {
    const out = execSync(
      `ffmpeg -v error -i "${mp4}" -vf "fps=2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null -`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 5 * 1024 * 1024 }
    );
    const nilai = [...out.matchAll(/YAVG=([\d.]+)/g)].map(m => Number(m[1])).filter(n => Number.isFinite(n));
    if (!nilai.length) return true;
    const rata = nilai.reduce((a, b) => a + b, 0) / nilai.length;
    return rata >= 18 && rata <= 198;
  } catch (_) {
    return true;
  }
}

async function verifikasiKlipVisual(framePath, voText, query) {
  if (!VISION_QC) return { ok: true, alasan: '' };
  try {
    const b64 = fs.readFileSync(framePath).toString('base64');
    const teks = await geminiGenerate([
      { text:
`Kamu quality-control video Shorts dokumenter alam/sains. Nilai 1 gambar B-roll ini untuk narasi: "${voText.replace(/\*/g, '')}" (keyword: ${query}).
TOLAK (ok=false) jika: ada kerumunan / 3+ orang jelas, pasangan/romansa, green screen, watermark/teks besar, sangat silau/blur/pecah, atau sama sekali bertolak belakang dengan narasi (catatan: klip subjek utama hewan maupun habitat alami terkait seperti lautan dalam, langit malam, hutan gelap, atau elemen alam terkait TETAP DITERIMA).
Keluarkan HANYA JSON murni: {"ok":true,"alasan":"singkat"}` },
      { inline_data: { mime_type: 'image/jpeg', data: b64 } }
    ], { timeoutMs: 30000, rounds: 1, maxModels: 3 });
    const j = ekstrakJson(teks);
    if (!j) return { ok: true, alasan: '' };
    return { ok: j.ok !== false, alasan: String(j.alasan || '') };
  } catch (_) {
    return { ok: true, alasan: '' };
  }
}

const ALLOW_PHOTO_FALLBACK = true;
const KATA_UMUM = new Set(['the','a','an','of','in','on','at','and','with','for','to','person','people','man','woman','men','women','human','someone','view','scene','video','background','close','up','slow','motion']);

const TAG_TERLARANG_UMUM = [
  'green screen', 'greenscreen', 'chroma key', 'chroma', 'blue screen',
  'couple', 'couples', 'lovers', 'romance', 'romantic', 'kiss', 'kissing', 'wedding', 'bride', 'groom', 'valentine', 'boyfriend', 'girlfriend', 'husband', 'wife', 'dating', 'love story',
  'crowd', 'crowded', 'festival', 'concert', 'party', 'nightclub', 'rave', 'protest', 'parade', 'stadium', 'audience', 'traffic jam', 'busy street', 'pedestrian', 'commuter', 'airport', 'station', 'mall',
  '3d render', '3d animation', 'abstract', 'particle', 'particles', 'template', 'mockup', 'transition', 'overlay', 'subscribe',
  'bright white', 'overexposed', 'lens flare', 'flash'
];

const TAG_HEWAN_NYASAR = ['dog', 'puppy', 'cat', 'kitten', 'pet', 'fish', 'aquarium', 'underwater', 'bird', 'horse', 'cow', 'sheep'];

function bersihkanQuery(query) {
  return (query || '').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function kataIntiQuery(query) {
  return bersihkanQuery(query).toLowerCase().split(' ').filter(w => w.length >= 3 && !KATA_UMUM.has(w));
}

function stem(w) {
  return w.length > 4 ? w.slice(0, 4) : w;
}

function hitRelevan(hit, query) {
  const qLow = (query || '').toLowerCase();
  const hay = ((hit.tags || '') + ' ' + (hit.pageURL || '')).toLowerCase();

  if (TAG_TERLARANG_UMUM.some(bad => hay.includes(bad))) return false;

  const queryMemangHewan = TAG_HEWAN_NYASAR.some(h => qLow.includes(h)) || /\b(octopus|shark|whale|jellyfish|turtle|seahorse|owl|eagle|hummingbird|crow|kingfisher|bee|butterfly|spider|dragonfly|ants|fireflies|wolf|chameleon|snake|frog|fox|leopard|ocean|sea|forest|wildlife|animal)\b/.test(qLow);
  if (!queryMemangHewan && TAG_HEWAN_NYASAR.some(h => hay.includes(h))) return false;

  const inti = kataIntiQuery(query);
  if (!inti.length) return true;
  return inti.some(w => hay.includes(stem(w)));
}

function pilihUrlVideoTerbaik(h) {
  const v = h.videos || {};
  const kandidat = ['large', 'medium', 'small'].map(k => v[k]).filter(x => x && x.url && (Number(x.width) || 0) >= 960);
  if (!kandidat.length) return '';
  const penalti = (x) => {
    const tinggi = Number(x.height) || 0;
    if (!tinggi) return 5000;
    return tinggi >= 1080 ? (tinggi - 1080) : (1080 - tinggi) * 2;
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

  const base = `https://pixabay.com/api/videos/?key=${encodeURIComponent(PIXABAY_API_KEY)}&q=${encodeURIComponent(qClean)}&video_type=film&safesearch=true&min_width=1280&min_height=720&per_page=25`;
  const vJson = curlGetJson(base);
  const hits = (vJson && Array.isArray(vJson.hits)) ? vJson.hits : [];
  const hasil = hits
    .slice()
    .sort((a, b) => ((b.duration >= 5) - (a.duration >= 5)))
    .map(h => ({ url: pilihUrlVideoTerbaik(h), tags: h.tags || '', pageURL: h.pageURL || '' }))
    .filter(h => h.url && hitRelevan(h, qClean));

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

  const base = `https://pixabay.com/api/?key=${encodeURIComponent(PIXABAY_API_KEY)}&q=${encodeURIComponent(qClean)}&image_type=photo&safesearch=true&min_width=1280&per_page=15`;
  const pJson = curlGetJson(base);
  const hasil = ((pJson && pJson.hits) || [])
    .map(h => ({ url: h.largeImageURL || '', tags: h.tags || '', pageURL: h.pageURL || '' }))
    .filter(h => h.url && hitRelevan(h, qClean));

  PIXABAY_FOTO_CACHE[key] = hasil;
  return hasil;
}

async function siapkanMediaPixabayLokal(videoData) {
  fs.mkdirSync('media', { recursive: true });
  if (!PIXABAY_API_KEY) {
    console.warn('PERINGATAN: PIXABAY_API_KEY kosong di GitHub Secrets!');
  } else {
    console.log(`PIXABAY_API_KEY aktif (${PIXABAY_API_KEY.slice(0, 6)}...). Mode ketat: HD >=720p, Prioritas Subjek Utama + Fallback Habitat, Vision-QC ${VISION_QC ? 'ON' : 'OFF'}.`);
  }

  const usedUrls = new Set();
  const habitatCadangan = tentukanFallbackHabitat(JUDUL);
  const hewanUtama = bersihkanQuery(videoData.coverQuery || '').split(' ')[0] || '';
  let berhasilT1 = 0, berhasilT2 = 0, berhasilT3 = 0, berhasilFoto = 0, ditolakQC = 0;
  const tanpaMedia = [];

  for (let i = 0; i < videoData.lines.length; i++) {
    const l = videoData.lines[i];
    const sc = l[0];
    if (sc === 'end') continue;

    const meta = (l[4] && typeof l[4] === 'object') ? l[4] : (l[4] = {});
    meta.noMedia = false;

    const tahap1 = [...new Set([meta.videoQuery, meta.altQuery].map(q => bersihkanQuery(q)).filter(Boolean))];
    const tahap2 = [...new Set((meta.keywords || []).map(q => bersihkanQuery(q)).filter(Boolean))]
      .filter(q => !tahap1.map(x => x.toLowerCase()).includes(q.toLowerCase()));
    const tahap3 = [...new Set([hewanUtama, ...habitatCadangan].map(q => bersihkanQuery(q)).filter(Boolean))]
      .filter(q => ![...tahap1, ...tahap2].map(x => x.toLowerCase()).includes(q.toLowerCase()));

    console.log(`   [Baris ${i + 1}] VO: "${l[2].replace(/\*/g, '')}"`);
    console.log(`             Tahap 1 (utama/backup)   : ${tahap1.join(' | ') || '-'}`);
    console.log(`             Tahap 3 (subjek/habitat) : ${tahap3.join(' | ') || '-'}`);

    const urutan = [
      ...tahap1.map(q => ({ q, tahap: 1 })),
      ...tahap2.map(q => ({ q, tahap: 2 })),
      ...tahap3.map(q => ({ q, tahap: 3 }))
    ];

    let videoOk = false;

    for (const { q: qTry, tahap } of urutan) {
      const hits = cariVideoPixabay(qTry);
      if (!hits.length) continue;
      const belumDipakai = hits.filter(h => !usedUrls.has(h.url));

      for (const chosen of belumDipakai.slice(0, 4)) {
        const rawFile = `media/raw_${i}.mp4`;
        const finalMp4 = `media/clip_${i}.mp4`;
        const normRes = downloadAndNormalizeVideo(chosen.url, rawFile, finalMp4, i);
        if (!normRes) continue;
        usedUrls.add(chosen.url);

        if (!cekKecerahan(normRes.mp4)) {
          ditolakQC++;
          console.log(`   [Baris ${i + 1}] DITOLAK QC (terlalu gelap/silau): ${chosen.tags}`);
          continue;
        }
        const tengah = normRes.frames[Math.floor(normRes.frames.length / 2)];
        const vis = await verifikasiKlipVisual(tengah, l[2], qTry);
        if (!vis.ok) {
          ditolakQC++;
          console.log(`   [Baris ${i + 1}] DITOLAK Vision-QC (${vis.alasan || 'tidak sesuai'}): ${chosen.tags}`);
          continue;
        }

        meta.videoUrl = normRes.mp4;
        meta.videoFrames = normRes.frames;
        meta.videoFps = normRes.fps;
        meta.matchTahap = tahap;
        meta.matchQuery = qTry;
        if (tahap === 1) berhasilT1++;
        else if (tahap === 2) berhasilT2++;
        else berhasilT3++;
        videoOk = true;
        console.log(`   [Baris ${i + 1}] SUKSES Video HD (Tahap ${tahap}, "${qTry}", tag: ${chosen.tags}) -> ${finalMp4}`);
        break;
      }
      if (videoOk) break;
    }

    if (videoOk) continue;

    let fotoOk = false;
    if (ALLOW_PHOTO_FALLBACK) {
      for (const { q: qTry, tahap } of urutan) {
        const pHits = cariFotoPixabay(qTry);
        const chosenP = pHits.find(h => !usedUrls.has(h.url));
        if (!chosenP) continue;
        const localJpg = `media/photo_${i}.jpg`;
        if (downloadPhotoFallback(chosenP.url, localJpg)) {
          usedUrls.add(chosenP.url);
          const vis = await verifikasiKlipVisual(localJpg, l[2], qTry);
          if (!vis.ok) {
            ditolakQC++;
            console.log(`   [Baris ${i + 1}] Foto DITOLAK Vision-QC (${vis.alasan || 'tidak sesuai'})`);
            continue;
          }
          meta.photoUrl = localJpg;
          meta.matchTahap = tahap;
          meta.matchQuery = qTry;
          berhasilFoto++;
          fotoOk = true;
          console.log(`   [Baris ${i + 1}] SUKSES Foto HD (Tahap ${tahap}, "${qTry}") -> ${localJpg}`);
          break;
        }
      }
    }

    if (!fotoOk) {
      meta.noMedia = true;
      tanpaMedia.push(i + 1);
      console.log(`   [Baris ${i + 1}] Tanpa klip -> otomatis tampilkan kartu kutipan elegan.`);
    }
  }

  videoData.qcMediaStat = { video: berhasilT1 + berhasilT2 + berhasilT3, foto: berhasilFoto, tanpa: tanpaMedia.length, ditolak: ditolakQC };
  console.log(`Ringkasan B-Roll: Tahap 1 ${berhasilT1} | Tahap 2 ${berhasilT2} | Cadangan ${berhasilT3} | Foto ${berhasilFoto} | Tanpa visual ${tanpaMedia.length} | Ditolak QC ${ditolakQC}`);
}

async function siapkanVisualSampul(videoData) {
  if (!PIXABAY_API_KEY || !videoData.coverQuery) return;
  const kandidatQuery = [videoData.coverQuery];
  if (videoData.coverAlt) kandidatQuery.push(videoData.coverAlt);
  const first = videoData.lines[0] && videoData.lines[0][4];
  if (first && first.videoQuery) kandidatQuery.push(first.videoQuery);

  for (const q of kandidatQuery) {
    const hits = cariVideoPixabay(q);
    for (const chosen of hits.slice(0, 4)) {
      const res = downloadAndNormalizeVideo(chosen.url, 'media/raw_cover.mp4', 'media/clip_cover.mp4', 'cover', 3);
      if (!res) continue;
      if (!cekKecerahan(res.mp4)) continue;
      const vis = await verifikasiKlipVisual(res.frames[Math.floor(res.frames.length / 2)], videoData.title, q);
      if (!vis.ok) continue;
      videoData.coverFrames = res.frames;
      videoData.coverFps = res.fps;
      console.log(`   [Sampul] SUKSES visual sampul "${q}"`);
      return;
    }
  }
}

async function buatNaskahJSON(dim, ttsInfo) {
  if (BLUEPRINT_TEKS) {
    const bp = parseBlueprint(BLUEPRINT_TEKS);
    if (bp) {
      console.log(`Blueprint terbaca lokal: ${bp.lines.length} adegan -> persis sesuai prompt, tanpa rekayasa ulang Gemini.`);
      cekAturanKonten(JUDUL, bp.lines);
      const extra = await buatDeskripsiTags(JUDUL, bp.lines);
      bp.title = JUDUL;
      if (extra.desc) bp.desc = extra.desc;
      if (extra.tags) bp.tags = extra.tags;
      return rapikanNaskah(bp, dim, ttsInfo);
    }
    console.warn('Blueprint gagal di-parse lokal -> fallback ke Gemini.');
  }

  const jumlahKalimat = dim.isVertical
    ? '8 kalimat storytelling santai & mengalir sesuai kunci adegan di bawah (maksimal 9-12 kata per kalimat agar total durasi baca 38-50 detik)'
    : '12-15 kalimat padat dan informatif (untuk video landscape 16:9)';

  const instruksiSumber = BLUEPRINT_TEKS
    ? `PENTING — PENGGUNA SUDAH MENYEDIAKAN BLUEPRINT LENGKAP DI BAWAH INI:
"""
${BLUEPRINT_TEKS.slice(0, 6000)}
"""
ATURAN EKSEKUSI BLUEPRINT (WAJIB DIIKUTI 100%):
- Gunakan Judul, Teks Atas Sampul (t1), Teks Bawah Sampul (t2), urutan kalimat VO, dan Sumber Riset PERSIS dari blueprint di atas.
- Untuk setiap adegan, masukkan "Keyword Pixabay Utama" ke field "videoQuery", dan masukkan "Keyword Pixabay Backup" ke field "altQuery" serta "keywords" persis seperti tertulis di blueprint!`
    : `Buatkan data video lengkap untuk topik:
- Judul: "${JUDUL}"
- Buat ${jumlahKalimat} di array "lines".`;

  const prompt = `Kamu adalah sutradara video dokumenter & editor B-Roll Pixabay profesional.
Buatkan data video lengkap dalam format JSON MURNI (tanpa markdown/teks pembuka) dengan spesifikasi:
- Judul Utama: "${JUDUL}"
- Bahasa Video: ${BAHASA} (kode BCP-47: ${ttsInfo.langCode})
- Ukuran: ${UKURAN} (${dim.width}x${dim.height})

${instruksiSumber}

ATURAN GAYA & ORIGINALITAS (WAJIB DIPATUHI):
1. DILARANG KERAS membuat cerita tentang pasangan, pacaran, percintaan, pernikahan, atau romansa (100% bebas tema pasangan).
2. Narasi harus punya SUDUT PANDANG tajam, bukan rangkuman klise.
3. Kalimat pertama adalah hook kuat. Kalimat terakhir memberi insight tajam (tanpa tombol subscribe/CTA).
4. DILARANG menulis "KISAH NYATA" di kicker/judul. Gunakan kicker seperti "FAKTA ALAM", "SAINS ALAM", atau "PERSPEKTIF".
5. Field "src" berisi maksimal 2 item, masing-masing HANYA nama lembaga/studi maksimal 4 kata tanpa penjelasan dalam kurung.

ATURAN KERAS KATA KUNCI B-ROLL PIXABAY (WAJIB OBJEK NYATA & TENANG):
Pixabay HANYA paham objek fisik konkret dalam BAHASA INGGRIS (2-3 kata).
- DILARANG keyword abstrak/ambigu seperti "land", "ground", "dream", "mind", "thought", "success", "hope", "time", "future", "emotion", "memory".
- "coverQuery" = objek visual tenang & sinematik sesuai SAMPUL (2-3 kata Inggris konkret).
- Variasikan mode visual antara "pip_broll" pada "title", "a", "c", dan "full_broll" pada "b1" sampai "b6".
- Format array "lines": ["kunci_adegan", "mood", "Kalimat VO dengan *kata* ditekankan.", "fx_opsional", META_VISUAL]
  Kunci adegan: "title" (pertama), "b1", "b2", "a", "b3", "b4", "c", lalu "end" (terakhir, META_VISUAL null).

KELUARKAN HANYA JSON DENGAN STRUKTUR INI:
{
  "title": "${JUDUL.replace(/"/g, '\\"')}",
  "varian": "v${Date.now() % 999}",
  "lang": "${ttsInfo.langCode}",
  "width": ${dim.width},
  "height": ${dim.height},
  "desc": "Deskripsi singkat 2 kalimat + ajakan diskusi di komentar.",
  "tags": "#faktaunik #sains #edukasi",
  "src": ["National Geographic Wildlife", "Journal of Experimental Biology"],
  "coverQuery": "calm cinematic object matching cover",
  "coverAlt": "backup calm cinematic object",
  "tx": {
    "kicker": "FAKTA ALAM",
    "t1": "KATA ATAS",
    "t2": "KATA BAWAH?",
    "watch": "tonton sampai habis",
    "src": "Sumber"
  },
  "lines": [
    ["title", "d", "Kalimat pembuka dengan *kata kunci* sesuai judul.", "", {"mode":"pip_broll","videoQuery":"concrete object 1","altQuery":"backup concrete object 1","keywords":["concrete object 1","backup concrete object 1"],"kicker":"FENOMENA","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["b1", "n", "Kalimat kedua sesuai topik.", "p", {"mode":"full_broll","videoQuery":"concrete object 2","altQuery":"backup concrete object 2","keywords":["concrete object 2","backup concrete object 2"],"kicker":"FAKTA","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["b2", "e", "Kalimat ketiga sesuai topik.", "p", {"mode":"full_broll","videoQuery":"concrete object 3","altQuery":"backup concrete object 3","keywords":["concrete object 3","backup concrete object 3"],"kicker":"PROSES","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["a", "n", "Kalimat keempat dari karakter.", "", {"mode":"pip_broll","videoQuery":"concrete object 4","altQuery":"backup concrete object 4","keywords":["concrete object 4","backup concrete object 4"],"kicker":"SAINS ALAM","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["b3", "d", "Kalimat kelima sesuai topik.", "p", {"mode":"full_broll","videoQuery":"concrete object 5","altQuery":"backup concrete object 5","keywords":["concrete object 5","backup concrete object 5"],"kicker":"MEKANISME","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["b4", "e", "Kalimat keenam sesuai topik.", "p", {"mode":"full_broll","videoQuery":"concrete object 6","altQuery":"backup concrete object 6","keywords":["concrete object 6","backup concrete object 6"],"kicker":"DETAIL","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["c", "d", "Kalimat ketujuh insight bermanfaat.", "", {"mode":"pip_broll","videoQuery":"concrete object 7","altQuery":"backup concrete object 7","keywords":["concrete object 7","backup concrete object 7"],"kicker":"INSIGHT","title":"JUDUL ADEGAN","sub":"Keterangan singkat sesuai VO"}],
    ["end", "s", "Kalimat penutup yang meninggalkan *kesan*.", "", null]
  ]
}`;

  for (let putaran = 1; putaran <= 3; putaran++) {
    console.log(`Putaran ${putaran}: menyusun naskah via Gemini (${IS_BLUEPRINT ? 'Mode Blueprint Fallback' : 'Mode Judul Singkat'})...`);
    const raw = await geminiGenerate([{ text: prompt }], { timeoutMs: 65000, rounds: 1 });
    const hasil = ekstrakJson(raw);
    if (!hasil) { await tunggu(3000); continue; }
    try {
      const rapi = rapikanNaskah(hasil, dim, ttsInfo);
      cekAturanKonten(JUDUL, rapi.lines);
      return rapi;
    } catch (err) {
      if (/melanggar aturan niche/.test(err.message)) throw err;
    }
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

function durasiFile(p) {
  try {
    const s = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}"`, { encoding: 'utf8' }).trim();
    return Number(s) || 0;
  } catch (_) {
    return 0;
  }
}

function percepatVO(timings, faktor) {
  const f = Math.min(1.3, Math.max(1, faktor));
  const fStr = f.toFixed(3);
  console.log(`   VO dipercepat x${fStr} agar total video aman < 59 detik.`);
  execSync(`ffmpeg -y -i vo.mp3 -filter:a "atempo=${fStr}" -c:a libmp3lame -b:a 128k vo_fast.mp3`, { stdio: 'pipe' });
  fs.renameSync('vo_fast.mp3', 'vo.mp3');
  if (Array.isArray(timings)) {
    timings.forEach(t => {
      t.ss = Number((t.ss / f).toFixed(3));
      t.se = Number((t.se / f).toFixed(3));
      t.wordTimes = (t.wordTimes || []).map(w => [Number((w[0] / f).toFixed(3)), Number((w[1] / f).toFixed(3))]);
    });
  }
  return timings;
}

async function siapkanVoiceOver(videoData, ttsInfo) {
  const urutanBuang = ['b4', 'b3', 'b5', 'b6', 'b2'];
  for (let percobaan = 0; percobaan < 4; percobaan++) {
    const timings = await buatAudioTTS(videoData.lines, 'vo.mp3', ttsInfo);
    const dur = durasiFile('vo.mp3');
    console.log(`   Durasi VO: ${dur.toFixed(1)}s (batas ${MAX_VO_SEC}s)`);
    if (dur <= MAX_VO_SEC) return timings;

    const faktor = dur / MAX_VO_SEC;
    if (faktor <= 1.15) return percepatVO(timings, faktor);

    const target = urutanBuang.find(k => videoData.lines.some(l => l[0] === k));
    if (!target || videoData.lines.length <= 6) {
      if (faktor <= 1.3) return percepatVO(timings, faktor);
      throw new Error(`Durasi VO ${dur.toFixed(1)}s terlalu panjang & tidak bisa dipangkas otomatis.`);
    }
    const idx = videoData.lines.findIndex(l => l[0] === target);
    console.log(`   VO terlalu panjang -> adegan "${target}" dibuang otomatis, suara dibuat ulang.`);
    videoData.lines.splice(idx, 1);
  }
  throw new Error('Gagal menyesuaikan durasi VO setelah beberapa percobaan.');
}

function pilihBgmSkalaDariJudul(judul, seedNum) {
  const q = (judul || '').toLowerCase();
  const genreScales = [
    { re: /kamar mandi|mandi|keramik|gema|reverb|akustik|nyanyi|air|laut|gurita|hiu|paus|ubur|ikan|palung/, notes: [293.66, 349.23, 440.00, 523.25], tempo: 1.25, lp: 1200 },
    { re: /horor|hantu|mistis|angker|kuburan|kutukan|misteri|gelap|malam|tidur|alarm|hilang|mercusuar/, notes: [146.83, 174.61, 220.00, 261.63], tempo: 0.85, lp: 780 },
    { re: /sejarah|kuno|kerajaan|romawi|mesir|abad|dinasti|piramida|perang|nusantara|katedral|istana|bangun|tukang pos|surat|desa/, notes: [220.00, 261.63, 293.66, 392.00], tempo: 0.95, lp: 920 },
    { re: /sains|antariksa|planet|teknologi|robot|ai\b|kuantum|listrik|lampu|bintang|bulan|angkasa/, notes: [261.63, 311.13, 392.00, 466.16], tempo: 1.40, lp: 1400 },
    { re: /psikologi|otak|pikiran|mental|stres|mimpi|kebiasaan|menguap|mulut|etika|ditatap|mata/, notes: [246.94, 293.66, 369.99, 440.00], tempo: 0.90, lp: 850 },
    { re: /bisnis|sukses|kaya|miliarder|saham|uang|ekonomi|emas|tabung|rumah/, notes: [261.63, 329.63, 392.00, 523.25], tempo: 1.40, lp: 1250 },
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

function validasiVideoFinal(videoPath) {
  if (!fs.existsSync(videoPath)) throw new Error('File output_final.mp4 tidak terbentuk.');
  const sizeMb = fs.statSync(videoPath).size / (1024 * 1024);
  if (sizeMb < 0.8) throw new Error(`Ukuran video terlalu kecil (${sizeMb.toFixed(2)} MB), terindikasi korup.`);
  const durStr = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
    { encoding: 'utf8' }
  ).trim();
  const dur = Number(durStr) || 0;
  if (dur < 10 || dur > 59.5) {
    throw new Error(`Durasi video (${dur.toFixed(1)}s) di luar batas aman YouTube Shorts (10–59 detik).`);
  }
  console.log(`Quality-Gate DASAR LOLOS: durasi ${dur.toFixed(1)}s, ukuran ${sizeMb.toFixed(2)} MB.`);
  return dur;
}

/* ===== V55.2: AUDIT KUALITAS FINAL DENGAN KONTEKS ALUR NARASI LENGKAP ===== */
async function auditKualitasFinal(videoPath, data, durasi) {
  let skor = 10;
  const catatan = [];

  try {
    const out = execSync(`ffmpeg -hide_banner -i "${videoPath}" -vf blackdetect=d=0.6:pix_th=0.10 -an -f null - 2>&1`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const totalHitam = [...out.matchAll(/black_duration:([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0);
    if (totalHitam > 1.5) { skor -= 3; catatan.push(`layar hitam ${totalHitam.toFixed(1)}s`); }
  } catch (_) {}

  try {
    const out = execSync(`ffmpeg -hide_banner -i "${videoPath}" -af volumedetect -vn -f null - 2>&1`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const m = out.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
    if (m && Number(m[1]) < -45) { skor -= 5; catatan.push(`audio nyaris senyap (${m[1]} dB)`); }
  } catch (_) {}

  const st = data.qcMediaStat;
  if (st) {
    const total = st.video + st.foto + st.tanpa;
    const rasioTanpa = total ? st.tanpa / total : 0;
    if (rasioTanpa > 0.3) { skor -= 3; catatan.push(`${st.tanpa} adegan tanpa klip`); }
    else if (rasioTanpa > 0.15) { skor -= 1; catatan.push(`${st.tanpa} adegan tanpa klip`); }
  }

  if (VISION_QC && durasi > 0) {
    try {
      const ringkasanAlur = (data.lines || [])
        .map((l, idx) => `Adegan ${idx + 1}: "${String(l[2] || '').replace(/\*/g, '')}"`)
        .join(' | ');

      const posisi = [0.08, 0.25, 0.42, 0.6, 0.78, 0.92];
      const parts = [{ text:
`Kamu reviewer akhir video YouTube Shorts dokumenter berjudul "${data.title}".
Alur narasi lengkap video ini dari awal sampai akhir adalah:
${ringkasanAlur}

Berikut 6 frame berurutan dari video final. Beri skor 1-10 (10 = siap tayang sempurna tanpa revisi).
ATURAN PENILAIAN PENTING:
- Visual hewan mangsa (seperti serangga/kupu-kupu), pemangsa, bagian tubuh, atau habitat alami (hutan/laut/langit malam) yang sesuai dengan salah satu kalimat pada alur narasi di atas adalah VALID & RELEVAN PENUH (JANGAN kurangi skor karena hal itu).
- HANYA kurangi skor jika: teks terpotong/bertumpuk/tidak terbaca, layar kosong/hitam, kerumunan manusia ramai, pasangan/romansa, green screen, watermark, atau tampilan berantakan.
Keluarkan HANYA JSON murni: {"skor":10,"masalah":[]}` }];
      for (let i = 0; i < posisi.length; i++) {
        const fp = `qc_frame_${i}.jpg`;
        execSync(`ffmpeg -y -ss ${(durasi * posisi[i]).toFixed(2)} -i "${videoPath}" -frames:v 1 -vf scale=360:-2 -q:v 4 "${fp}"`, { stdio: 'pipe' });
        parts.push({ inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(fp).toString('base64') } });
      }
      const teks = await geminiGenerate(parts, { timeoutMs: 45000, rounds: 1, maxModels: 3 });
      const j = ekstrakJson(teks);
      if (j && Number.isFinite(Number(j.skor))) {
        const sv = Math.max(1, Math.min(10, Number(j.skor)));
        skor = Math.min(skor, sv);
        if (Array.isArray(j.masalah) && j.masalah.length) catatan.push(...j.masalah.slice(0, 3).map(String));
      }
    } catch (e) {
      console.warn('Vision audit final dilewati:', e.message);
    }
  }

  skor = Math.max(1, Math.min(10, skor));
  console.log(`Audit Kualitas Final: skor ${skor}/10 ${catatan.length ? '| ' + catatan.join('; ') : '| tidak ada masalah'}`);
  return { skor, catatan };
}

async function uploadKeYouTubeShorts(videoPath, data, privasi) {
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
    console.log('Info: Secrets YouTube (YT_CLIENT_ID/YT_CLIENT_SECRET/YT_REFRESH_TOKEN) belum diisi -> skip auto-upload YouTube.');
    return null;
  }

  console.log(`8. Mengunggah otomatis ke YouTube Shorts (status: ${privasi})...`);
  const { google } = require('googleapis');
  const oauth2Client = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: YT_REFRESH_TOKEN });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  let judulYt = String(data.title || JUDUL).trim();
  if (!judulYt.toLowerCase().includes('#shorts')) judulYt += ' #Shorts';
  judulYt = judulYt.slice(0, 100);

  const sumberTeks = (data.src || []).map(s => `- ${s}`).join('\n');
  const deskripsiYt = `${data.desc || ''}\n\nSumber Referensi:\n${sumberTeks}\n\n${data.tags || '#faktaunik #sains #Shorts'}`.trim();
  const tagList = (data.tags || '')
    .split(/\s+/)
    .map(t => t.replace(/^#/, '').trim())
    .filter(Boolean)
    .slice(0, 15);
  if (!tagList.some(t => t.toLowerCase() === 'shorts')) tagList.push('Shorts');

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: judulYt,
        description: deskripsiYt,
        tags: tagList,
        categoryId: '27'
      },
      status: {
        privacyStatus: privasi,
        selfDeclaredMadeForKids: false
      }
    },
    media: {
      body: fs.createReadStream(videoPath)
    }
  });

  const videoId = res && res.data && res.data.id;
  if (!videoId) throw new Error('YouTube API tidak mengembalikan Video ID.');
  const shortsUrl = `https://www.youtube.com/shorts/${videoId}`;
  console.log(`SUKSES Upload YouTube Shorts: ${shortsUrl}`);
  return shortsUrl;
}

async function uploadDenganRetry(videoPath, data, privasi) {
  let errTerakhir = null;
  for (let i = 1; i <= 3; i++) {
    try {
      return await uploadKeYouTubeShorts(videoPath, data, privasi);
    } catch (e) {
      errTerakhir = e;
      console.error(`Upload percobaan ${i}/3 gagal: ${e.message}`);
      if (i < 3) await tunggu(i * 15000);
    }
  }
  throw errTerakhir;
}

function pastikanUkuranDibawahBatasTelegram(videoPath, maxMb = 44) {
  const stat = fs.statSync(videoPath);
  const mb = stat.size / (1024 * 1024);
  if (mb <= maxMb) return videoPath;

  const compressedPath = 'output_telegram.mp4';
  execSync(
    `ffmpeg -y -i "${videoPath}" -c:v libx264 -preset fast -crf 25 -maxrate 3800k -bufsize 7600k -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "${compressedPath}"`,
    { stdio: 'pipe' }
  );
  return compressedPath;
}

async function kirimVideoTelegram(videoPath, data, info = {}) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const { youtubeUrl = null, audit = null, privasi = '', errUpload = '' } = info;
  const readyPath = pastikanUkuranDibawahBatasTelegram(videoPath, 44);
  console.log(`Mengirim laporan & arsip video (${readyPath}) ke Telegram...`);

  let statusYt = '';
  if (youtubeUrl) {
    statusYt = privasi === YT_PRIVACY
      ? `\n🚀 *AUTO-UPLOAD SUKSES (${privasi.toUpperCase()})*\n🔗 ${youtubeUrl}\n`
      : `\n⚠️ *TERUPLOAD SEBAGAI ${privasi.toUpperCase()}* (skor kualitas rendah, cek dulu lalu publikasikan manual bila oke)\n🔗 ${youtubeUrl}\n`;
  } else if (errUpload) {
    statusYt = `\n❌ *UPLOAD YOUTUBE GAGAL:* ${errUpload}\nVideo tetap aman di arsip ini.\n`;
  }
  const statusQc = audit ? `\n🛡️ *Skor Kualitas:* ${audit.skor}/10${audit.catatan.length ? '\n' + audit.catatan.map(c => '- ' + c).join('\n') : ''}\n` : '';
  const caption = `🎬 *VIDEO V55.2 SELESAI!*\n${statusYt}${statusQc}\n📍 *Judul:*\n${data.title}\n\n📚 *Sumber:*\n${(data.src || []).map(s => '- ' + s).join('\n')}\n\n🏷️ *Tags:*\n${data.tags}`;

  const kirim = async (pakaiMarkdown) => {
    const form = new FormData();
    form.append('chat_id', TELEGRAM_CHAT_ID);
    form.append('caption', caption.slice(0, 1024));
    if (pakaiMarkdown) form.append('parse_mode', 'Markdown');
    form.append('supports_streaming', 'true');
    form.append('video', new Blob([fs.readFileSync(readyPath)], { type: 'video/mp4' }), 'video_cerita.mp4');
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`, {
      method: 'POST',
      signal: AbortSignal.timeout(120000),
      body: form
    });
    return res.json();
  };

  let json = await kirim(true);
  if (!json.ok && /parse|entities/i.test(String(json.description || ''))) json = await kirim(false);
  if (!json.ok) throw new Error(`Telegram API menolak video (${json.error_code}): ${json.description}`);
  console.log('Sukses kirim laporan video ke Telegram!');
}

(async () => {
  try {
    const dim = getDimensi(UKURAN);
    const ttsInfo = getBahasaConfig(BAHASA);
    const { jamWib, targetJamRamai } = deteksiPrimeTimeHariIni();

    const resScale = (dim.aspect === '9/16') ? RES_SCALE_ENV : 1;
    const outW = Math.round(dim.width * resScale);
    const outH = Math.round(dim.height * resScale);
    FRAME_W = outW;
    FRAME_H = outH;

    console.log(`=== MEMULAI PRODUKSI OTOMATIS V55.2 (${UKURAN} | ${BAHASA} | ${outW}x${outH}) ===`);
    await kirimPesanTelegram(`⚙️ *MEMPROSES VIDEO OTOMATIS*\n\nJudul: *${JUDUL}*\nMode: ${IS_BLUEPRINT ? 'Blueprint Lengkap' : 'Judul Cepat'}\nTarget Prime Time: ${targetJamRamai}:00 WIB (Sekarang ${jamWib}:00 WIB)`);

    console.log('1. Menyusun & mengaudit naskah...');
    const videoData = await buatNaskahJSON(dim, ttsInfo);
    videoData.resScale = resScale;

    console.log('2. Membuat suara Voice Over (auto-fit durasi)...');
    const exactTimings = await siapkanVoiceOver(videoData, ttsInfo);
    if (exactTimings) videoData.lineTimings = exactTimings;

    console.log('3. Mengunduh & menyaring video HD Pixabay (Vision-QC + Prioritas Subjek/Habitat)...');
    await siapkanMediaPixabayLokal(videoData);
    await siapkanVisualSampul(videoData);

    videoData.audioUrl = 'vo.mp3';
    const charFile = cariFileKarakter();
    if (charFile) videoData.charUrl = charFile;

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
        if (typeof PORT !== 'undefined' && PORT) X.setTransform(CW / W, 0, 0, CH / H, 0, 0);
        X.save();
        X.clearRect(0, 0, W, H);
        const fn = (typeof SCN !== 'undefined' && SCN[curSc]) ? SCN[curSc] : (typeof SCN !== 'undefined' ? SCN.a : null);
        const lineStart = (L[li] && typeof L[li].t0 === 'number') ? L[li].t0 : 0;
        if (fn) fn((typeof COVER_HOLD !== 'undefined' && t < COVER_HOLD) ? t : Math.max(0, t - lineStart));
        X.restore();
        if (typeof drawTopProgressBar === 'function') drawTopProgressBar();
        if (typeof drawSubs === 'function') drawSubs();
        if (typeof drawWatermark === 'function') drawWatermark();
        if (typeof ov !== 'undefined') X.drawImage(ov, 0, 0, W, H);
        if (typeof PORT !== 'undefined' && !PORT && typeof composeFrame === 'function') composeFrame();
      };

      (function waitReadyPoll(){
        const iv = setInterval(async () => {
          if (window.__READY__ === true || window.__APP_READY__ === true) {
            clearInterval(iv);
            if (typeof L !== 'undefined' && L.length > 0) {
              const lastLine = L[L.length - 1];
              if (lastLine && typeof lastLine.se === 'number' && typeof LEN !== 'undefined') {
                LEN = Number((lastLine.se + 1.2).toFixed(2));
              }
              window.__SCENE_TIMES = L.map(x => ({ sc: x[0], t0: x.t0 || 0, fx: x[3] || '' }));
            }
            if (typeof LEN !== 'undefined') window.__VIDEO_LEN = LEN;
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

    const totalLenSec = await page.evaluate(() => window.__VIDEO_LEN);
    const sceneTimes = await page.evaluate(() => window.__SCENE_TIMES || []);
    const fps = 30;
    const totalFrames = Math.ceil(totalLenSec * fps);

    fs.rmSync('frames', { recursive: true, force: true });
    fs.mkdirSync('frames', { recursive: true });

    for (let f = 0; f < totalFrames; f++) {
      const tSec = f / fps;
      await page.evaluate((t) => window.__renderFrameAt(t), tSec);
      const framePath = path.join('frames', `f_${String(f).padStart(5, '0')}.jpg`);
      await page.screenshot({
        path: framePath,
        type: 'jpeg',
        quality: 96,
        clip: { x: 0, y: 0, width: outW, height: outH }
      });
      if (f % 150 === 0) console.log(`Render progress: ${f}/${totalFrames} frame...`);
    }

    await browser.close();
    server.close();

    console.log('6. Menggabungkan audio & merender MP4 final...');
    const seedNum = Array.from(videoData.title).reduce((a, c) => a + c.charCodeAt(0), 0);
    mixAudioWithBgmAndSfx('vo.mp3', sceneTimes, totalLenSec, seedNum, 'mixed_audio.wav', videoData.title);

    execSync(
      `ffmpeg -y -framerate ${fps} -i frames/f_%05d.jpg -i mixed_audio.wav ` +
      `-vf "scale=${outW}:${outH}:flags=lanczos,setsar=1" ` +
      `-c:v libx264 -preset fast -crf 19 -maxrate 5500k -bufsize 11000k -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart -shortest output_final.mp4`,
      { stdio: 'inherit' }
    );

    console.log('7. Menjalankan Auto Quality-Gate (dasar + context-aware vision audit)...');
    const durFinal = validasiVideoFinal('output_final.mp4');
    const audit = await auditKualitasFinal('output_final.mp4', videoData, durFinal);
    const privasi = audit.skor >= QC_MIN_SCORE ? YT_PRIVACY : YT_PRIVACY_FALLBACK;

    let youtubeUrl = null;
    let errUpload = '';
    try {
      youtubeUrl = await uploadDenganRetry('output_final.mp4', videoData, privasi);
    } catch (e) {
      errUpload = e.message;
      console.error('Upload YouTube gagal total:', e.message);
    }

    console.log('9. Mengirim laporan & video ke Telegram...');
    try {
      await kirimVideoTelegram('output_final.mp4', videoData, { youtubeUrl, audit, privasi, errUpload });
    } catch (e) {
      console.error('Telegram gagal (video sudah diproses):', e.message);
    }

    if (errUpload && !youtubeUrl) {
      console.error('Proses selesai, tetapi upload YouTube gagal.');
      process.exit(1);
    }
    console.log('=== SEMUA PROSES SELESAI 100%! ===');
  } catch (err) {
    console.error('TERJADI ERROR:', err);
    await kirimPesanTelegram(`❌ *GAGAL PROSES VIDEO!*\n\nError: \`${err.message}\``);
    process.exit(1);
  }
})();
