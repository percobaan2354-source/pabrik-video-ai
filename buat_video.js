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
  // [UPGRADE] Ukuran 9:16 dibuat proporsional (720x1280) agar video tidak kepanjangan dan subtitle tidak menimpa karakter
  return { width: 720, height: 1280, aspect: '9/16' };
}

// ============================================================
// [UPGRADE] Mesin 1.000+ Tema Visual, Font Sampul, Gambar Sampul,
// Background Karakter & Variasi Bentuk B-Roll Full + Mini
// ============================================================
function hashJudul(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function bangunProfilVisual1000Plus(judul) {
  const j = judul.toLowerCase();
  const seed = hashJudul(judul);

  const paletList = [
    { name: 'bara_sejarah', primary: '#d97706', secondary: '#7c2d12', bg: '#160e09', accent: '#fbbf24' },
    { name: 'biometrik_cyan', primary: '#06b6d4', secondary: '#0e7490', bg: '#06131c', accent: '#67e8f9' },
    { name: 'noir_kriminal', primary: '#e11d48', secondary: '#881337', bg: '#11090d', accent: '#fda4af' },
    { name: 'zamrud_alam', primary: '#10b981', secondary: '#065f46', bg: '#061712', accent: '#6ee7b7' },
    { name: 'nebula_ungu', primary: '#8b5cf6', secondary: '#4c1d95', bg: '#0d091a', accent: '#c4b5fd' },
    { name: 'emas_kerajaan', primary: '#eab308', secondary: '#713f12', bg: '#171207', accent: '#fef08a' },
    { name: 'samudra_dalam', primary: '#3b82f6', secondary: '#1e3a8a', bg: '#070f21', accent: '#93c5fd' },
    { name: 'magma_vulkanik', primary: '#f97316', secondary: '#9a3412', bg: '#190c06', accent: '#fdba74' },
    { name: 'matrix_siber', primary: '#22c55e', secondary: '#14532d', bg: '#05140a', accent: '#86efac' },
    { name: 'perak_arsip', primary: '#94a3b8', secondary: '#334155', bg: '#0c1017', accent: '#e2e8f0' },
    { name: 'magenta_psikologi', primary: '#ec4899', secondary: '#831843', bg: '#170812', accent: '#f9a8d4' },
    { name: 'terakota_kuno', primary: '#ea580c', secondary: '#7c2d12', bg: '#1a0f0a', accent: '#fed7aa' }
  ];

  const fontSampulList = [
    { name: 'Cinzel', family: "'Cinzel', serif", weight: '900', spacing: '0.06em', transform: 'uppercase' },
    { name: 'Orbitron', family: "'Orbitron', sans-serif", weight: '900', spacing: '0.08em', transform: 'uppercase' },
    { name: 'Bebas Neue', family: "'Bebas Neue', sans-serif", weight: '700', spacing: '0.05em', transform: 'uppercase' },
    { name: 'Playfair Display', family: "'Playfair Display', serif", weight: '900', spacing: '0.02em', transform: 'none' },
    { name: 'Anton', family: "'Anton', sans-serif", weight: '400', spacing: '0.03em', transform: 'uppercase' },
    { name: 'Space Grotesk', family: "'Space Grotesk', sans-serif", weight: '700', spacing: '0.01em', transform: 'uppercase' },
    { name: 'Oswald', family: "'Oswald', sans-serif", weight: '700', spacing: '0.04em', transform: 'uppercase' },
    { name: 'Righteous', family: "'Righteous', cursive", weight: '400', spacing: '0.03em', transform: 'uppercase' },
    { name: 'Montserrat', family: "'Montserrat', sans-serif", weight: '900', spacing: '0.02em', transform: 'uppercase' },
    { name: 'Merriweather', family: "'Merriweather', serif", weight: '900', spacing: '0.01em', transform: 'none' },
    { name: 'Syne', family: "'Syne', sans-serif", weight: '800', spacing: '0.02em', transform: 'uppercase' },
    { name: 'Chakra Petch', family: "'Chakra Petch', sans-serif", weight: '700', spacing: '0.05em', transform: 'uppercase' }
  ];

  const coverBgList = [
    'perkamen_peta_kuno', 'radar_biometrik', 'berkas_rahasia_noir', 'nebula_bintang',
    'gelombang_akustik', 'arsitektur_kolom', 'sirkuit_hologram', 'topografi_gunung',
    'koran_investigasi', 'prisma_geometris', 'laboratorium_dna', 'cakrawala_kota'
  ];

  const charBgList = [
    'peta_bara_bergerak', 'gelombang_saraf_aktif', 'sorot_lampu_kabut', 'kontur_elevasi',
    'partikel_emas_melayang', 'grid_perspektif_3d', 'lingkaran_astrolabe', 'garis_detak_jantung',
    'hujan_data_halus', 'cahaya_katedral', 'orbit_planet_tipis', 'arsiran_sketsa_kuno'
  ];

  const brollFullShapeList = [
    'perkamen_sobek_sejarah', 'monitor_medis_hud', 'folder_polaroid_kasus', 'radar_orbit_bulat',
    'koran_headline_klasik', 'terminal_data_futuristik', 'peta_taktis_bergaris', 'kartu_museum_bingkai',
    'panel_kaca_prisma', 'timeline_vertikal_emas', 'layar_bioskop_vignette', 'lembar_blueprint_teknik'
  ];

  const brollMiniShapeList = [
    'lencana_perisai', 'kapsul_biometrik', 'stempel_rahasia_miring', 'kompas_koordinat',
    'etiket_arsip_kertas', 'pil_neon_sudut', 'medali_segi_delapan', 'label_mikroskop',
    'gelembung_chat_tajam', 'kartu_tiket_berlubang', 'tag_hologram_sudut', 'plakat_perunggu'
  ];

  let kategori = 'FAKTA & WAWASAN';
  let bias = 0;
  let defaultSvg = `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><circle cx="100" cy="100" r="72"/><path d="M100 45v55l38 22"/><circle cx="100" cy="100" r="10" fill="currentColor"/></svg>`;

  if (/perang|sejarah|kerajaan|kaisar|tentara|kuno|abad|penjajah|revolusi|inca|spanyol|romawi|mesir/.test(j)) {
    kategori = 'SEJARAH & PERADABAN';
    bias = 0;
    defaultSvg = `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><path d="M100 24L162 52v52c0 42-26 68-62 80-36-12-62-38-62-80V52L100 24z"/><path d="M72 132L128 76M128 132L72 76"/></svg>`;
  } else if (/otak|tubuh|bersin|tidur|jantung|saraf|medis|dokter|penyakit|darah|mata|psikologi|manusia/.test(j)) {
    kategori = 'SAINS & TUBUH MANUSIA';
    bias = 1;
    defaultSvg = `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><path d="M22 104h36l16-38 24 72 20-52 14 18h46"/><circle cx="100" cy="100" r="78" stroke-dasharray="10 8"/></svg>`;
  } else if (/misteri|hantu|hilang|kapal|kutukan|rahasia|aneh|gelap|pencurian|kasus|detektif|konspirasi/.test(j)) {
    kategori = 'MISTERI & INVESTIGASI';
    bias = 2;
    defaultSvg = `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><circle cx="90" cy="90" r="52"/><path d="M128 128l44 44" stroke-width="8" stroke-linecap="round"/><path d="M74 84c0-10 8-18 18-18s16 7 16 16c0 9-12 12-12 22"/><circle cx="96" cy="116" r="3" fill="currentColor"/></svg>`;
  } else if (/luar angkasa|planet|bintang|alam semesta|bumi|laut|samudra|gunung|hewan|dinosaurus|alam/.test(j)) {
    kategori = 'ALAM & ANTARIKSA';
    bias = 3;
    defaultSvg = `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><circle cx="100" cy="100" r="46"/><ellipse cx="100" cy="100" rx="86" ry="26" transform="rotate(-22 100 100)"/><circle cx="152" cy="64" r="7" fill="currentColor"/></svg>`;
  } else if (/uang|kaya|ekonomi|bisnis|perusahaan|miliar|triliun|harga|emas|bank|saham/.test(j)) {
    kategori = 'EKONOMI & STRATEGI';
    bias = 5;
    defaultSvg = `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><path d="M32 148h136M48 148V96h24v52M88 148V72h24v76M128 148V46h24v102"/><path d="M44 76l44-28 28 14 40-32"/></svg>`;
  }

  const palet     = paletList[(seed + bias) % paletList.length];
  const fontCover = fontSampulList[(seed >>> 3) % fontSampulList.length];
  const coverBg   = coverBgList[(seed >>> 5) % coverBgList.length];
  const charBg    = charBgList[(seed >>> 7) % charBgList.length];
  const brollFull = brollFullShapeList[(seed >>> 9) % brollFullShapeList.length];
  const brollMini = brollMiniShapeList[(seed >>> 11) % brollMiniShapeList.length];

  return {
    theme_id: `T${(seed % 8999) + 1000}`,
    kategori,
    cover_style: coverBg,
    char_bg_style: charBg,
    broll_full_shape: brollFull,
    broll_mini_shape: brollMini,
    cover_font: fontCover,
    cover_illustration_svg: defaultSvg,
    palette: palet
  };
}

function pilihSuaraTTS(bahasa) {
  const b = bahasa.toLowerCase();
  // [UPGRADE] Perbaikan bug: kata "indonesia" mengandung "es" sehingga dulu bisa salah terbaca Spanyol
  if (b.includes('indonesia') || b === 'id') {
    return { langCode: 'id-ID', voice: 'id-ID-ArdiNeural' };
  }
  if (b.includes('inggris') || b.includes('english') || b === 'en') {
    return { langCode: 'en-US', voice: 'en-US-AndrewNeural' };
  }
  if (b.includes('jepang') || b.includes('japan') || b === 'ja') {
    return { langCode: 'ja-JP', voice: 'ja-JP-KeitaNeural' };
  }
  if (b.includes('korea') || b === 'ko') {
    return { langCode: 'ko-KR', voice: 'ko-KR-InJoonNeural' };
  }
  if (b.includes('arab') || b === 'ar') {
    return { langCode: 'ar-SA', voice: 'ar-SA-HamedNeural' };
  }
  if (b.includes('spanyol') || b.includes('spanish') || b === 'es') {
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
function rapikanNaskah(data, dim, ttsInfo, profilVisual) {
  if (!data || typeof data !== 'object') throw new Error('Naskah dari Gemini bukan objek JSON yang valid.');

  if (!Array.isArray(data.lines)) throw new Error('Naskah dari Gemini tidak punya array "lines".');
  data.lines = data.lines.filter(l => Array.isArray(l) && l.length >= 3 && typeof l[2] === 'string' && l[2].trim() !== '');
  if (data.lines.length < 3) throw new Error('Naskah dari Gemini terlalu pendek / format "lines" rusak.');

  const defaultTx = {
    kicker: profilVisual.kategori, t1: 'KATA ATAS', t2: 'KATA BAWAH?',
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
    b4_title: 'FAKTA KUNCI', b4_sub: 'Ringkasan bukti',
    broll_full_shape: profilVisual.broll_full_shape,
    broll_mini_shape: profilVisual.broll_mini_shape
  };
  const defaultScenes = {
    title: ['Pembuka', 'hook cerita'],
    a: ['Fakta Utama', 'penjelasan'],
    b: ['Bukti & Fakta', 'visual pendukung'],
    cta: ['Mau bikin video begini?', 'cek link di bio'],
    c: ['Sudut Pandang', 'kesimpulan'],
    end: ['Penutup', 'refleksi']
  };

  data.tx           = Object.assign({}, defaultTx,     (data.tx     && typeof data.tx     === 'object') ? data.tx     : {});
  data.broll        = Object.assign({}, defaultBroll,  (data.broll  && typeof data.broll  === 'object') ? data.broll  : {});
  data.scenes       = Object.assign({}, defaultScenes, (data.scenes && typeof data.scenes === 'object') ? data.scenes : {});
  data.visual_theme = Object.assign({}, profilVisual,  (data.visual_theme && typeof data.visual_theme === 'object') ? data.visual_theme : {});
  data.visual_theme.palette    = Object.assign({}, profilVisual.palette,    (data.visual_theme.palette    && typeof data.visual_theme.palette    === 'object') ? data.visual_theme.palette    : {});
  data.visual_theme.cover_font = Object.assign({}, profilVisual.cover_font, (data.visual_theme.cover_font && typeof data.visual_theme.cover_font === 'object') ? data.visual_theme.cover_font : {});

  // Pastikan SVG ilustrasi sampul selalu valid
  if (typeof data.visual_theme.cover_illustration_svg !== 'string' || !data.visual_theme.cover_illustration_svg.includes('<svg')) {
    data.visual_theme.cover_illustration_svg = profilVisual.cover_illustration_svg;
  }

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

async function buatNaskahJSON(dim, ttsInfo, profilVisual) {
  const prompt = `Kamu adalah penulis skrip & sutradara video animasi edukasi V8.8.
Buatkan data lengkap dalam format JSON MURNI (tanpa teks pembuka/penutup) untuk video berikut:
- Judul: "${JUDUL}"
- Bahasa Video: ${BAHASA} (kode BCP-47: ${ttsInfo.langCode})
- Ukuran: ${UKURAN} (${dim.width}x${dim.height})
- Profil Tema Terdeteksi: ${profilVisual.kategori} (${profilVisual.theme_id})

ATURAN KETAT V8.8:
1. Semua teks di dalam video (tx, lines, scenes, desc, tags) wajib ditulis dalam bahasa ${BAHASA} yang natural seperti penutur asli.
2. Buat ${dim.aspect === '9/16' ? '8-10 kalimat SANGAT SINGKAT (maksimal 10-12 kata per kalimat agar total durasi baca di bawah 50 detik untuk YouTube Shorts)' : '11-13 kalimat pendek'} di array "lines". Format tiap elemen: ["kunci_adegan", "mood", "Kalimat dengan *kata* ditekankan.", "fx_opsional"]
   - Kunci adegan WAJIB berurutan: "title" (2 baris hook), "a" (2-3 baris fakta utama), "b" (3-4 baris bukti & visual), "cta" (2 baris ajakan di TENGAH video: misalnya "Mau bikin video kayak gini juga?" dan "Langsung aja ke *bio*."), "c" (2 baris sudut pandang/puncak), "end" (1-2 baris penutup berkesan TANPA CTA).
   - Mood: "n" (santai), "d" (dramatis), "e" (semangat), "s" (sunyi/serius).
   - FX opsional (boleh kosong ""): "b" (boom), "k" (hantaman), "c" (lonceng di baris kedua cta), "p" (pop).
3. "src": berikan 2 sumber riset nyata dan kredibel terkait topik judul.
4. "broll": isi teks visual pendukung singkat sesuai tema judul.
5. "visual_theme": wajib merancang tampilan UNIK khusus untuk judul "${JUDUL}" (jangan samakan dengan video lain):
   - "cover_style": desain background sampul pembuka yang hidup & sesuai judul.
   - "char_bg_style": desain background saat karakter berbicara agar tidak monoton & menyatu dengan cerita judul.
   - "broll_full_shape": bentuk B-roll FULL LAYAR yang berbeda-beda tiap judul (tetap full layar, bentuk bingkai/layout unik sesuai topik).
   - "broll_mini_shape": bentuk B-roll KECIL-KECIL mengambang yang berbeda-beda tiap judul (tetap kecil-kecil, bentuk lencana/kartu unik sesuai topik).
   - "cover_illustration_svg": kode SVG sederhana (<svg viewBox="0 0 200 200" ...>...</svg>) menggambar ikon/ilustrasi utama yang merepresentasikan judul "${JUDUL}" untuk ditampilkan di sampul (tanpa mengubah posisi karakter).
   - "palette": warna hex ("primary", "secondary", "bg", "accent") yang harmonis dengan tema judul.

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
  "visual_theme": {
    "theme_id": "${profilVisual.theme_id}",
    "kategori": "${profilVisual.kategori}",
    "cover_style": "${profilVisual.cover_style}",
    "char_bg_style": "${profilVisual.char_bg_style}",
    "broll_full_shape": "${profilVisual.broll_full_shape}",
    "broll_mini_shape": "${profilVisual.broll_mini_shape}",
    "cover_font": {
      "name": "${profilVisual.cover_font.name}",
      "family": "${profilVisual.cover_font.family}",
      "weight": "${profilVisual.cover_font.weight}",
      "spacing": "${profilVisual.cover_font.spacing}",
      "transform": "${profilVisual.cover_font.transform}"
    },
    "cover_illustration_svg": "<svg viewBox=\\"0 0 200 200\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"4\\"><circle cx=\\"100\\" cy=\\"100\\" r=\\"70\\"/></svg>",
    "palette": {
      "primary": "${profilVisual.palette.primary}",
      "secondary": "${profilVisual.palette.secondary}",
      "bg": "${profilVisual.palette.bg}",
      "accent": "${profilVisual.palette.accent}"
    }
  },
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
    "broll_full_shape": "${profilVisual.broll_full_shape}",
    "broll_mini_shape": "${profilVisual.broll_mini_shape}",
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
          return rapikanNaskah(hasil, dim, ttsInfo, profilVisual);
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

// ============================================================
// [UPGRADE] Terapkan ukuran proporsional, font sampul dinamis,
// ilustrasi gambar sampul sesuai judul, background karakter dinamis,
// dan variasi bentuk B-roll (full layar & kecil-kecil) ke HTML
// ============================================================
function terapkanVisualDinamisKeHTML(html, videoData) {
  const vt = videoData.visual_theme || {};
  const pal = vt.palette || { primary: '#e11d48', secondary: '#881337', bg: '#11090d', accent: '#fda4af' };
  const font = vt.cover_font || { name: 'Cinzel', family: "'Cinzel', serif", weight: '900', spacing: '0.05em', transform: 'uppercase' };
  const fontSlug = encodeURIComponent(font.name).replace(/%20/g, '+');
  const svgIlustrasi = vt.cover_illustration_svg || '';

  const injeksiVisual = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${fontSlug}:wght@400;700;800;900&display=swap" rel="stylesheet">
<style id="v88-dynamic-theme">
  :root {
    --v-primary: ${pal.primary};
    --v-secondary: ${pal.secondary};
    --v-bg: ${pal.bg};
    --v-accent: ${pal.accent};
    --cover-font: ${font.family};
    --cover-weight: ${font.weight};
    --cover-spacing: ${font.spacing};
    --cover-transform: ${font.transform};
  }

  /* 1. Kunci ukuran & rasio video agar tidak kepanjangan & subtitle tidak menimpa karakter */
  html, body {
    width: ${videoData.width}px !important;
    height: ${videoData.height}px !important;
    margin: 0 auto !important;
    overflow: hidden !important;
    background: var(--v-bg) !important;
  }

  /* Zona aman posisi karakter & subtitle bawah */
  #char, #character, .character, .char-box, [id*="char"] {
    transform-origin: center center !important;
  }
  #sub, #subtitle, .subtitle, .sub-wrap, [id*="sub"] {
    bottom: 11% !important;
    z-index: 80 !important;
  }

  /* 2. Sampul awal: font beda-beda sesuai judul + ilustrasi gambar topik (posisi karakter sampul tetap) */
  .cover-title, #cover-title, .cv-title, [class*="cover"] h1, [id*="cover"] h1, #t1, #t2, .t1, .t2 {
    font-family: var(--cover-font) !important;
    font-weight: var(--cover-weight) !important;
    letter-spacing: var(--cover-spacing) !important;
    text-transform: var(--cover-transform) !important;
    text-shadow: 0 4px 24px color-mix(in srgb, var(--v-primary) 55%, #000) !important;
  }
  #v88-cover-emblem {
    position: absolute;
    top: 8%;
    right: 7%;
    width: 115px;
    height: 115px;
    color: var(--v-accent);
    opacity: 0.28;
    pointer-events: none;
    z-index: 2;
    filter: drop-shadow(0 0 18px var(--v-primary));
    animation: v88Float 4s ease-in-out infinite;
  }
  @keyframes v88Float {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-8px) rotate(3deg); }
  }

  /* 3. Background dinamis berbeda-beda per judul (sampul & background karakter) */
  #v88-dynamic-backdrop {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    opacity: 0.42;
    background:
      radial-gradient(circle at 50% 25%, var(--v-secondary) 0%, transparent 65%),
      radial-gradient(circle at 85% 80%, color-mix(in srgb, var(--v-primary) 35%, transparent) 0%, transparent 55%);
  }

  /* 4. Variasi bentuk B-Roll FULL LAYAR & B-Roll KECIL-KECIL (tetap 2 jenis, bentuk berubah tiap judul) */
  body[data-broll-full*="perkamen"] .broll-card,
  body[data-broll-full*="koran"] .broll-card,
  body[data-broll-full*="museum"] .broll-card {
    border-radius: 6px !important;
    border: 2px solid var(--v-accent) !important;
    border-left: 10px solid var(--v-primary) !important;
    clip-path: polygon(0 0, 96% 0, 100% 5%, 100% 100%, 4% 100%, 0 95%) !important;
  }
  body[data-broll-full*="monitor"] .broll-card,
  body[data-broll-full*="terminal"] .broll-card,
  body[data-broll-full*="blueprint"] .broll-card {
    border-radius: 26px !important;
    border: 2px solid var(--v-accent) !important;
    box-shadow: 0 0 36px color-mix(in srgb, var(--v-primary) 50%, transparent), inset 0 0 24px color-mix(in srgb, var(--v-secondary) 60%, transparent) !important;
  }
  body[data-broll-full*="folder"] .broll-card,
  body[data-broll-full*="timeline"] .broll-card {
    border-radius: 14px !important;
    border-top: 16px solid var(--v-primary) !important;
    border-bottom: 4px solid var(--v-accent) !important;
    transform: rotate(-1.2deg) !important;
  }
  body[data-broll-full*="radar"] .broll-card,
  body[data-broll-full*="peta"] .broll-card {
    border-radius: 48px 10px 48px 10px !important;
    border: 2px dashed var(--v-accent) !important;
  }
  body[data-broll-full*="panel"] .broll-card,
  body[data-broll-full*="layar"] .broll-card {
    border-radius: 22px 22px 4px 4px !important;
    border-bottom: 10px solid var(--v-primary) !important;
  }

  /* Variasi bentuk B-Roll KECIL-KECIL */
  body[data-broll-mini*="lencana"] .mini-broll,
  body[data-broll-mini*="medali"] .mini-broll,
  body[data-broll-mini*="plakat"] .mini-broll {
    border-radius: 4px 18px 4px 18px !important;
    border-left: 5px solid var(--v-accent) !important;
  }
  body[data-broll-mini*="kapsul"] .mini-broll,
  body[data-broll-mini*="pil"] .mini-broll {
    border-radius: 999px !important;
    border: 2px solid var(--v-accent) !important;
  }
  body[data-broll-mini*="stempel"] .mini-broll,
  body[data-broll-mini*="tiket"] .mini-broll {
    border-radius: 8px !important;
    border: 2px dashed var(--v-primary) !important;
    transform: rotate(1.5deg) !important;
  }
  body[data-broll-mini*="kompas"] .mini-broll,
  body[data-broll-mini*="tag"] .mini-broll {
    clip-path: polygon(6% 0, 100% 0, 94% 100%, 0% 100%) !important;
    border-bottom: 4px solid var(--v-accent) !important;
  }
</style>
<script>
  window.__V88_VISUAL__ = ${JSON.stringify(vt)};
  window.addEventListener('DOMContentLoaded', () => {
    const vt = window.__V88_VISUAL__ || {};
    document.body.setAttribute('data-theme-id', vt.theme_id || '');
    document.body.setAttribute('data-cover-style', vt.cover_style || '');
    document.body.setAttribute('data-char-bg', vt.char_bg_style || '');
    document.body.setAttribute('data-broll-full', vt.broll_full_shape || '');
    document.body.setAttribute('data-broll-mini', vt.broll_mini_shape || '');

    // Tambahkan layer latar belakang dinamis sesuai tema judul
    if (!document.getElementById('v88-dynamic-backdrop')) {
      const bg = document.createElement('div');
      bg.id = 'v88-dynamic-backdrop';
      document.body.prepend(bg);
    }

    // Tambahkan ilustrasi SVG bertema judul ke area sampul tanpa mengubah posisi karakter sampul
    const coverContainer = document.querySelector('#cover, .cover, #scene-cover, .cover-wrap') || document.body;
    if (vt.cover_illustration_svg && !document.getElementById('v88-cover-emblem')) {
      const emblem = document.createElement('div');
      emblem.id = 'v88-cover-emblem';
      emblem.innerHTML = vt.cover_illustration_svg;
      coverContainer.appendChild(emblem);
    }
  });
</script>`;

  if (html.includes('</head>')) {
    return html.replace('</head>', injeksiVisual + '\n</head>');
  }
  return injeksiVisual + '\n' + html;
}

async function main() {
  console.log(`Mulai produksi: "${JUDUL}" (${UKURAN}, ${BAHASA})`);
  const dim = parseUkuran(UKURAN);
  const ttsInfo = pilihSuaraTTS(BAHASA);
  const profilVisual = bangunProfilVisual1000Plus(JUDUL);

  // [UPGRADE] Notifikasi awal ke Telegram
  await kirimPesanTelegram(`🏭 Pabrik Video mulai bekerja!\n\n📌 Judul: ${JUDUL}\n🎨 Tema (${profilVisual.theme_id}): ${profilVisual.kategori}\n🔤 Font Sampul: ${profilVisual.cover_font.name}\n📐 Ukuran: ${UKURAN} (${dim.width}x${dim.height})\n🌐 Bahasa: ${BAHASA}`);

  console.log('1/4 Meracik naskah & adegan V8.8...');
  const videoData = await buatNaskahJSON(dim, ttsInfo, profilVisual);
  console.log(`   (naskah selesai, ${detikBerjalan()} detik berjalan, ${videoData.lines.length} kalimat, tema: ${videoData.visual_theme.theme_id})`);

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
  html = terapkanVisualDinamisKeHTML(html, videoData);
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
