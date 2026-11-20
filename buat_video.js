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

// ============================================================
// [POIN 1] PERBAIKAN UKURAN VIDEO & ZONA AMAN KARAKTER-SUBTITLE
// Menghilangkan rasio 1080x1920 yang kepanjangan & mencegah subtitle menimpa karakter
// ============================================================
function parseUkuran(uk) {
  const s = uk.toLowerCase();
  if (s.includes('16:9') || s.includes('youtube panjang') || s.includes('landscape')) {
    return {
      width: 1280,
      height: 720,
      aspect: '16/9',
      subSafeY: 0.865,
      charMaxH: 0.56,
      charAnchorY: 0.80,
      coverTitleSize: 74
    };
  }
  if (s.includes('4:5') || s.includes('ig feed')) {
    return {
      width: 720,
      height: 900,
      aspect: '4/5',
      subSafeY: 0.855,
      charMaxH: 0.50,
      charAnchorY: 0.79,
      coverTitleSize: 78
    };
  }
  if (s.includes('1:1') || s.includes('square')) {
    return {
      width: 720,
      height: 720,
      aspect: '1/1',
      subSafeY: 0.855,
      charMaxH: 0.48,
      charAnchorY: 0.78,
      coverTitleSize: 72
    };
  }
  // Proporsi 9:16 ideal (720x1280) agar tidak kepanjangan dan subtitle tidak menimpa karakter
  return {
    width: 720,
    height: 1280,
    aspect: '9/16',
    subSafeY: 0.855,
    charMaxH: 0.46,
    charAnchorY: 0.79,
    coverTitleSize: 84
  };
}

