const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const JUDUL = process.env.JUDUL || 'Fakta Unik yang Jarang Diketahui';
const BAHASA = process.env.BAHASA || 'Indonesia';
const UKURAN = process.env.UKURAN || '9:16';

// Kredensial Upload Sosial Media (Semua bersifat opsional: jika diisi otomatis upload, jika kosong otomatis dilewati)
const YT_CLIENT_ID = process.env.YT_CLIENT_ID || '';
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET || '';
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN || '';

const IG_USER_ID = process.env.IG_USER_ID || '';
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN || '';

const THREADS_USER_ID = process.env.THREADS_USER_ID || '';
const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN || '';

const FB_PAGE_ID = process.env.FB_PAGE_ID || '';
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN || '';

// Opsional: Base URL publik tempat output_final.mp4 bisa diakses server Meta (IG/Threads), misal dari GitHub Release / Cloudflare R2
const PUBLIC_VIDEO_URL = process.env.PUBLIC_VIDEO_URL || '';
// Opsional: Webhook universal (n8n / Make / Zapier / Postiz) yang menerima multipart video + metadata sekaligus
const SOCIAL_WEBHOOK_URL = process.env.SOCIAL_WEBHOOK_URL || '';

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

  const prompt = `Kamu adalah penulis skrip, sutradara visual & ilustrator vektor SVG untuk video animasi storytelling 3D V34.0.
Buatkan data lengkap dalam format JSON MURNI (tanpa teks pembuka/penutup) untuk video berikut:
- Judul: "${JUDUL}"
- Bahasa Video: ${BAHASA} (kode BCP-47: ${ttsInfo.langCode})
- Ukuran: ${UKURAN} (${dim.width}x${dim.height})

ATURAN KETAT V34.0 (OTOMATIS SINKRON NASKAH VO <-> ILUSTRASI SVG B-ROLL):
1. Gaya bahasa wajib seperti bercerita santai (*storytelling* yang enak didengar, mengalir alami, tidak kaku) dalam bahasa ${BAHASA}.
2. Buat ${jumlahKalimat} di dalam array "lines". Berikan tanda koma/titik yang jelas antar kalimat agar jeda intonasi suara terdeteksi presisi.
   Format tiap elemen: ["kunci_adegan", "mood", "Kalimat VO dengan *kata* ditekankan.", "fx_opsional", META_VISUAL]
   - Kunci adegan WAJIB menggunakan urutan ini:
     * "title" (1 baris pembuka langsung ke topik utama yang santai & bikin penasaran) -> META_VISUAL: null
     * "b1" (1-2 baris visual B-Roll full layar pertama) -> META_VISUAL wajib objek berisi ilustrasi SVG yang MENGGAMBARKAN PERSIS kalimat VO di baris "b1" ini!
     * "a" (1-2 baris cerita utama dari karakter) -> META_VISUAL: null
     * "b2" (1-2 baris visual B-Roll kotak kecil di atas karakter) -> META_VISUAL wajib objek berisi ilustrasi SVG yang MENGGAMBARKAN PERSIS kalimat VO di baris "b2" ini (dan berbeda dari b1)!
     * "b3" (1-2 baris visual B-Roll full layar kedua) -> META_VISUAL wajib objek berisi ilustrasi SVG yang MENGGAMBARKAN PERSIS kalimat VO di baris "b3" ini (dan berbeda dari b1 & b2)!
     * "cta" (2 baris ajakan di TENGAH video: baris 1 "Mau bikin video kayak gini juga?" dan baris 2 "Langsung aja cek *link di bio*.") -> META_VISUAL: null
     * "c" (1-2 baris sudut pandang / refleksi karakter) -> META_VISUAL: null
     * "b4" (1-2 baris visual B-Roll full layar ketiga) -> META_VISUAL wajib objek berisi ilustrasi SVG yang MENGGAMBARKAN PERSIS kalimat VO di baris "b4" ini (dan berbeda dari b1, b2, & b3)!
     * "end" (1 baris penutup berkesan TANPA CTA) -> META_VISUAL: null
   - Format META_VISUAL pada "b1", "b2", "b3", "b4":
     {
       "kicker": "KATEGORI 1-2 KATA",
       "title": "JUDUL 2 KATA SESUAI VO",
       "sub": "Keterangan singkat 3-5 kata sesuai VO",
       "svg": "<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>",
       "svg2": "<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>"
     }
   - ATURAN WAJIB UNTUK FIELD "svg" & "svg2" (DAN "coverSvg1", "coverSvg2"):
     * Wajib valid SVG 100% self-contained dengan viewBox='0 0 200 200', tanpa tag <image>, tanpa link eksternal, tanpa teks panjang (maksimal 1-3 karakter angka/simbol jika perlu seperti '1/5' atau '30').
     * Gambar objek nyata yang sedang dibicarakan kalimat VO secara harfiah (misalnya jika VO bicara kalender 1 tahun jadi 1 bulan -> gambar kalender dengan lembaran robek & jarum jam; jika VO bicara otak merekam memori -> gambar otak warna-warni dengan kilau cahaya & lensa; jika VO bicara anak 5 tahun seperlima hidup -> gambar pie chart 5 potongan dengan 1 potongan menyala kuning + siluet anak).
     * Gunakan warna cerah kontras (#f59e0b, #0284c7, #10b981, #ef4444, #8b5cf6, #facc15, #ffffff) dengan garis tepi gelap tegas (stroke='#0f172a' stroke-width='4' stroke-linecap='round' stroke-linejoin='round') dan efek bayangan/highlight agar terlihat seperti ilustrasi vektor 3D modern yang bersih!
     * "svg2" (khususnya dipakai di b2 kotak kecil sebagai pasangan kanan) harus menggambarkan elemen pendukung kedua dari kalimat VO b2 tersebut.
3. "tx":
   - "kicker": kategori singkat 1-2 kata (contoh: "SAINS TUBUH", "FAKTA UNIK", "PSIKOLOGI", "SEJARAH").
   - "t1": 1-2 kata judul besar baris atas di sampul (maksimal 14 huruf).
   - "t2": 1-2 kata judul besar baris bawah di sampul (maksimal 14 huruf).
4. "coverSvg1" & "coverSvg2": 2 ilustrasi SVG viewBox='0 0 200 200' yang menggambarkan topik utama JUDUL untuk 2 stiker di sampul awal.
5. "src": berikan 2 sumber riset nyata dan kredibel terkait topik judul.

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
    ["title", "d", "Kalimat pembuka pertama dengan *penekanan*.", "", null],
    ["b1", "n", "Kalimat visual pertama sesuai naskah.", "p", {"kicker":"FAKTA UTAMA","title":"JUDUL B1","sub":"Keterangan B1","svg":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>","svg2":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>"}],
    ["a", "n", "Kalimat fakta utama dari karakter.", "", null],
    ["b2", "e", "Kalimat detail mikro sesuai naskah.", "p", {"kicker":"DETAIL MIKRO","title":"JUDUL B2","sub":"Keterangan B2","svg":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>","svg2":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>"}],
    ["b3", "d", "Kalimat mekanisme sesuai naskah.", "", {"kicker":"MEKANISME","title":"JUDUL B3","sub":"Keterangan B3","svg":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>","svg2":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>"}],
    ["cta", "n", "Mau bikin video kayak gini juga?", "", null],
    ["cta", "e", "Langsung aja cek *link di bio*.", "c", null],
    ["c", "n", "Kalimat sudut pandang dan refleksi.", "", null],
    ["b4", "d", "Kalimat puncak bukti sesuai naskah.", "", {"kicker":"BUKTI NYATA","title":"JUDUL B4","sub":"Keterangan B4","svg":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>","svg2":"<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>...</svg>"}],
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
          signal: AbortSignal.timeout(55000),
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

/* ===== EKSTRAKSI WAKTU PER BARIS & PER KATA DARI ELEVENLABS ===== */
function parseElevenLabsAlignment(fullText, lineRanges, alignment) {
  if (!alignment || !Array.isArray(alignment.characters) || !Array.isArray(alignment.character_start_times_seconds)) {
    return null;
  }
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
      if (wPos === -1 || wPos > endCharIdx + 2) {
        wPos = Math.min(endCharIdx, wCursor);
      }
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
    if (i < lines.length - 1) {
      fullText += '\n';
    }
  }

  const modelsToTry = ['eleven_multilingual_v2', 'eleven_flash_v2_5'];
  for (const modelId of modelsToTry) {
    try {
      console.log(`Mencoba ElevenLabs TTS (${modelId}) + exact word timestamps...`);
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/with-timestamps?output_format=mp3_44100_128`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({
          text: fullText,
          model_id: modelId,
          voice_settings: {
            stability: 0.48,
            similarity_boost: 0.78,
            style: 0.35,
            use_speaker_boost: true
          }
        })
      });

      if (!res.ok) {
        const errTxt = await res.text();
        console.log(`ElevenLabs (${modelId}) gagal HTTP ${res.status}: ${errTxt}`);
        continue;
      }

      const json = await res.json();
      if (!json.audio_base64) {
        console.log(`ElevenLabs (${modelId}) tidak mengembalikan audio_base64.`);
        continue;
      }

      const audioBuffer = Buffer.from(json.audio_base64, 'base64');
      fs.writeFileSync(outPath, audioBuffer);
      const alignment = json.normalized_alignment || json.alignment;
      const lineTimings = parseElevenLabsAlignment(fullText, lineRanges, alignment);
      console.log(`Sukses ElevenLabs TTS (${modelId})! Exact timings: ${lineTimings ? lineTimings.length + ' baris' : 'fallback RMS'}`);
      return lineTimings;
    } catch (err) {
      console.log(`ElevenLabs (${modelId}) error: ${err.message}`);
    }
  }
  return null;
}

