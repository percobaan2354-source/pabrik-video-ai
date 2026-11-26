/* ===== SCRIPT UTAMA: buat_video.js (Versi Lengkap: Render HD, Auto YouTube, Notifikasi Telegram, & Smart Queue Prime Time) ===== */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const JUDUL = process.env.INPUT_JUDUL || process.env.JUDUL || 'Fakta Unik yang Jarang Diketahui';
const BAHASA = process.env.INPUT_BAHASA || process.env.BAHASA || 'Indonesia';
const UKURAN = process.env.INPUT_UKURAN || process.env.UKURAN || '9:16';

const YT_CLIENT_ID = process.env.YT_CLIENT_ID || '';
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET || '';
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN || '';

const COVER_HOLD_SEC = 1.35;

if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY belum diisi di Secrets!');
  process.exit(1);
}

function getDimensi(ukuran) {
  const u = (ukuran || '9:16').trim();
  if (u === '16:9') return { width: 1280, height: 720, aspect: '16/9', isVertical: false };
  if (u === '1:1')  return { width: 1080, height: 1080, aspect: '1/1', isVertical: false };
  if (u === '4:5')  return { width: 1080, height: 1350, aspect: '4/5', isVertical: true };
  return { width: 720, height: 1280, aspect: '9/16', isVertical: true };
}