// ============================================================
// [POIN 2 - 7] BANK 1.000+ VARIASI TEMA VISUAL DINAMIS
// - 16 Palet Atmosfer Warna Sesuai Judul
// - 16 Font Sampul Berbeda Sesuai Nuansa Judul
// - 16 Desain Background Sampul + 16 Ilustrasi Vektor Topik (posisi karakter tetap)
// - 16 Desain Background Karakter Saat Berbicara (tidak monoton)
// - 16 Bentuk B-Roll Full Layar (mempertahankan mode full layar, bentuk beda-beda)
// - 16 Bentuk B-Roll Kecil-Kecil (mempertahankan mode kecil-kecil, bentuk beda-beda)
// ============================================================
function hitungSeedJudul(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

const BANK_PALET_VISUAL = [
  {
    id: 'PL01',
    nama: 'bara_sejarah',
    a: '#fbbf24',
    t: '#f97316',
    p: '#ef4444',
    g: '#34d399',
    b1: '#140c07',
    b2: '#29170d'
  },
  {
    id: 'PL02',
    nama: 'biometrik_cyan',
    a: '#22d3ee',
    t: '#38bdf8',
    p: '#fb7185',
    g: '#4ade80',
    b1: '#06131c',
    b2: '#0f2738'
  },
  {
    id: 'PL03',
    nama: 'noir_investigasi',
    a: '#fb7185',
    t: '#f43f5e',
    p: '#e11d48',
    g: '#a3e635',
    b1: '#11090d',
    b2: '#24121a'
  },
  {
    id: 'PL04',
    nama: 'zamrud_alam',
    a: '#34d399',
    t: '#10b981',
    p: '#fbbf24',
    g: '#6ee7b7',
    b1: '#061712',
    b2: '#0f2e24'
  },
  {
    id: 'PL05',
    nama: 'nebula_kosmik',
    a: '#c084fc',
    t: '#818cf8',
    p: '#f472b6',
    g: '#38bdf8',
    b1: '#0d091a',
    b2: '#1d1438'
  },
  {
    id: 'PL06',
    nama: 'emas_kekaisaran',
    a: '#facc15',
    t: '#eab308',
    p: '#f97316',
    g: '#84cc16',
    b1: '#171207',
    b2: '#2e240e'
  },
  {
    id: 'PL07',
    nama: 'palung_samudra',
    a: '#60a5fa',
    t: '#2dd4bf',
    p: '#f87171',
    g: '#34d399',
    b1: '#070f21',
    b2: '#102145'
  },
  {
    id: 'PL08',
    nama: 'magma_tektonik',
    a: '#fb923c',
    t: '#facc15',
    p: '#ef4444',
    g: '#4ade80',
    b1: '#190c06',
    b2: '#33180c'
  },
  {
    id: 'PL09',
    nama: 'siber_kuantum',
    a: '#4ade80',
    t: '#22d3ee',
    p: '#f43f5e',
    g: '#a3e635',
    b1: '#05140a',
    b2: '#0b2b16'
  },
  {
    id: 'PL10',
    nama: 'arsip_monokrom',
    a: '#e2e8f0',
    t: '#94a3b8',
    p: '#f59e0b',
    g: '#38bdf8',
    b1: '#0c1017',
    b2: '#1c2433'
  },
  {
    id: 'PL11',
    nama: 'psikologi_neon',
    a: '#f472b6',
    t: '#c084fc',
    p: '#fb7185',
    g: '#2dd4bf',
    b1: '#170812',
    b2: '#2e1024'
  },
  {
    id: 'PL12',
    nama: 'terakota_purba',
    a: '#fdba74',
    t: '#ea580c',
    p: '#dc2626',
    g: '#fbbf24',
    b1: '#1a0f0a',
    b2: '#331d13'
  },
  {
    id: 'PL13',
    nama: 'safir_royale',
    a: '#93c5fd',
    t: '#3b82f6',
    p: '#f43f5e',
    g: '#10b981',
    b1: '#080e1f',
    b2: '#132042'
  },
  {
    id: 'PL14',
    nama: 'amber_dokumenter',
    a: '#fcd34d',
    t: '#d97706',
    p: '#b91c1c',
    g: '#65a30d',
    b1: '#161108',
    b2: '#2b210f'
  },
  {
    id: 'PL15',
    nama: 'violet_mistis',
    a: '#d8b4fe',
    t: '#a855f7',
    p: '#ec4899',
    g: '#22d3ee',
    b1: '#12081c',
    b2: '#26113b'
  },
  {
    id: 'PL16',
    nama: 'jade_oriental',
    a: '#6ee7b7',
    t: '#059669',
    p: '#f59e0b',
    g: '#38bdf8',
    b1: '#061511',
    b2: '#0d2b23'
  }
];

const BANK_FONT_SAMPUL = [
  { id: 'FN01', name: 'Cinzel',           family: "'Cinzel', serif",             weight: '900', spacing: '0.06em', transform: 'uppercase' },
  { id: 'FN02', name: 'Orbitron',         family: "'Orbitron', sans-serif",      weight: '900', spacing: '0.08em', transform: 'uppercase' },
  { id: 'FN03', name: 'Bebas Neue',       family: "'Bebas Neue', sans-serif",    weight: '700', spacing: '0.05em', transform: 'uppercase' },
  { id: 'FN04', name: 'Playfair Display', family: "'Playfair Display', serif",   weight: '900', spacing: '0.02em', transform: 'none' },
  { id: 'FN05', name: 'Anton',            family: "'Anton', sans-serif",         weight: '400', spacing: '0.03em', transform: 'uppercase' },
  { id: 'FN06', name: 'Space Grotesk',    family: "'Space Grotesk', sans-serif", weight: '700', spacing: '0.01em', transform: 'uppercase' },
  { id: 'FN07', name: 'Oswald',           family: "'Oswald', sans-serif",        weight: '700', spacing: '0.04em', transform: 'uppercase' },
  { id: 'FN08', name: 'Righteous',        family: "'Righteous', cursive",        weight: '400', spacing: '0.03em', transform: 'uppercase' },
  { id: 'FN09', name: 'Montserrat',       family: "'Montserrat', sans-serif",    weight: '900', spacing: '0.02em', transform: 'uppercase' },
  { id: 'FN10', name: 'Merriweather',     family: "'Merriweather', serif",       weight: '900', spacing: '0.01em', transform: 'none' },
  { id: 'FN11', name: 'Syne',             family: "'Syne', sans-serif",          weight: '800', spacing: '0.02em', transform: 'uppercase' },
  { id: 'FN12', name: 'Chakra Petch',     family: "'Chakra Petch', sans-serif",  weight: '700', spacing: '0.05em', transform: 'uppercase' },
  { id: 'FN13', name: 'Russo One',        family: "'Russo One', sans-serif",     weight: '400', spacing: '0.04em', transform: 'uppercase' },
  { id: 'FN14', name: 'Abril Fatface',    family: "'Abril Fatface', serif",      weight: '400', spacing: '0.02em', transform: 'none' },
  { id: 'FN15', name: 'Exo 2',            family: "'Exo 2', sans-serif",         weight: '900', spacing: '0.04em', transform: 'uppercase' },
  { id: 'FN16', name: 'Bungee',           family: "'Bungee', cursive",           weight: '400', spacing: '0.03em', transform: 'uppercase' }
];

const BANK_DESAIN_SAMPUL = [
  { id: 'CV01', kode: 'perkamen_peta_kuno',      pola: 'kontur',    glowPos: 'top-center',    vignette: 0.55 },
  { id: 'CV02', kode: 'radar_biometrik',         pola: 'astrolabe', glowPos: 'center',        vignette: 0.48 },
  { id: 'CV03', kode: 'berkas_rahasia_noir',     pola: 'diagonal',  glowPos: 'top-left',      vignette: 0.65 },
  { id: 'CV04', kode: 'nebula_bintang',          pola: 'astrolabe', glowPos: 'top-right',     vignette: 0.50 },
  { id: 'CV05', kode: 'gelombang_akustik',       pola: 'gelombang', glowPos: 'center',        vignette: 0.45 },
  { id: 'CV06', kode: 'arsitektur_kolom',        pola: 'pilar',     glowPos: 'top-center',    vignette: 0.58 },
  { id: 'CV07', kode: 'sirkuit_hologram',        pola: 'heksagon',  glowPos: 'center',        vignette: 0.46 },
  { id: 'CV08', kode: 'topografi_gunung',        pola: 'kontur',    glowPos: 'bottom-center', vignette: 0.52 },
  { id: 'CV09', kode: 'koran_investigasi',       pola: 'pilar',     glowPos: 'top-left',      vignette: 0.60 },
  { id: 'CV10', kode: 'prisma_geometris',        pola: 'heksagon',  glowPos: 'top-right',     vignette: 0.44 },
  { id: 'CV11', kode: 'laboratorium_dna',        pola: 'gelombang', glowPos: 'center',        vignette: 0.47 },
  { id: 'CV12', kode: 'cakrawala_kota',          pola: 'pilar',     glowPos: 'bottom-center', vignette: 0.54 },
  { id: 'CV13', kode: 'astrolabe_emas',          pola: 'astrolabe', glowPos: 'top-center',    vignette: 0.51 },
  { id: 'CV14', kode: 'sorot_panggung_dramatis', pola: 'diagonal',  glowPos: 'top-center',    vignette: 0.62 },
  { id: 'CV15', kode: 'kisi_kuantum',            pola: 'heksagon',  glowPos: 'center',        vignette: 0.49 },
  { id: 'CV16', kode: 'ilustrasi_ensiklopedia',  pola: 'kontur',    glowPos: 'top-center',    vignette: 0.53 }
];

const BANK_LATAR_KARAKTER = [
  { id: 'CB01', kode: 'peta_bara_bergerak',      motif: 'kontur',    kecepatan: 48, intensitasGaris: 0.24 },
  { id: 'CB02', kode: 'gelombang_saraf_aktif',   motif: 'gelombang', kecepatan: 74, intensitasGaris: 0.26 },
  { id: 'CB03', kode: 'sorot_lampu_kabut',       motif: 'diagonal',  kecepatan: 56, intensitasGaris: 0.20 },
  { id: 'CB04', kode: 'kontur_elevasi',          motif: 'kontur',    kecepatan: 42, intensitasGaris: 0.25 },
  { id: 'CB05', kode: 'partikel_emas_melayang',  motif: 'astrolabe', kecepatan: 50, intensitasGaris: 0.22 },
  { id: 'CB06', kode: 'grid_perspektif_3d',      motif: 'diagonal',  kecepatan: 68, intensitasGaris: 0.24 },
  { id: 'CB07', kode: 'lingkaran_astrolabe',     motif: 'astrolabe', kecepatan: 45, intensitasGaris: 0.28 },
  { id: 'CB08', kode: 'garis_detak_jantung',     motif: 'gelombang', kecepatan: 82, intensitasGaris: 0.27 },
  { id: 'CB09', kode: 'hujan_data_halus',        motif: 'pilar',     kecepatan: 78, intensitasGaris: 0.21 },
  { id: 'CB10', kode: 'cahaya_katedral',         motif: 'pilar',     kecepatan: 38, intensitasGaris: 0.23 },
  { id: 'CB11', kode: 'orbit_planet_tipis',      motif: 'astrolabe', kecepatan: 40, intensitasGaris: 0.25 },
  { id: 'CB12', kode: 'arsiran_sketsa_kuno',     motif: 'diagonal',  kecepatan: 46, intensitasGaris: 0.22 },
  { id: 'CB13', kode: 'gelombang_sonar_laut',    motif: 'gelombang', kecepatan: 62, intensitasGaris: 0.25 },
  { id: 'CB14', kode: 'kisi_laser_merah',        motif: 'heksagon',  kecepatan: 72, intensitasGaris: 0.24 },
  { id: 'CB15', kode: 'aurora_lembut',           motif: 'gelombang', kecepatan: 52, intensitasGaris: 0.21 },
  { id: 'CB16', kode: 'siluet_jam_pasir',        motif: 'heksagon',  kecepatan: 44, intensitasGaris: 0.23 }
];

const BANK_BENTUK_BROLL_FULL = [
  { id: 'BF01', kode: 'chamfered_sci_fi',        sudut: 'bevel-26',    borderStyle: 'double-tech' },
  { id: 'BF02', kode: 'kubah_arch_klasik',       sudut: 'arch-top',    borderStyle: 'royal-gold' },
  { id: 'BF03', kode: 'diagonal_slash_aksi',     sudut: 'slash-32',    borderStyle: 'dynamic-cut' },
  { id: 'BF04', kode: 'tiket_arsip_sobek',       sudut: 'ticket-notch',borderStyle: 'dashed-stamp' },
  { id: 'BF05', kode: 'daun_editorial_modern',   sudut: 'leaf-68',     borderStyle: 'clean-modern' },
  { id: 'BF06', kode: 'perisai_epik_bawah',      sudut: 'shield-34',   borderStyle: 'crest-frame' },
  { id: 'BF07', kode: 'folder_investigasi_tab',  sudut: 'folder-tab',  borderStyle: 'dossier-file' },
  { id: 'BF08', kode: 'kapsul_medis_hud',        sudut: 'capsule-54',  borderStyle: 'bio-monitor' },
  { id: 'BF09', kode: 'koran_headline_antik',    sudut: 'bevel-18',    borderStyle: 'press-column' },
  { id: 'BF10', kode: 'monitor_radar_bulat',     sudut: 'capsule-48',  borderStyle: 'sonar-ring' },
  { id: 'BF11', kode: 'peta_taktis_bergaris',    sudut: 'chamfer-22',  borderStyle: 'grid-crosshair' },
  { id: 'BF12', kode: 'kartu_museum_bingkai',    sudut: 'arch-soft',   borderStyle: 'plaque-border' },
  { id: 'BF13', kode: 'timeline_vertikal_emas',  sudut: 'shield-28',   borderStyle: 'chronicle-line' },
  { id: 'BF14', kode: 'layar_bioskop_vignette',  sudut: 'leaf-44',     borderStyle: 'cinema-frame' },
  { id: 'BF15', kode: 'lembar_blueprint_teknik', sudut: 'folder-tab',  borderStyle: 'cad-blueprint' },
  { id: 'BF16', kode: 'prisma_kaca_ganda',       sudut: 'slash-24',    borderStyle: 'prism-glow' }
];

const BANK_BENTUK_BROLL_MINI = [
  { id: 'BM01', kode: 'lencana_perisai_mini',    sudut: 'shield-20',   posisiY: 0.24 },
  { id: 'BM02', kode: 'kapsul_biometrik_mini',   sudut: 'capsule-44',  posisiY: 0.235 },
  { id: 'BM03', kode: 'stempel_rahasia_miring',  sudut: 'slash-22',    posisiY: 0.245 },
  { id: 'BM04', kode: 'kompas_koordinat_mini',   sudut: 'bevel-20',    posisiY: 0.24 },
  { id: 'BM05', kode: 'etiket_arsip_kertas',     sudut: 'ticket-notch',posisiY: 0.235 },
  { id: 'BM06', kode: 'pil_neon_sudut',          sudut: 'leaf-46',     posisiY: 0.24 },
  { id: 'BM07', kode: 'medali_segi_delapan',     sudut: 'bevel-24',    posisiY: 0.245 },
  { id: 'BM08', kode: 'label_mikroskop_mini',    sudut: 'folder-tab',  posisiY: 0.24 },
  { id: 'BM09', kode: 'gelembung_chat_tajam',    sudut: 'leaf-36',     posisiY: 0.235 },
  { id: 'BM10', kode: 'kartu_tiket_berlubang',   sudut: 'ticket-notch',posisiY: 0.24 },
  { id: 'BM11', kode: 'tag_hologram_sudut',      sudut: 'bevel-18',    posisiY: 0.245 },
  { id: 'BM12', kode: 'plakat_perunggu_mini',    sudut: 'arch-top',    posisiY: 0.24 },
  { id: 'BM13', kode: 'pita_penghargaan',        sudut: 'shield-18',   posisiY: 0.235 },
  { id: 'BM14', kode: 'kotak_radar_kecil',       sudut: 'capsule-38',  posisiY: 0.24 },
  { id: 'BM15', kode: 'kartu_kliping_koran',     sudut: 'folder-tab',  posisiY: 0.245 },
  { id: 'BM16', kode: 'lencana_mahkota_mini',    sudut: 'arch-top',    posisiY: 0.24 }
];

const BANK_ILUSTRASI_SAMPUL_SVG = {
  shield: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><path d="M100 22L164 50v54c0 44-27 70-64 82-37-12-64-38-64-82V50L100 22z"/><path d="M72 132L128 76M128 132L72 76"/></svg>`,
  pulse: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><circle cx="100" cy="100" r="78" stroke-dasharray="10 8"/><path d="M22 104h36l16-38 24 72 20-52 14 18h46"/></svg>`,
  magnifier: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><circle cx="88" cy="88" r="52"/><path d="M126 126l46 46" stroke-width="8" stroke-linecap="round"/><path d="M74 82c0-10 8-18 18-18s16 7 16 16c0 9-12 12-12 22"/><circle cx="96" cy="114" r="3" fill="currentColor"/></svg>`,
  orbit: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><circle cx="100" cy="100" r="44"/><ellipse cx="100" cy="100" rx="86" ry="25" transform="rotate(-22 100 100)"/><circle cx="154" cy="62" r="7" fill="currentColor"/></svg>`,
  chart: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><path d="M32 150h136M48 150V96h24v54M88 150V72h24v78M128 150V44h24v106"/><path d="M44 76l44-28 28 14 40-32"/></svg>`,
  chip: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><rect x="54" y="54" width="92" height="92" rx="12"/><rect x="78" y="78" width="44" height="44" rx="6"/><path d="M76 32v22M100 32v22M124 32v22M76 146v22M100 146v22M124 146v22M32 76h22M32 100h22M32 124h22M146 76h22M146 100h22M146 124h22"/></svg>`,
  clock: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><circle cx="100" cy="100" r="72"/><path d="M100 48v52l36 22"/><circle cx="100" cy="100" r="8" fill="currentColor"/></svg>`,
  crown: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><path d="M34 144h132l10-74-42 30-34-48-34 48-42-30 10 74z"/><path d="M34 158h132"/></svg>`,
  eye: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><path d="M20 100c24-38 56-56 80-56s56 18 80 56c-24 38-56 56-80 56s-56-18-80-56z"/><circle cx="100" cy="100" r="24"/><circle cx="100" cy="100" r="8" fill="currentColor"/></svg>`,
  flame: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><path d="M104 26c14 28 42 48 42 84 0 32-22 58-46 58s-46-24-46-54c0-20 12-38 24-48-2 16 8 24 16 24-4-22 2-46 10-64z"/></svg>`,
  wave: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><path d="M24 84c24-22 48-22 72 0s48 22 80 0M24 116c24-22 48-22 72 0s48 22 80 0M24 148c24-22 48-22 72 0s48 22 80 0"/></svg>`,
  bulb: `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="4"><path d="M74 134c-14-12-22-28-22-46 0-28 22-50 48-50s48 22 48 50c0 18-8 34-22 46H74z"/><path d="M80 148h40M86 162h28"/></svg>`
};

function buatProfilVisualJudul(judul, dim) {
  const j = judul.toLowerCase();
  const seed = hitungSeedJudul(judul);

  let kategori = 'FAKTA & WAWASAN';
  let ikonTema = 'bulb';
  let bias = 0;

  if (/perang|sejarah|kerajaan|kaisar|tentara|kuno|abad|penjajah|revolusi|inca|spanyol|romawi|mesir|sultan|nusantara/.test(j)) {
    kategori = 'SEJARAH & PERADABAN';
    ikonTema = 'shield';
    bias = 0;
  } else if (/otak|tubuh|bersin|tidur|jantung|saraf|medis|dokter|penyakit|darah|mata|psikologi|manusia|stres|mimpi/.test(j)) {
    kategori = 'SAINS & TUBUH MANUSIA';
    ikonTema = 'pulse';
    bias = 1;
  } else if (/misteri|hantu|hilang|kapal|kutukan|rahasia|aneh|gelap|pencurian|kasus|detektif|konspirasi|tragedi/.test(j)) {
    kategori = 'MISTERI & INVESTIGASI';
    ikonTema = 'magnifier';
    bias = 2;
  } else if (/luar angkasa|planet|bintang|alam semesta|bumi|laut|samudra|gunung|hewan|dinosaurus|alam|hutan/.test(j)) {
    kategori = 'ALAM & ANTARIKSA';
    ikonTema = 'orbit';
    bias = 3;
  } else if (/uang|kaya|ekonomi|bisnis|perusahaan|miliar|triliun|harga|emas|bank|saham|miliarder|sukses/.test(j)) {
    kategori = 'EKONOMI & STRATEGI';
    ikonTema = 'chart';
    bias = 5;
  } else if (/ai|teknologi|robot|kode|digital|internet|masa depan|tech|komputer|hp|aplikasi|siber/.test(j)) {
    kategori = 'TEKNOLOGI & MASA DEPAN';
    ikonTema = 'chip';
    bias = 8;
  } else if (/waktu|jam|detik|menit|kalender|prediksi|ramalan|umur/.test(j)) {
    kategori = 'WAKTU & FENOMENA';
    ikonTema = 'clock';
    bias = 13;
  }

  const palet     = BANK_PALET_VISUAL[(seed + bias) % BANK_PALET_VISUAL.length];
  const fontObj   = BANK_FONT_SAMPUL[(seed >>> 3) % BANK_FONT_SAMPUL.length];
  const coverIdx  = (seed >>> 5) % BANK_DESAIN_SAMPUL.length;
  const charIdx   = (seed >>> 7) % BANK_LATAR_KARAKTER.length;
  const fullIdx   = (seed >>> 9) % BANK_BENTUK_BROLL_FULL.length;
  const miniIdx   = (seed >>> 11) % BANK_BENTUK_BROLL_MINI.length;

  return {
    theme_id: `V${(seed % 89999) + 10000}`,
    seed,
    kategori,
    ikon_tema: ikonTema,
    cover_font: fontObj.name,
    cover_font_meta: fontObj,
    cover_bg_variant: coverIdx,
    cover_design_meta: BANK_DESAIN_SAMPUL[coverIdx],
    cover_style: BANK_DESAIN_SAMPUL[coverIdx].kode,
    cover_character_anchor: 'center-bottom-fixed',
    char_bg_variant: charIdx,
    char_bg_meta: BANK_LATAR_KARAKTER[charIdx],
    char_bg_style: BANK_LATAR_KARAKTER[charIdx].kode,
    broll_modes_preserved: ['full_screen', 'mini_overlay'],
    broll_full_variant: fullIdx,
    broll_full_meta: BANK_BENTUK_BROLL_FULL[fullIdx],
    broll_full_shape: BANK_BENTUK_BROLL_FULL[fullIdx].kode,
    broll_mini_variant: miniIdx,
    broll_mini_meta: BANK_BENTUK_BROLL_MINI[miniIdx],
    broll_mini_shape: BANK_BENTUK_BROLL_MINI[miniIdx].kode,
    safe_zone: {
      sub_safe_y: dim.subSafeY,
      char_max_h: dim.charMaxH,
      char_anchor_y: dim.charAnchorY,
      cover_title_size: dim.coverTitleSize
    },
    cover_illustration_svg: BANK_ILUSTRASI_SAMPUL_SVG[ikonTema] || BANK_ILUSTRASI_SAMPUL_SVG.bulb,
    palette: palet
  };
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
    b1_left: 'FAKTOR UTAMA', b1_right: 'DAMPAK NYATA', b1_badge: 'TERVERIFIKASI',
    b2_user: '@PenontonPenasaran', b2_comment: 'Wah baru tahu!',
    b3_title: 'PERBANDINGAN DATA', b3_sub: 'Data singkat',
    b3_bars: ['AWAL', 'PROSES', 'LONJAKAN', 'PUNCAK'],
    b4_title: 'FAKTA KUNCI', b4_sub: 'Ringkasan bukti', b4_badge: profilVisual.kategori
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
  data.visual_theme.palette         = Object.assign({}, profilVisual.palette,         (data.visual_theme.palette         && typeof data.visual_theme.palette         === 'object') ? data.visual_theme.palette         : {});
  data.visual_theme.cover_font_meta = Object.assign({}, profilVisual.cover_font_meta, (data.visual_theme.cover_font_meta && typeof data.visual_theme.cover_font_meta === 'object') ? data.visual_theme.cover_font_meta : {});
  data.visual_theme.safe_zone       = Object.assign({}, profilVisual.safe_zone,       (data.visual_theme.safe_zone       && typeof data.visual_theme.safe_zone       === 'object') ? data.visual_theme.safe_zone       : {});

  if (!Array.isArray(data.broll.b3_bars) || data.broll.b3_bars.length < 4) {
    data.broll.b3_bars = defaultBroll.b3_bars;
  }

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
- Profil Tema Visual: ${profilVisual.kategori} (${profilVisual.theme_id})

ATURAN KETAT V8.8:
1. Semua teks di dalam video (tx, lines, scenes, desc, tags) wajib ditulis dalam bahasa ${BAHASA} yang natural seperti penutur asli.
2. Buat ${dim.aspect === '9/16' ? '8-10 kalimat SANGAT SINGKAT (maksimal 10-12 kata per kalimat agar total durasi baca di bawah 50 detik untuk YouTube Shorts)' : '11-13 kalimat pendek'} di array "lines". Format tiap elemen: ["kunci_adegan", "mood", "Kalimat dengan *kata* ditekankan.", "fx_opsional"]
   - Kunci adegan WAJIB berurutan: "title" (2 baris hook), "a" (2-3 baris fakta utama), "b" (3-4 baris bukti & visual), "cta" (2 baris ajakan di TENGAH video: misalnya "Mau bikin video kayak gini juga?" dan "Langsung aja ke *bio*."), "c" (2 baris sudut pandang/puncak), "end" (1-2 baris penutup berkesan TANPA CTA).
   - Mood: "n" (santai), "d" (dramatis), "e" (semangat), "s" (sunyi/serius).
   - FX opsional (boleh kosong ""): "b" (boom), "k" (hantaman), "c" (lonceng di baris kedua cta), "p" (pop).
3. "src": berikan 2 sumber riset nyata dan kredibel terkait topik judul.
4. "broll": isi teks visual pendukung singkat yang SPESIFIK sesuai tema judul "${JUDUL}" (jangan pakai label generik seperti "FAKTOR A" atau "TAHAP 1" — isi sesuai fakta nyata judul!).
5. "visual_theme":
   - "ikon_tema": pilih ikon ilustrasi sampul yang paling pas dengan judul "${JUDUL}" (pilih salah satu: "shield", "pulse", "magnifier", "orbit", "chart", "chip", "clock", "crown", "eye", "flame", "wave", "bulb").
   - "cover_font": pilih nama font judul sampul yang paling cocok dengan tema judul "${JUDUL}" (pilih salah satu: "Cinzel", "Orbitron", "Bebas Neue", "Playfair Display", "Anton", "Space Grotesk", "Oswald", "Righteous", "Montserrat", "Merriweather", "Syne", "Chakra Petch", "Russo One", "Abril Fatface", "Exo 2", "Bungee").

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
    "ikon_tema": "${profilVisual.ikon_tema}",
    "cover_font": "${profilVisual.cover_font}"
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
    "b1_title": "JUDUL B-ROLL 1",
    "b1_sub": "Subjudul singkat 1",
    "b1_left": "LABEL KIRI SPESIFIK",
    "b1_right": "LABEL KANAN SPESIFIK",
    "b1_badge": "STATUS SPESIFIK",
    "b2_user": "@PenontonPenasaran",
    "b2_comment": "Komentar singkat relevan",
    "b3_title": "PERBANDINGAN DATA",
    "b3_sub": "Subjudul data singkat",
    "b3_bars": ["LABEL 1", "LABEL 2", "LABEL 3", "LABEL 4"],
    "b4_title": "FAKTA KUNCI",
    "b4_sub": "Ringkasan bukti singkat",
    "b4_badge": "RINGKASAN"
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
// [POIN 1, 2, 3, 4] INJEKSI TEMA VISUAL, FONT SAMPUL & ZONA AMAN
// ke dalam HTML tanpa mengubah satu pun fungsi asli template.html
// ============================================================
function pasangTemaVisualKeHTML(html, videoData) {
  const vt = videoData.visual_theme || {};
  const pal = vt.palette || { a: '#fbbf24', t: '#38bdf8', p: '#f43f5e', g: '#34d399', b1: '#0d131a', b2: '#1b2836' };
  const fontName = vt.cover_font || 'Playfair Display';
  const fontSlug = encodeURIComponent(fontName).replace(/%20/g, '+');

  const injeksiHead = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${fontSlug}:wght@400;700;800;900&display=swap" rel="stylesheet">
<style id="v88-theme-style">
  :root {
    --v88-a: ${pal.a};
    --v88-t: ${pal.t};
    --v88-p: ${pal.p};
    --v88-g: ${pal.g};
    --v88-b1: ${pal.b1};
    --v88-b2: ${pal.b2};
  }
  html, body {
    background: ${pal.b1} !important;
  }
  .frame {
    aspect-ratio: ${videoData.width} / ${videoData.height} !important;
    max-width: ${videoData.width}px !important;
    max-height: ${videoData.height}px !important;
  }
</style>`;

  if (html.includes('</head>')) {
    return html.replace('</head>', injeksiHead + '\n</head>');
  }
  return injeksiHead + '\n' + html;
}

async function main() {
  console.log(`Mulai produksi: "${JUDUL}" (${UKURAN}, ${BAHASA})`);
  const dim = parseUkuran(UKURAN);
  const ttsInfo = pilihSuaraTTS(BAHASA);
  const profilVisual = buatProfilVisualJudul(JUDUL, dim);

  // [UPGRADE] Notifikasi awal ke Telegram
  await kirimPesanTelegram(`🏭 Pabrik Video mulai bekerja!\n\n📌 Judul: ${JUDUL}\n🎨 Tema (${profilVisual.theme_id}): ${profilVisual.kategori}\n🔤 Font Sampul: ${profilVisual.cover_font}\n📐 Ukuran: ${UKURAN} (${dim.width}x${dim.height})\n🌐 Bahasa: ${BAHASA}`);

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
  html = pasangTemaVisualKeHTML(html, videoData);
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