async function buatAudioTTS(lines, outPath, ttsInfo) {
  const elTimings = await buatAudioElevenLabs(lines, outPath);
  if (elTimings && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
    return elTimings;
  }

  console.log('Beralih ke TTS gratis (Edge-TTS / gTTS)...');
  const teksBersih = lines.map(l => l[2].replace(/\*/g, '').trim()).join(' ... ');
  fs.writeFileSync('naskah_vo.txt', teksBersih, 'utf8');
  try {
    execSync(`edge-tts --voice "${ttsInfo.edgeVoice}" --rate="+4%" --file naskah_vo.txt --write-media "${outPath}"`, { stdio: 'inherit' });
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) return null;
  } catch (e) {
    console.log('Edge-TTS gagal, beralih ke Google TTS...');
  }
  const pyCmd = `python3 -c "from gtts import gTTS; text=open('naskah_vo.txt').read(); gTTS(text=text, lang='${ttsInfo.gttsLang}').save('${outPath}')"`;
  execSync(pyCmd, { stdio: 'inherit' });
  return null;
}

/* ===== MIXING AUDIO SERVER: BGM + SFX + VO ===== */
function mixAudioWithBgmAndSfx(voPath, sceneTimes, totalLenSec, seedNum, outWavPath) {
  const freqs = [261.63, 329.63, 392.00, 493.88, 392.00, 329.63];
  const shift = 1 + ((seedNum % 5) - 2) * 0.03;
  const f1 = (freqs[seedNum % freqs.length] * shift).toFixed(2);
  const f2 = (freqs[(seedNum + 2) % freqs.length] * shift).toFixed(2);
  const f3 = (freqs[(seedNum + 4) % freqs.length] * 0.5 * shift).toFixed(2);

  const bgmTemp = 'bgm_temp.wav';
  const sfxTemp = 'sfx_temp.wav';

  execSync(
    `ffmpeg -y -f lavfi -i "sine=frequency=${f1}:duration=${totalLenSec}" ` +
    `-f lavfi -i "sine=frequency=${f2}:duration=${totalLenSec}" ` +
    `-f lavfi -i "sine=frequency=${f3}:duration=${totalLenSec}" ` +
    `-filter_complex "[0:a]volume=0.025[a0];[1:a]volume=0.020[a1];[2:a]volume=0.028[a2];[a0][a1][a2]amix=inputs=3:normalize=0,lowpass=f=650,tremolo=f=0.45:d=0.35[out]" ` +
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
    triggers.slice(0, 14).forEach((tr, idx) => {
      const delayMs = Math.max(0, Math.round(tr.t * 1000));
      if (tr.type === 'c') {
        inputs.push(`-f lavfi -i "sine=frequency=1046.5:duration=0.22"`);
        filters.push(`[${idx + 1}:a]afade=t=in:ss=0:d=0.02,afade=t=out:st=0.06:d=0.16,volume=0.18,adelay=${delayMs}|${delayMs}[s${idx}]`);
      } else {
        inputs.push(`-f lavfi -i "anoisesrc=color=pink:duration=0.24:amplitude=0.28"`);
        filters.push(`[${idx + 1}:a]bandpass=f=950:width_type=h:w=700,afade=t=in:ss=0:d=0.07,afade=t=out:st=0.10:d=0.14,volume=0.55,adelay=${delayMs}|${delayMs}[s${idx}]`);
      }
    });
    const mixLabels = ['[0:a]', ...triggers.slice(0, 14).map((_, i) => `[s${i}]`)].join('');
    filters.push(`${mixLabels}amix=inputs=${Math.min(14, triggers.length) + 1}:normalize=0[sfxout]`);

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
    `-filter_complex "[0:a]adelay=${voDelayMs}|${voDelayMs},apad=whole_dur=${totalLenSec},volume=1.35[vo];[1:a]volume=0.85[bgm];[2:a]volume=1.0[sfx];[vo][bgm][sfx]amix=inputs=3:normalize=0,alimiter=limit=0.95[final]" ` +
    `-map "[final]" -t ${totalLenSec} -ar 44100 -ac 2 "${outWavPath}"`,
    { stdio: 'pipe' }
  );
}