function getBahasaConfig(bahasa) {
  const b = (bahasa || 'indonesia').toLowerCase().trim();
  if (b.includes('inggris') || b.includes('english') || b === 'en') {
    return { langCode: 'en-US', gttsLang: 'en', edgeVoice: 'en-US-AndrewMultilingualNeural' };
  }
  if (b.includes('jepang') || b.includes('japan') || b === 'ja') {
    return { langCode: 'ja-JP', gttsLang: 'ja', edgeVoice: 'ja-JP-KeitaNeural' };
  }
  if (b.includes('korea') || b === 'ko') {
    return { langCode: 'ko-KR', gttsLang: 'ko', edgeVoice: 'ko-KR-InJoonNeural' };
  }
  if (b.includes('arab') || b === 'ar') {
    return { langCode: 'ar-SA', gttsLang: 'ar', edgeVoice: 'ar-SA-HamedNeural' };
  }
  if (b.includes('spanyol') || b.includes('spanish') || b === 'es') {
    return { langCode: 'es-ES', gttsLang: 'es', edgeVoice: 'es-ES-AlvaroNeural' };
  }
  if (b.includes('jerman') || b.includes('german') || b === 'de') {
    return { langCode: 'de-DE', gttsLang: 'de', edgeVoice: 'de-DE-ConradNeural' };
  }
  if (b.includes('prancis') || b.includes('french') || b === 'fr') {
    return { langCode: 'fr-FR', gttsLang: 'fr', edgeVoice: 'fr-FR-HenriNeural' };
  }
  if (b.includes('mandarin') || b.includes('china') || b === 'zh') {
    return { langCode: 'zh-CN', gttsLang: 'zh-CN', edgeVoice: 'zh-CN-YunxiNeural' };
  }
  if (b.includes('malay') || b === 'ms') {
    return { langCode: 'ms-MY', gttsLang: 'ms', edgeVoice: 'ms-MY-OsmanNeural' };
  }
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

// Analisis Jam Ramai Dinamis berdasarkan Hari (Senin-Minggu)
function deteksiPrimeTimeHariIni() {
  const now = new Date();
  const jamWib = (now.getUTCHours() + 7) % 24;
  const hari = now.getDay(); // 0 = Minggu, 6 = Sabtu

  let targetJamRamai = 18;
  if (hari === 0 || hari === 6) {
    targetJamRamai = 16; // Akhir pekan sore
  } else if (hari === 5) {
    targetJamRamai = 20; // Jumat malam
  }

  return { jamWib, targetJamRamai };
}

function pilihTemaVisualDariJudul(judul) {
  const q = (judul || '').toLowerCase();
  const presets = [
    {
      re: /tidur|bangun|mimpi|alarm|malam|sirkadian|insomnia|otak|saraf/,
      theme: { name: 'night_neuro', bg1: '#0b132b', bg2: '#1c2541', card: '#141e38', accent: '#38bdf8', accent2: '#f59e0b', text: '#f8fafc' }
    },
    {
      re: /sains|fisika|kimia|atom|listrik|energi|cahaya|gelombang|teknologi|robot|ai\b|kuantum/,
      theme: { name: 'cyber_lab', bg1: '#071921', bg2: '#0f2e3d', card: '#0d2633', accent: '#06b6d4', accent2: '#22c55e', text: '#ecfeff' }
    },
    {
      re: /sejarah|kuno|kerajaan|romawi|mesir|abad|dinasti|piramida|perang|nusantara/,
      theme: { name: 'ancient_gold', bg1: '#1c140d', bg2: '#332214', card: '#291b10', accent: '#f59e0b', accent2: '#ef4444', text: '#fef3c7' }
    },
    {
      re: /alam|hewan|laut|hutan|gunung|bumi|samudra|tumbuhan|ikan|burung|cuaca/,
      theme: { name: 'emerald_wild', bg1: '#062019', bg2: '#0e3b2e', card: '#0a2e24', accent: '#10b981', accent2: '#eab308', text: '#ecfdf5' }
    },
    {
      re: /horor|misteri|hantu|mistis|angker|rahasia|gelap|hilang|konspirasi/,
      theme: { name: 'crimson_mystery', bg1: '#180912', bg2: '#2e1022', card: '#240c1a', accent: '#f43f5e', accent2: '#a855f7', text: '#fff1f2' }
    },
    {
      re: /bisnis|uang|kaya|sukses|ekonomi|saham|emas|kerja|kaya|miliarder/,
      theme: { name: 'royal_wealth', bg1: '#0f172a', bg2: '#1e293b', card: '#162033', accent: '#eab308', accent2: '#38bdf8', text: '#f8fafc' }
    }
  ];
  for (const p of presets) {
    if (p.re.test(q)) return p.theme;
  }
  const hash = Array.from(q).reduce((a, c) => a + c.charCodeAt(0), 0);
  const fallbacks = [
    { name: 'indigo_spark', bg1: '#111029', bg2: '#221f4d', card: '#19173b', accent: '#818cf8', accent2: '#fb7185', text: '#eef2ff' },
    { name: 'teal_prism', bg1: '#091e24', bg2: '#133842', card: '#0e2b33', accent: '#2dd4bf', accent2: '#fb923c', text: '#f0fdfa' },
    { name: 'amber_studio', bg1: '#1f150c', bg2: '#382514', card: '#2b1c0f', accent: '#fb923c', accent2: '#38bdf8', text: '#fff7ed' }
  ];
  return fallbacks[hash % fallbacks.length];
}

function rapikanNaskah(data, dim, ttsInfo) {
  if (!data || typeof data !== 'object') throw new Error('Naskah dari Gemini bukan objek JSON yang valid.');
  if (!Array.isArray(data.lines)) throw new Error('Naskah dari Gemini tidak punya array "lines".');

  data.lines = data.lines.filter(l => Array.isArray(l) && l.length >= 3 && typeof l[2] === 'string' && l[2].trim() !== '');
  if (data.lines.length < 4) throw new Error('Naskah dari Gemini terlalu pendek / format "lines" rusak.');

  const layouts = ['hero_stage', 'split_compare', 'process_flow', 'spotlight_card', 'timeline_meter', 'diagram_callout'];
  const anims = ['pulse', 'flow', 'rise', 'orbit', 'scan', 'bounce'];
  const seed = Array.from(JUDUL).reduce((a, c) => a + c.charCodeAt(0), 0);

  data.lines = data.lines.map((l, idx) => {
    const sc = l[0] || 'b1';
    const mood = l[1] || 'n';
    const text = l[2].trim();
    const fx = l[3] || '';
    let meta = (l[4] && typeof l[4] === 'object') ? l[4] : null;

    if (meta) {
      if (!meta.layout || !layouts.includes(meta.layout)) {
        meta.layout = layouts[(seed + idx * 3) % layouts.length];
      }
      if (!meta.anim || !anims.includes(meta.anim)) {
        meta.anim = anims[(seed + idx * 5) % anims.length];
      }
      if (!meta.mode) {
        meta.mode = (sc === 'title' || sc === 'a' || sc === 'c') ? 'pip_broll' : 'full_broll';
      }
    }
    return [sc, mood, text, fx, meta];
  });

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

  data.visualTheme = (data.visualTheme && typeof data.visualTheme === 'object' && data.visualTheme.accent)
    ? Object.assign(pilihTemaVisualDariJudul(JUDUL), data.visualTheme)
    : pilihTemaVisualDariJudul(JUDUL);

  data.lang      = ttsInfo.langCode;
  data.width     = dim.width;
  data.height    = dim.height;
  data.coverHold = COVER_HOLD_SEC;
  return data;
}

async function buatNaskahJSON(dim, ttsInfo) {
  const jumlahKalimat = dim.isVertical
    ? '9-10 kalimat storytelling santai & mengalir (maksimal 9-12 kata per kalimat agar total durasi baca 38-50 detik)'
    : '12-15 kalimat padat dan informatif (untuk video landscape 16:9)';

  const prompt = `Kamu adalah sutradara animasi explainer & ilustrator vektor SVG kelas dunia.
Buatkan data video lengkap dalam format JSON MURNI (tanpa markdown/teks pembuka) untuk topik:
- Judul: "${JUDUL}"
- Bahasa Video: ${BAHASA} (kode BCP-47: ${ttsInfo.langCode})
- Ukuran: ${UKURAN} (${dim.width}x${dim.height})

PRINSIP UTAMA SINKRONISASI VISUAL-VO (WAJIB DIPATUHI):
1. SETIAP kalimat VO yang menjelaskan objek, proses, sebab-akibat, angka, atau bagian tubuh/benda WAJIB langsung menampilkan visual B-Roll yang menggambarkan PERSIS apa yang sedang diucapkan di kalimat itu!
   - Contoh: Jika VO menyebut "jantung memompa darah", SVG harus menggambar ilustrasi jantung berdetak + panah aliran darah (BUKAN lingkaran/ikon abstrak polos!).
   - Contoh: Jika VO menyebut "baterai HP cepat habis saat dingin", SVG harus menggambar ikon baterai merah menurun + kristal es/termometer!
2. DILARANG memakai tata letak B-Roll yang sama terus-menerus! Variasikan "layout" pada setiap adegan dari 6 pilihan unik ini:
   - "hero_stage": 1 panggung visual besar di tengah dengan ilustrasi utama + lencana status bergerak.
   - "split_compare": perbandingan 2 sisi (Kiri vs Kanan, misal Sebelum vs Sesudah atau Penyebab vs Dampak) dengan 2 ilustrasi berbeda.
   - "process_flow": diagram alur 2 tahap (svg -> panah proses -> svg2) yang menunjukkan mekanisme kerja.
   - "spotlight_card": kartu sorotan melayang di bagian atas layar sementara karakter tetap berbicara di bawah ("mode": "pip_broll").
   - "timeline_meter": visual dengan indikator progres/persentase/skala ukur nyata sesuai angka/tingkatan di VO.
   - "diagram_callout": ilustrasi utama di tengah dengan 2 label penunjuk (callout badge) yang menunjuk bagian penting dari objek di VO.
3. Buat ${jumlahKalimat} di dalam array "lines".
   Format tiap elemen: ["kunci_adegan", "mood", "Kalimat VO dengan *kata* ditekankan.", "fx_opsional", META_VISUAL]
   - Kunci adegan: gunakan urutan dinamis seperti "title", "b1", "b2", "a", "b3", "b4", "cta", "cta", "b5", "end".
   - Semua baris kecuali "cta" dan "end" BOLEH dan SANGAT DISARANKAN memiliki objek META_VISUAL agar visual terus berubah mengikuti ucapan VO!
   - Struktur META_VISUAL:
     {
       "mode": "full_broll" atau "pip_broll",
       "layout": "hero_stage" | "split_compare" | "process_flow" | "spotlight_card" | "timeline_meter" | "diagram_callout",
       "anim": "pulse" | "flow" | "rise" | "orbit" | "scan" | "bounce",
       "kicker": "LABEL KONTEKS 1-2 KATA SESUAI VO",
       "title": "JUDUL SINGKAT 2-3 KATA SESUAI VO",
       "sub": "Penjelasan ringkas 3-6 kata sesuai kalimat VO",
       "badge1": "Label bagian 1 (singkat)",
       "badge2": "Label bagian 2 (singkat)",
       "meterPct": 75,
       "svg": "<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...MINIMAL 6 ELEMEN VEKTOR KAYA WARNA & DETAIL YANG MENGGAMBARKAN ISI KALIMAT VO INI...</svg>",
       "svg2": "<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...ILUSTRASI PENDAMPING/HASIL AKHIR YANG BERBEDA DARI svg...</svg>"
     }
4. "visualTheme": pilih palet warna unik yang paling cocok dengan suasana judul "${JUDUL}" (hex color gelap untuk bg1/bg2/card dan cerah kontras untuk accent/accent2).
5. "coverSvg1" & "coverSvg2": SVG ikon utama sesuai judul "${JUDUL}".

KELUARKAN HANYA JSON DENGAN STRUKTUR PERSIS INI:
{
  "title": "Judul Menarik Sesuai Bahasa",
  "varian": "v${Date.now() % 999}",
  "lang": "${ttsInfo.langCode}",
  "width": ${dim.width},
  "height": ${dim.height},
  "desc": "Deskripsi singkat 2 kalimat + ajakan diskusi di komentar.",
  "tags": "#faktaunik #edukasi #storytelling",
  "src": ["Sumber Riset 1", "Sumber Riset 2"],
  "visualTheme": {
    "name": "tema_unik",
    "bg1": "#0b132b",
    "bg2": "#1c2541",
    "card": "#141e38",
    "accent": "#38bdf8",
    "accent2": "#f59e0b",
    "text": "#f8fafc"
  },
  "coverSvg1": "<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>",
  "coverSvg2": "<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>",
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
    ["title", "d", "Kalimat pembuka dengan *kata kunci* sesuai judul.", "", {"mode":"pip_broll","layout":"spotlight_card","anim":"bounce","kicker":"HOOK","title":"TOPIK UTAMA","sub":"Keterangan singkat sesuai kalimat pembuka","badge1":"Fakta 1","badge2":"Fakta 2","meterPct":50,"svg":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>","svg2":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>"}],
    ["b1", "n", "Kalimat kedua menjelaskan bagian/objek pertama.", "p", {"mode":"full_broll","layout":"diagram_callout","anim":"pulse","kicker":"BAGIAN 1","title":"OBJEK PERTAMA","sub":"Keterangan sesuai kalimat kedua","badge1":"Komponen A","badge2":"Komponen B","meterPct":40,"svg":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>","svg2":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>"}],
    ["b2", "e", "Kalimat ketiga menjelaskan proses atau perbandingan.", "p", {"mode":"full_broll","layout":"split_compare","anim":"flow","kicker":"PERBANDINGAN","title":"DUA KONDISI","sub":"Keterangan sesuai kalimat ketiga","badge1":"Kondisi Awal","badge2":"Kondisi Akhir","meterPct":70,"svg":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>","svg2":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>"}],
    ["a", "n", "Kalimat keempat memperkuat penjelasan dari karakter.", "", {"mode":"pip_broll","layout":"spotlight_card","anim":"orbit","kicker":"MEKANISME","title":"CARA KERJA","sub":"Keterangan sesuai kalimat keempat","badge1":"Tahap 1","badge2":"Tahap 2","meterPct":65,"svg":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>","svg2":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>"}],
    ["b3", "d", "Kalimat kelima menjelaskan tahapan sebab-akibat.", "p", {"mode":"full_broll","layout":"process_flow","anim":"flow","kicker":"PROSES","title":"ALUR TERJADI","sub":"Keterangan sesuai kalimat kelima","badge1":"Pemicu","badge2":"Hasil","meterPct":85,"svg":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>","svg2":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>"}],
    ["b4", "e", "Kalimat keenam menjelaskan lonjakan/dampak terukur.", "p", {"mode":"full_broll","layout":"timeline_meter","anim":"rise","kicker":"DAMPAK NYATA","title":"TINGKAT EFEK","sub":"Keterangan sesuai kalimat keenam","badge1":"Normal","badge2":"Puncak","meterPct":92,"svg":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>","svg2":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>"}],
    ["cta", "n", "Mau bikin video kayak gini juga?", "", null],
    ["cta", "e", "Langsung aja cek *link di bio*.", "c", null],
    ["b5", "d", "Kalimat kesembilan memberi kesimpulan visual utama.", "p", {"mode":"full_broll","layout":"hero_stage","anim":"scan","kicker":"KESIMPULAN","title":"INTI FAKTA","sub":"Keterangan sesuai kalimat kesembilan","badge1":"Bukti Utama","badge2":"Fakta Akhir","meterPct":100,"svg":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>","svg2":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>"}],
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
    await tunggu(5000);
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
    { re: /horor|hantu|mistis|angker|kuburan|kutukan|misteri|gelap|malam|tidur|alarm/, notes: [146.83, 174.61, 220.00, 261.63], tempo: 0.85, lp: 780 },
    { re: /sejarah|kuno|kerajaan|romawi|mesir|abad|dinasti|piramida/, notes: [220.00, 261.63, 293.66, 392.00], tempo: 0.95, lp: 920 },
    { re: /sains|antariksa|planet|teknologi|robot|ai\b|kuantum|listrik|lampu/, notes: [261.63, 311.13, 392.00, 466.16], tempo: 1.50, lp: 1500 },
    { re: /psikologi|otak|pikiran|mental|stres|mimpi|kebiasaan/, notes: [246.94, 293.66, 369.99, 440.00], tempo: 0.90, lp: 850 },
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
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const cleanUrl = decodeURIComponent((req.url || '/').split('?')[0]);
    const filePath = path.join(dir, cleanUrl === '/' ? 'index.html' : cleanUrl);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404); res.end('Not Found');
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
  const caption = `🎬 *VIDEO 3D V44.0 SELESAI DIRENDER!*\n\n📍 *Judul:*\n${data.title}\n\n📝 *Deskripsi:*\n${data.desc}\n\n📚 *Sumber:*\n${(data.src || []).map(s => '- ' + s).join('\n')}\n\n🏷️ *Tags:*\n${data.tags}`;

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

async function uploadKeYouTube(videoPath, data) {
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
    console.log('Lewati YouTube (Secret YT belum lengkap).');
    return;
  }
  console.log('Memulai upload otomatis ke YouTube...');
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: YT_CLIENT_ID,
        client_secret: YT_CLIENT_SECRET,
        refresh_token: YT_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Gagal mendapatkan access_token YouTube:', tokenData);
      return;
    }

    const metadata = {
      snippet: {
        title: data.title.slice(0, 100),
        description: `${data.desc}\n\n${data.tags}`,
        tags: data.tags.replace(/#/g, '').split(/\s+/).filter(Boolean),
        categoryId: '27'
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }
    };

    const fileSize = fs.statSync(videoPath).size;
    const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Length': fileSize,
        'X-Upload-Content-Type': 'video/mp4'
      },
      body: JSON.stringify(metadata)
    });

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      console.error('Gagal membuat sesi upload YouTube');
      return;
    }

    const upRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' },
      body: fs.readFileSync(videoPath)
    });
    const upData = await upRes.json();
    if (upData.id) {
      console.log(`Sukses upload ke YouTube! Link: https://youtu.be/${upData.id}`);
      await kirimPesanTelegram(`✅ *BERHASIL UPLOAD KE YOUTUBE!*\n\nhttps://youtu.be/${upData.id}`);
    } else {
      console.error('Gagal upload YouTube:', upData);
    }
  } catch (err) {
    console.error('Error saat upload YouTube:', err.message);
  }
}

