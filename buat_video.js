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

const tunggu = (ms) => new Promise(r => setTimeout(r, ms));
const WAKTU_MULAI = Date.now();
function detikBerjalan() {
  return ((Date.now() - WAKTU_MULAI) / 1000).toFixed(1);
}
function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/* ===== PARSER UKURAN VIDEO (SHORTS, TIKTOK, IG, FB, YOUTUBE LONG) ===== */
function parseUkuran(uk) {
  const s = uk.toLowerCase();
  if (s.includes('16:9') || s.includes('youtube long') || s.includes('youtube panjang') || s.includes('facebook') || s.includes('fb') || s.includes('landscape')) {
    return {
      width: 1280,
      height: 720,
      aspect: '16/9',
      isVertical: false
    };
  }
  if (s.includes('4:5') || s.includes('feed')) {
    return {
      width: 720,
      height: 900,
      aspect: '4/5',
      isVertical: true
    };
  }
  if (s.includes('1:1') || s.includes('square')) {
    return {
      width: 720,
      height: 720,
      aspect: '1/1',
      isVertical: false
    };
  }
  // Default 9:16 (YouTube Shorts, TikTok, Instagram Reels)
  return {
    width: 720,
    height: 1280,
    aspect: '9/16',
    isVertical: true
  };
}