function mulaiServerLokal(dir) {
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.mp3': 'audio/mpeg', '.json': 'application/json' };
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

/* ===== UPLOAD KE TELEGRAM ===== */
async function kirimKeTelegram(videoPath, data) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Lewati Telegram (Secret belum lengkap).');
    return;
  }
  console.log('Mengirim video ke Telegram...');
  const caption = `🎬 *${data.title}*\n\n${data.desc}\n\n${data.tags}\n\n_(Siap upload ke YT Shorts / IG Reels / Threads / FB Reels!)_`;
  const form = new FormData();
  form.append('chat_id', TELEGRAM_CHAT_ID);
  form.append('caption', caption.slice(0, 1000));
  form.append('parse_mode', 'Markdown');
  form.append('video', new Blob([fs.readFileSync(videoPath)], { type: 'video/mp4' }), 'video_cerita.mp4');

  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.ok) console.error('Gagal kirim Telegram:', json);
  else console.log('Sukses terkirim ke Telegram!');
}

/* ===== UPLOAD KE YOUTUBE SHORTS ===== */
async function uploadKeYouTube(videoPath, data) {
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
    console.log('Lewati YouTube (Secret YT belum lengkap).');
    return;
  }
  console.log('Memulai upload otomatis ke YouTube...');
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
  if (upData.id) console.log(`Sukses upload ke YouTube! Link: https://youtu.be/${upData.id}`);
  else console.error('Gagal upload YouTube:', upData);
}