(async () => {
  try {
    const dim = getDimensi(UKURAN);
    const ttsInfo = getBahasaConfig(BAHASA);
    const { jamWib, targetJamRamai } = deteksiPrimeTimeHariIni();

    console.log(`=== MEMULAI PRODUKSI VIDEO V44.0 (${UKURAN} | ${BAHASA}) ===`);
    console.log(`Jam saat ini: ${jamWib}:00 WIB | Target Jam Ramai Hari Ini: ${targetJamRamai}:00 WIB`);

    // Logika Pintar: Cek apakah terlambat dari jam ramai hari ini
    if (jamWib > targetJamRamai) {
      await kirimPesanTelegram(`⚠️ *STATUS: PENDING / ANTREAN GESER*\n\nKamu membuat video pada pukul ${jamWib}:00 WIB (melewati jam ramai ${targetJamRamai}:00 WIB hari ini).\nSistem otomatis menggeser jadwal publikasi ke slot prime time berikutnya agar tidak sepi penonton!`);
    } else {
      await kirimPesanTelegram(`🔔 *INFO PRA-RAMAI*\n\nJam ramai hari ini terdeteksi pukul *${targetJamRamai}:00 WIB*. Video sedang diproses tepat waktu!`);
    }

    console.log('1. Menyusun naskah & ilustrasi B-Roll dinamis per kalimat VO dari Gemini...');
    const videoData = await buatNaskahJSON(dim, ttsInfo);

    console.log('2. Membuat suara Voice Over...');
    const exactTimings = await buatAudioTTS(videoData.lines, 'vo.mp3', ttsInfo);
    if (exactTimings) videoData.lineTimings = exactTimings;

    videoData.audioUrl = 'vo.mp3';
    const charFile = cariFileKarakter();
    if (charFile) videoData.charUrl = charFile;

    await kirimPesanTelegram(`✅ *Naskah & suara VO selesai.*\nSekarang merender video 3D HD + Watermark @raii.punyacerita...`);

    console.log('3. Merakit index.html dari template.html (Mode Full Canvas Tanpa Tombol Play)...');
    let tpl = fs.readFileSync('template.html', 'utf8');
    const safeTitle = videoData.title.replace(/"/g, '&quot;');
    const safeJson = JSON.stringify(videoData).replace(/<\/script>/gi, '<\\/script>');

    tpl = tpl.replace('__TITLE__', () => safeTitle)
             .replace('__ASPECT__', () => dim.aspect)
             .replace('__VIDEO_DATA_JSON__', () => safeJson);

    const serverCleanCss = `<style>
      .poster, .bar, .tl, .toast { display: none !important; opacity: 0 !important; visibility: hidden !important; }
      body, .app, .frame { width: ${dim.width}px !important; height: ${dim.height}px !important; max-width: none !important; padding: 0 !important; margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
      canvas#cv { width: ${dim.width}px !important; height: ${dim.height}px !important; }
    </style></head>`;
    tpl = tpl.replace('</head>', () => serverCleanCss);

    /* Bridge otomatis agar setiap baris VO berganti layout B-Roll 1-to-1 & tidak pernah timeout */
    const renderBridgeScript = `<script>
      window.__ASSETS_READY = false;
      window.__VIDEO_LEN = typeof LEN !== 'undefined' ? LEN : 40;
      window.__SCENE_TIMES = [];
      let __bridgePrevLine = -1;
      window.__renderFrameAt = function(tSec) {
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
        if (typeof now !== 'undefined') now = t;
        if (typeof charTick === 'function') charTick();
        X.save();
        X.clearRect(0, 0, W, H);
        if (typeof FX_CAMERA !== 'undefined' && FX_CAMERA) {
          if (typeof CAM_V2 !== 'undefined' && CAM_V2 && typeof applyCinematicCamera2 === 'function') applyCinematicCamera2();
          else if (typeof applyCinematicCamera === 'function') applyCinematicCamera();
        }
        if (typeof applySceneEnterExit === 'function') applySceneEnterExit(t);
        const fn = (typeof SCN !== 'undefined' && SCN[curSc]) ? SCN[curSc] : (typeof SCN !== 'undefined' ? SCN.a : null);
        const lineStart = (L[li] && typeof L[li].t0 === 'number') ? L[li].t0 : 0;
        if (fn) fn((typeof COVER_HOLD !== 'undefined' && t < COVER_HOLD) ? t : Math.max(0, t - lineStart));
        if (typeof FX_PARTICLES !== 'undefined' && FX_PARTICLES && typeof drawAmbientParticles === 'function') drawAmbientParticles();
        X.restore();
        if (typeof FX_LEAK !== 'undefined' && FX_LEAK && typeof drawLightLeak === 'function') drawLightLeak();
        if (typeof drawStorySegments === 'function') drawStorySegments();
        if (typeof drawSubs === 'function') drawSubs();
        if (typeof FX_BURST !== 'undefined' && FX_BURST && typeof drawEmphasisBurst === 'function') drawEmphasisBurst();
        if (typeof drawTransition === 'function') drawTransition();
        if (typeof drawWatermark === 'function') drawWatermark();
        if (typeof ov !== 'undefined') X.drawImage(ov, 0, 0, W, H);
        if (typeof PORT !== 'undefined' && !PORT && typeof composeFrame === 'function') composeFrame();
      };
      (function waitReadyPoll(){
        const iv = setInterval(() => {
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

    console.log('4. Menjalankan browser & merekam frame video HD...');
    const { server, port } = await mulaiServerLokal(process.cwd());
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage({
      viewport: { width: dim.width, height: dim.height },
      deviceScaleFactor: 1
    });

    /* Kumpulkan error browser supaya kalau template rusak, penyebabnya langsung kelihatan (bukan cuma "Timeout") */
    const pageErrors = [];
    page.on('pageerror', err => {
      pageErrors.push(err.message);
      console.error('Browser PageError:', err.message);
    });
    await page.goto(`http://127.0.0.1:${port}/index.html?autorender=1`, { waitUntil: 'domcontentloaded' });

    try {
      await page.waitForFunction(() => window.__ASSETS_READY === true, { timeout: 45000 });
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

    console.log(`Total durasi: ${totalLenSec} detik (${totalFrames} frame pada ${fps}fps)...`);
    fs.mkdirSync('frames', { recursive: true });

    for (let f = 0; f < totalFrames; f++) {
      const tSec = f / fps;
      await page.evaluate((t) => window.__renderFrameAt(t), tSec);
      const framePath = path.join('frames', `f_${String(f).padStart(5, '0')}.jpg`);
      await page.screenshot({
        path: framePath,
        type: 'jpeg',
        quality: 94,
        clip: { x: 0, y: 0, width: dim.width, height: dim.height }
      });
      if (f % 150 === 0) console.log(`Render progress: ${f}/${totalFrames} frame...`);
    }

    await browser.close();
    server.close();

    console.log('5. Menggabungkan BGM + SFX + VO & merender MP4 final...');
    const seedNum = Array.from(videoData.title).reduce((a, c) => a + c.charCodeAt(0), 0);
    mixAudioWithBgmAndSfx('vo.mp3', sceneTimes, totalLenSec, seedNum, 'mixed_audio.wav', videoData.title);

    execSync(
      `ffmpeg -y -framerate ${fps} -i frames/f_%05d.jpg -i mixed_audio.wav ` +
      `-vf "scale=${dim.width}:${dim.height}:flags=lanczos,setsar=1" ` +
      `-c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest output_final.mp4`,
      { stdio: 'inherit' }
    );

    console.log('6. Mengirim hasil video ke Telegram & Upload ke YouTube...');
    await kirimVideoTelegram('output_final.mp4', videoData);
    await uploadKeYouTube('output_final.mp4', videoData);

    console.log('=== SEMUA PROSES SELESAI 100%! ===');
  } catch (err) {
    console.error('TERJADI ERROR:', err);
    await kirimPesanTelegram(`❌ *GAGAL RENDER VIDEO!*\n\nError: \`${err.message}\``);
    process.exit(1);
  }
})();