function pilihSuaraTTS(bahasa) {
  const b = bahasa.toLowerCase();
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

/* ===== VALIDASI & PERAPIHAN NASKAH V26.0 ===== */
function rapikanNaskah(data, dim, ttsInfo) {
  if (!data || typeof data !== 'object') throw new Error('Naskah dari Gemini bukan objek JSON yang valid.');
  if (!Array.isArray(data.lines)) throw new Error('Naskah dari Gemini tidak punya array "lines".');

  data.lines = data.lines.filter(l => Array.isArray(l) && l.length >= 3 && typeof l[2] === 'string' && l[2].trim() !== '');
  if (data.lines.length < 4) throw new Error('Naskah dari Gemini terlalu pendek / format "lines" rusak.');

  const defaultTx = {
    kicker: 'FAKTA UNIK',
    t1: 'FAKTA',
    t2: 'MENGEJUTKAN',
    cvC: JUDUL.slice(0, 38),
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
    ? '9-11 kalimat SANGAT SINGKAT (maksimal 10-12 kata per kalimat agar total durasi baca 38-52 detik untuk video vertikal)'
    : '12-15 kalimat padat dan informatif (untuk video landscape 16:9)';

  const prompt = `Kamu adalah penulis skrip & sutradara video animasi edukasi V26.0.
Buatkan data lengkap dalam format JSON MURNI (tanpa teks pembuka/penutup) untuk video berikut:
- Judul: "${JUDUL}"
- Bahasa Video: ${BAHASA} (kode BCP-47: ${ttsInfo.langCode})
- Ukuran: ${UKURAN} (${dim.width}x${dim.height})

ATURAN KETAT V26.0:
1. Semua teks di dalam video (tx, lines, desc, tags, src) wajib ditulis dalam bahasa ${BAHASA} yang natural, hidup, dan enak didengar seperti penutur asli.
2. Buat ${jumlahKalimat} di dalam array "lines".
   Format tiap elemen: ["kunci_adegan", "mood", "Kalimat dengan *kata* ditekankan.", "fx_opsional"]
   - Kunci adegan WAJIB menggunakan urutan ini:
     * "title" (1-2 baris hook pembuka yang bikin penasaran)
     * "b1" (1-2 baris penjelasan visual B-Roll full layar pertama — sebutkan objek/kata benda konkret agar ilustrasi vector otomatis akurat)
     * "a" (1-2 baris cerita utama dari karakter)
     * "b2" (1-2 baris detail mikro B-Roll kecil — sebutkan kata kunci spesifik)
     * "b3" (1-2 baris bukti perbandingan / mekanisme B-Roll full layar kedua)
     * "cta" (1-2 baris ajakan di TENGAH video: misalnya "Mau bikin video kayak gini juga?" dan "Langsung aja cek *link di bio*.")
     * "c" (1-2 baris sudut pandang / kesimpulan karakter)
     * "b4" (1-2 baris puncak fakta B-Roll full layar ketiga)
     * "end" (1 baris penutup berkesan TANPA CTA)
   - Mood: "n" (santai), "d" (dramatis), "e" (semangat), "s" (sunyi/serius).
   - FX opsional (boleh kosong ""): "b" (boom), "k" (hantaman), "c" (lonceng di baris kedua cta), "p" (pop).
3. "tx":
   - "kicker": kategori singkat 1-2 kata (contoh: "FAKTA SEJARAH", "SAINS TUBUH", "MISTERI DUNIA").
   - "t1": 1-2 kata judul besar baris atas di sampul (maksimal 14 huruf).
   - "t2": 1-2 kata judul besar baris bawah di sampul (maksimal 14 huruf).
   - "cvC": hook singkat 4-6 kata di sampul.
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
    "cvC": "Hook singkat 4-6 kata di sampul",
    "watch": "tonton sampai habis",
    "ctaA": "Mau bikin video",
    "ctaB": "kayak gini?",
    "ctaSub": "Prompt otomatis siap pakai • Tinggal tempel & jalankan",
    "ctaBio": "LINK DI BIO",
    "src": "Sumber"
  },
  "lines": [
    ["title", "d", "Kalimat hook pertama dengan *penekanan*.", "b"],
    ["b1", "n", "Kalimat visual pertama yang menjelaskan objek utama.", "p"],
    ["a", "n", "Kalimat fakta utama dari karakter."],
    ["b2", "e", "Kalimat detail mikro yang *mengejutkan*.", "p"],
    ["b3", "d", "Kalimat perbandingan sebelum dan sesudah.", "k"],
    ["cta", "n", "Mau bikin video kayak gini juga?"],
    ["cta", "e", "Langsung aja cek *link di bio*.", "c"],
    ["c", "n", "Kalimat sudut pandang dan refleksi."],
    ["b4", "d", "Kalimat puncak bukti terpenting.", "b"],
    ["end", "s", "Kalimat penutup yang meninggalkan *kesan*."]
  ]
}`;

  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest", "gemma-3-27b-it"];
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
    await tunggu(8000);
  }
  throw new Error('Gagal menghasilkan naskah dari Gemini API setelah 5x putaran. Detail: ' + lastApiError);
}

async function main() {
  console.log(`Mulai produksi V26.0: "${JUDUL}" (${UKURAN}, ${BAHASA})`);
  const dim = parseUkuran(UKURAN);
  const ttsInfo = pilihSuaraTTS(BAHASA);

  await kirimPesanTelegram(
    `🏭 Pabrik Video V26.0 mulai bekerja!\n\n` +
    `📌 Judul: ${JUDUL}\n` +
    `📐 Ukuran: ${UKURAN} (${dim.width}x${dim.height})\n` +
    `🌐 Bahasa: ${BAHASA}`
  );

  console.log('1/4 Meracik naskah & adegan V26.0...');
  const videoData = await buatNaskahJSON(dim, ttsInfo);
  console.log(`   (naskah selesai, ${detikBerjalan()} detik berjalan, ${videoData.lines.length} kalimat)`);

  fs.writeFileSync('data.json', JSON.stringify(videoData, null, 2), 'utf8');

  console.log('2/4 Membuat suara Voice Over (VO) ElevenLabs...');
  const teksBersih = videoData.lines.map(l => l[2].replace(/\*/g, '')).join(' ');
  await generateVoiceOver(teksBersih);
  console.log(`   (VO selesai, ${detikBerjalan()} detik berjalan)`);
  await kirimPesanTelegram('✅ Naskah & suara VO selesai. Sekarang merender video HD...');

  console.log('3/4 Merakit file HTML V26.0...');
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

  try {
    const context = await browser.newContext({
      viewport: { width: dim.width, height: dim.height },
      acceptDownloads: true
    });
    const page = await context.newPage();

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

  // [FIX PENTING] Gunakan audio hasil campuran template.html (VO + SFX Transisi + Backsound)
  console.log('Mengemas MP4 final (Video HD + VO + SFX Transisi + Backsound)...');
  execSync(`ffmpeg -y -i hasil_mentah.webm -map 0:v:0 -map 0:a:0 -c:v libx264 -preset veryfast -crf 20 -r 30 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart video_jadi.mp4`, { stdio: 'inherit' });

  const ukuranFile = fs.statSync('video_jadi.mp4').size;
  let durasiTeks = '-';
  try {
    const d = parseFloat(execSync('ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 video_jadi.mp4').toString().trim());
    if (!isNaN(d)) durasiTeks = d.toFixed(1) + ' detik';
  } catch (e) { /* abaikan */ }

  const infoYoutube = `🎬 VIDEO V26.0 SELESAI DIRENDER!\n\n📌 Judul:\n${videoData.title}\n\n📝 Deskripsi:\n${videoData.desc}\n\n📚 Sumber:\n${videoData.src.map(s => '- ' + s).join('\n')}\n\n🏷️ Tags:\n${videoData.tags}`;

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