/* ===== HELPER POLLING STATUS CONTAINER META GRAPH API (IG & THREADS) ===== */
async function tungguContainerMeta(baseUrl, containerId, accessToken, label) {
  for (let i = 1; i <= 30; i++) {
    await tunggu(4000);
    const stRes = await fetch(`${baseUrl}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`);
    const stJson = await stRes.json();
    const code = stJson.status_code || stJson.status;
    console.log(`[${label}] Cek status container (${i}/30): ${code || JSON.stringify(stJson)}`);
    if (code === 'FINISHED' || code === 'PUBLISHED') return true;
    if (code === 'ERROR' || code === 'EXPIRED') {
      console.error(`[${label}] Container gagal diproses:`, stJson);
      return false;
    }
  }
  console.error(`[${label}] Timeout menunggu container selesai diproses.`);
  return false;
}

/* ===== UPLOAD KE INSTAGRAM REELS (META GRAPH API) ===== */
async function uploadKeInstagram(videoPath, data) {
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
    console.log('Lewati Instagram (Secret IG_USER_ID / IG_ACCESS_TOKEN belum diisi).');
    return;
  }
  if (!PUBLIC_VIDEO_URL) {
    console.log('Lewati Instagram (PUBLIC_VIDEO_URL belum diisi — Meta Graph API membutuhkan URL video publik untuk IG Reels).');
    return;
  }
  console.log('Memulai upload otomatis ke Instagram Reels...');
  try {
    const caption = `${data.title}\n\n${data.desc}\n\n${data.tags}`.slice(0, 2200);
    const createRes = await fetch(`https://graph.facebook.com/v21.0/${IG_USER_ID}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'REELS',
        video_url: PUBLIC_VIDEO_URL,
        caption,
        share_to_feed: true,
        access_token: IG_ACCESS_TOKEN
      })
    });
    const createJson = await createRes.json();
    if (!createJson.id) {
      console.error('Gagal membuat media container Instagram:', createJson);
      return;
    }

    const siap = await tungguContainerMeta('https://graph.facebook.com/v21.0', createJson.id, IG_ACCESS_TOKEN, 'Instagram');
    if (!siap) return;

    const pubRes = await fetch(`https://graph.facebook.com/v21.0/${IG_USER_ID}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: createJson.id,
        access_token: IG_ACCESS_TOKEN
      })
    });
    const pubJson = await pubRes.json();
    if (pubJson.id) console.log(`Sukses upload ke Instagram Reels! Media ID: ${pubJson.id}`);
    else console.error('Gagal publish Instagram Reels:', pubJson);
  } catch (err) {
    console.error('Error upload Instagram:', err.message);
  }
}

/* ===== UPLOAD KE THREADS (THREADS GRAPH API) ===== */
async function uploadKeThreads(videoPath, data) {
  if (!THREADS_USER_ID || !THREADS_ACCESS_TOKEN) {
    console.log('Lewati Threads (Secret THREADS_USER_ID / THREADS_ACCESS_TOKEN belum diisi).');
    return;
  }
  if (!PUBLIC_VIDEO_URL) {
    console.log('Lewati Threads (PUBLIC_VIDEO_URL belum diisi — Threads API membutuhkan URL video publik).');
    return;
  }
  console.log('Memulai upload otomatis ke Threads...');
  try {
    const text = `${data.title}\n\n${data.desc}\n\n${data.tags}`.slice(0, 500);
    const createRes = await fetch(`https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'VIDEO',
        video_url: PUBLIC_VIDEO_URL,
        text,
        access_token: THREADS_ACCESS_TOKEN
      })
    });
    const createJson = await createRes.json();
    if (!createJson.id) {
      console.error('Gagal membuat container Threads:', createJson);
      return;
    }

    const siap = await tungguContainerMeta('https://graph.threads.net/v1.0', createJson.id, THREADS_ACCESS_TOKEN, 'Threads');
    if (!siap) return;

    const pubRes = await fetch(`https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: createJson.id,
        access_token: THREADS_ACCESS_TOKEN
      })
    });
    const pubJson = await pubRes.json();
    if (pubJson.id) console.log(`Sukses upload ke Threads! Post ID: ${pubJson.id}`);
    else console.error('Gagal publish Threads:', pubJson);
  } catch (err) {
    console.error('Error upload Threads:', err.message);
  }
}

/* ===== UPLOAD KE FACEBOOK REELS (FACEBOOK GRAPH API - LANGSUNG UPLOAD FILE BINER SEPERTI YT) ===== */
async function uploadKeFacebook(videoPath, data) {
  if (!FB_PAGE_ID || !FB_PAGE_ACCESS_TOKEN) {
    console.log('Lewati Facebook Reels (Secret FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN belum diisi).');
    return;
  }
  console.log('Memulai upload otomatis ke Facebook Reels...');
  try {
    const description = `${data.title}\n\n${data.desc}\n\n${data.tags}`.slice(0, 2200);
    const fileSize = fs.statSync(videoPath).size;

    // Tahap 1: Inisialisasi sesi upload Reels
    const startRes = await fetch(`https://graph.facebook.com/v21.0/${FB_PAGE_ID}/video_reels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upload_phase: 'start',
        access_token: FB_PAGE_ACCESS_TOKEN
      })
    });
    const startJson = await startRes.json();
    if (!startJson.video_id || !startJson.upload_url) {
      console.error('Gagal inisialisasi sesi Facebook Reels:', startJson);
      return;
    }

    // Tahap 2: Upload biner file MP4 langsung ke rupload.facebook.com
    const upRes = await fetch(startJson.upload_url, {
      method: 'POST',
      headers: {
        'Authorization': `OAuth ${FB_PAGE_ACCESS_TOKEN}`,
        'offset': '0',
        'file_size': String(fileSize),
        'Content-Type': 'application/octet-stream'
      },
      body: fs.readFileSync(videoPath)
    });
    const upJson = await upRes.json();
    if (!upJson.success) {
      console.error('Gagal mengunggah biner video ke Facebook:', upJson);
      return;
    }

    // Tahap 3: Publish Facebook Reels
    const finRes = await fetch(`https://graph.facebook.com/v21.0/${FB_PAGE_ID}/video_reels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upload_phase: 'finish',
        video_id: startJson.video_id,
        video_state: 'PUBLISHED',
        description,
        access_token: FB_PAGE_ACCESS_TOKEN
      })
    });
    const finJson = await finRes.json();
    if (finJson.success || finJson.post_id) {
      console.log(`Sukses upload ke Facebook Reels! Video ID: ${startJson.video_id}`);
    } else {
      console.error('Gagal publish Facebook Reels:', finJson);
    }
  } catch (err) {
    console.error('Error upload Facebook:', err.message);
  }
}

/* ===== JALUR WEBHOOK UNIVERSAL (JIKA PAKAI MAKE / N8N / ZAPIER / POSTIZ UNTUK IG+THREADS+FB SEKALIGUS) ===== */
async function uploadViaWebhook(videoPath, data) {
  if (!SOCIAL_WEBHOOK_URL) return;
  console.log('Mengirim video & metadata ke SOCIAL_WEBHOOK_URL...');
  try {
    const form = new FormData();
    form.append('title', data.title);
    form.append('description', data.desc);
    form.append('tags', data.tags);
    form.append('caption', `${data.title}\n\n${data.desc}\n\n${data.tags}`);
    form.append('platforms', 'instagram,threads,facebook');
    form.append('video', new Blob([fs.readFileSync(videoPath)], { type: 'video/mp4' }), 'video_cerita.mp4');

    const res = await fetch(SOCIAL_WEBHOOK_URL, { method: 'POST', body: form });
    const txt = await res.text();
    console.log(`Respon SOCIAL_WEBHOOK_URL (HTTP ${res.status}):`, txt.slice(0, 300));
  } catch (err) {
    console.error('Error SOCIAL_WEBHOOK_URL:', err.message);
  }
}

/* ===== MAIN PIPELINE ===== */
(async () => {
  try {
    const dim = getDimensi(UKURAN);
    const ttsInfo = getBahasaConfig(BAHASA);
    console.log(`=== MEMULAI PRODUKSI VIDEO V34.0 (${UKURAN} | ${BAHASA}) ===`);
    console.log(`Judul: ${JUDUL}`);

    console.log('1. Menyusun naskah & ilustrasi B-Roll SVG otomatis dari Gemini...');
    const videoData = await buatNaskahJSON(dim, ttsInfo);

    console.log('2. Membuat suara Voice Over (ElevenLabs + Exact Timestamps / Fallback Gratis)...');
    const exactTimings = await buatAudioTTS(videoData.lines, 'vo.mp3', ttsInfo);
    if (exactTimings) {
      videoData.lineTimings = exactTimings;
    }

    console.log('3. Merakit index.html dari template.html...');
    let tpl = fs.readFileSync('template.html', 'utf8');
    tpl = tpl.replace('__TITLE__', videoData.title.replace(/"/g, '&quot;'))
             .replace('__ASPECT__', dim.aspect)
             .replace('__VIDEO_DATA_JSON__', JSON.stringify(videoData));
    fs.writeFileSync('index.html', tpl, 'utf8');

    console.log('4. Menjalankan browser & merekam frame video HD...');
    const { server, port } = await mulaiServerLokal(process.cwd());
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage({ viewport: { width: dim.width, height: dim.height } });
    await page.goto(`http://127.0.0.1:${port}/index.html?autorender=1`, { waitUntil: 'networkidle' });

    await page.waitForFunction(() => window.__ASSETS_READY === true, { timeout: 30000 });
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
      await page.locator('#cv').screenshot({ path: framePath, type: 'jpeg', quality: 92 });
      if (f % 150 === 0) console.log(`Render progress: ${f}/${totalFrames} frame...`);
    }

    await browser.close();
    server.close();

    console.log('5. Menggabungkan BGM + SFX + VO & merender MP4 final (FFmpeg)...');
    const seedNum = Array.from(videoData.title).reduce((a, c) => a + c.charCodeAt(0), 0);
    mixAudioWithBgmAndSfx('vo.mp3', sceneTimes, totalLenSec, seedNum, 'mixed_audio.wav');

    execSync(
      `ffmpeg -y -framerate ${fps} -i frames/f_%05d.jpg -i mixed_audio.wav ` +
      `-c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest output_final.mp4`,
      { stdio: 'inherit' }
    );

    console.log('6. Mengirim hasil ke Telegram & Upload Multi-Platform (YT, IG, Threads, FB)...');
    await kirimKeTelegram('output_final.mp4', videoData);
    await uploadKeYouTube('output_final.mp4', videoData);
    await uploadKeFacebook('output_final.mp4', videoData);
    await uploadKeInstagram('output_final.mp4', videoData);
    await uploadKeThreads('output_final.mp4', videoData);
    await uploadViaWebhook('output_final.mp4', videoData);

    console.log('=== SEMUA PROSES SELESAI 100%! ===');
  } catch (err) {
    console.error('TERJADI ERROR:', err);
    process.exit(1);
  }
})();
