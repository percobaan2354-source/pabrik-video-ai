const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GEMINI_API_KEY   = (process.env.GEMINI_API_KEY || '').trim();
const TELEGRAM_TOKEN   = (process.env.TELEGRAM_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const RAW_INPUT_URL    = (process.env.INPUT_URL || '').trim();
const RAW_INPUT_FONT   = (process.env.INPUT_FONT || '').trim();
const YOUTUBE_COOKIES  = (process.env.YOUTUBE_COOKIES || '').trim();

// Konfigurasi katalog font yang terpasang di server Ubuntu
const KATALOG_FONT = {
  montserrat: { label: 'Montserrat (Viral Bold)', fontName: 'Montserrat', fontSize: 66, outline: 6, spacing: 1 },
  anton:      { label: 'Anton (Tegas Tinggi)',    fontName: 'Anton',      fontSize: 78, outline: 6, spacing: 2 },
  poppins:    { label: 'Poppins (Modern Clean)',  fontName: 'Poppins',    fontSize: 64, outline: 6, spacing: 1 },
  comic:      { label: 'Comic Neue (Santai)',     fontName: 'Comic Neue', fontSize: 68, outline: 6, spacing: 1 },
  roboto:     { label: 'Roboto (Podcast Tajam)',  fontName: 'Roboto',     fontSize: 66, outline: 6, spacing: 1 },
  dejavu:     { label: 'DejaVu Sans (Klasik)',    fontName: 'DejaVu Sans',fontSize: 64, outline: 6, spacing: 0 }
};

// Parsing input URL & Font (mendukung format "@bot /clip montserrat https://youtu.be/xxx", "https://youtu.be/xxx | anton", atau INPUT_FONT)
function parseInputUrlDanFont(rawUrl, rawFont) {
  let urlBersih = rawUrl
    .replace(/^@[a-zA-Z0-9_]+\s+/i, '')
    .replace(/^\/clip\s+/i, '')
    .trim();
  let fontTerpilih = (rawFont || '').toLowerCase();

  // Cek format "FONT https://youtu.be/xxx" (dari tombol switch_inline_query_current_chat)
  const matchDepan = urlBersih.match(/^([a-zA-Z]+)\s+(https?:\/\/.+)$/i);
  if (matchDepan && KATALOG_FONT[matchDepan[1].toLowerCase()]) {
    fontTerpilih = matchDepan[1].toLowerCase();
    urlBersih = matchDepan[2].trim();
  } else if (urlBersih.includes('|')) {
    const bagian = urlBersih.split('|').map(s => s.trim());
    urlBersih = bagian[0];
    if (bagian[1]) fontTerpilih = bagian[1].toLowerCase();
  } else {
    const matchBelakang = urlBersih.match(/\s+(?:font[:=]\s*)?([a-zA-Z]+)$/i);
    if (matchBelakang && KATALOG_FONT[matchBelakang[1].toLowerCase()]) {
      fontTerpilih = matchBelakang[1].toLowerCase();
      urlBersih = urlBersih.replace(matchBelakang[0], '').trim();
    }
  }

  // Pencocokan fleksibel (misal user ketik "montserrat bold" tetap masuk ke "montserrat")
  const kunciCocok = Object.keys(KATALOG_FONT).find(k => fontTerpilih.includes(k)) || 'montserrat';
  return {
    videoUrl: urlBersih,
    fontKey: kunciCocok,
    fontConfig: KATALOG_FONT[kunciCocok]
  };
}

const { videoUrl: VIDEO_URL, fontKey: FONT_KEY, fontConfig: FONT_CONFIG } = parseInputUrlDanFont(RAW_INPUT_URL, RAW_INPUT_FONT);

async function kirimPesan(teks, replyMarkup = null) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const payload = {
      chat_id: TELEGRAM_CHAT_ID,
      text: teks.slice(0, 4000)
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.log('Gagal kirim pesan:', e.message);
  }
}

async function kirimVideo(filePath, caption) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendVideo`;
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(filePath)], { type: 'video/mp4' });
  form.append('chat_id', TELEGRAM_CHAT_ID);
  form.append('video', blob, path.basename(filePath));
  form.append('caption', caption.slice(0, 1000));
  form.append('supports_streaming', 'true');

  const res = await fetch(url, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.ok) throw new Error('Gagal kirim video: ' + JSON.stringify(json));
}

function bersihkanSubtitleVTT(vttText) {
  const lines = vttText.split('\n');
  const hasil = [];
  let waktuAktif = '';
  let teksSebelumnya = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:')) continue;
    if (line.includes('-->')) {
      waktuAktif = line.split('-->')[0].trim().split('.')[0];
      continue;
    }
    const bersih = line.replace(/<[^>]+>/g, '').trim();
    if (bersih && bersih !== teksSebelumnya) {
      hasil.push(`[${waktuAktif}] ${bersih}`);
      teksSebelumnya = bersih;
    }
  }
  return hasil.join('\n').slice(0, 28000);
}

function waktuKeDetik(ts) {
  const bersih = ts.trim().split(' ')[0].replace(',', '.');
  const bagian = bersih.split(':');
  if (bagian.length === 3) {
    return parseInt(bagian[0], 10) * 3600 + parseInt(bagian[1], 10) * 60 + parseFloat(bagian[2]);
  }
  if (bagian.length === 2) {
    return parseInt(bagian[0], 10) * 60 + parseFloat(bagian[1]);
  }
  return parseFloat(bagian[0]) || 0;
}

function detikKeAss(totalDetik) {
  const d = Math.max(0, totalDetik);
  const jam = Math.floor(d / 3600);
  const menit = Math.floor((d % 3600) / 60);
  const detik = Math.floor(d % 60);
  const centi = Math.round((d - Math.floor(d)) * 100);
  if (centi >= 100) {
    return detikKeAss(Math.floor(d) + 1);
  }
  return `${jam}:${String(menit).padStart(2, '0')}:${String(detik).padStart(2, '0')}.${String(centi).padStart(2, '0')}`;
}

function detikKeHHMMSS(totalDetik) {
  const d = Math.max(0, Math.floor(totalDetik));
  const jam = Math.floor(d / 3600);
  const menit = Math.floor((d % 3600) / 60);
  const detik = d % 60;
  return `${String(jam).padStart(2, '0')}:${String(menit).padStart(2, '0')}:${String(detik).padStart(2, '0')}`;
}

// Upload audio ke Gemini File API (mendukung durasi video panjang hingga berjam-jam tanpa batas payload base64)
async function uploadKeGeminiFileAPI(filePath, mimeType) {
  const fileBuffer = fs.readFileSync(filePath);
  const numBytes = fileBuffer.length;

  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(numBytes),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { display_name: path.basename(filePath) } })
    }
  );

  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gagal memulai upload audio ke Gemini File API');
  }

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(numBytes),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: fileBuffer
  });

  const uploadJson = await uploadRes.json();
  if (!uploadJson.file || !uploadJson.file.uri) {
    throw new Error('Gagal mendapatkan URI file Gemini: ' + JSON.stringify(uploadJson));
  }
  return uploadJson.file.uri;
}

// Cari momen viral langsung dengan mendengarkan suara/VO video + buat hook banner & caption siap copas
async function cariMomenViralDariAudio(audioPath, durasiVideoDetik) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY kosong! Periksa GitHub Secrets.');
  }

  const fileUri = await uploadKeGeminiFileAPI(audioPath, 'audio/mp3');
  const batasAkhirStr = detikKeHHMMSS(durasiVideoDetik);

  const prompt = `Kamu adalah editor video viral TikTok/Shorts profesional.
Dengarkan rekaman suara/VO video berdurasi total ${batasAkhirStr} (${Math.floor(durasiVideoDetik)} detik) ini dari awal sampai akhir.
Pilih SATU momen pembicaraan paling menarik, emosional, lucu, berbobot, atau bikin penasaran dengan durasi antara 30 sampai 55 detik.

ATURAN KETAT:
- "start" dan "end" wajib format "HH:MM:SS" sesuai posisi waktu nyata pada audio ini (tidak boleh melebihi ${batasAkhirStr}).
- Pastikan selisih waktu end dikurangi start adalah 30 sampai 55 detik, dan dimulai tepat saat awal kalimat (bukan terpotong di tengah kata).
- "hook_banner" adalah teks pancingan singkat maksimal 6 kata HURUF KAPITAL untuk dipasang di bagian atas video pada 3.5 detik pertama.
- "caption_sosmed" adalah deskripsi singkat memancing komentar + 5 hashtag viral yang relevan untuk TikTok/Reels/Shorts.
- Keluarkan HANYA JSON murni tanpa teks tambahan:
{
  "start": "00:01:15",
  "end": "00:01:58",
  "judul": "Judul Hook Viral #Shorts",
  "hook_banner": "KENAPA GAJI GURU KALAH SAMA ARTIS?",
  "alasan": "Alasan singkat kenapa momen ini berpotensi viral",
  "caption_sosmed": "Setuju gak sama pendapat ini? Tulis di kolom komentar! 👇 #edukasi #fakta #motivasi #podcast #fyp"
}`;

  const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
  let errorTerakhir = '';

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { fileData: { mimeType: 'audio/mp3', fileUri } },
                { text: prompt }
              ]
            }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        }
      );
      const json = await res.json();
      if (json.candidates && json.candidates[0]) {
        let raw = json.candidates[0].content.parts[0].text.trim();
        const awal = raw.indexOf('{');
        const akhir = raw.lastIndexOf('}');
        if (awal !== -1 && akhir !== -1) raw = raw.slice(awal, akhir + 1);
        return JSON.parse(raw);
      } else {
        errorTerakhir = json.error ? json.error.message : JSON.stringify(json);
        console.log(`Respon API ${model}:`, errorTerakhir);
      }
    } catch (e) {
      errorTerakhir = e.message;
      console.log(`Gagal model ${model}:`, e.message);
    }
  }
  throw new Error(`Gemini gagal menganalisis audio video (${errorTerakhir})`);
}

// Deteksi rentang waktu saat suara manusia benar-benar aktif menggunakan FFmpeg silencedetect
function deteksiRentangSuaraAktif(audioPath, durasiClip) {
  try {
    const log = execSync(
      `ffmpeg -i "${audioPath}" -af "silencedetect=noise=-32dB:d=0.22" -f null - 2>&1`,
      { encoding: 'utf8' }
    );
    const silences = [];
    let curStart = null;
    for (const line of log.split('\n')) {
      const mStart = line.match(/silence_start:\s*([\d.]+)/);
      if (mStart) curStart = parseFloat(mStart[1]);
      const mEnd = line.match(/silence_end:\s*([\d.]+)/);
      if (mEnd && curStart !== null) {
        silences.push({ start: curStart, end: parseFloat(mEnd[1]) });
        curStart = null;
      }
    }
    if (curStart !== null) {
      silences.push({ start: curStart, end: durasiClip });
    }

    const speechSegments = [];
    let cursor = 0;
    for (const s of silences) {
      if (s.start > cursor + 0.05) {
        speechSegments.push({ start: cursor, end: s.start });
      }
      cursor = Math.max(cursor, s.end);
    }
    if (durasiClip > cursor + 0.05) {
      speechSegments.push({ start: cursor, end: durasiClip });
    }
    return speechSegments;
  } catch (e) {
    console.log('Silencedetect dilewati:', e.message);
    return [];
  }
}

// Transkripsikan 1 potongan pendek audio (maks 10 detik) dengan sistem RETRY 3x anti-bolong
async function transkripSatuChunkAudio(chunkPath, durasiChunk, offsetDetik) {
  const audioBase64 = fs.readFileSync(chunkPath).toString('base64');
  const prompt = `Dengarkan potongan audio pendek berdurasi ${durasiChunk.toFixed(2)} detik ini dengan sangat teliti.
Tugasmu adalah mentranskripsikan SETIAP KATA yang diucapkan manusia dari detik 0.00 sampai detik ${durasiChunk.toFixed(2)} (JANGAN melewatkan kata di awal maupun di ujung akhir audio!).

ATURAN KETAT:
- Tulis 1 objek per 1 KATA yang diucapkan ("kata", "start", "end").
- "start" adalah detik tepat ketika suku kata pertama dari kata itu mulai terdengar di bibir pembicara (bukan terlambat setelah kata selesai).
- "end" adalah detik tepat ketika kata itu selesai diucapkan.
- Sesuaikan dengan intonasi pembicara: jika cepat, durasi per kata 0.14 - 0.32 detik; jika lambat/menekan intonasi, 0.35 - 0.85 detik.
- Jangan berhenti sebelum detik ${durasiChunk.toFixed(2)} jika masih ada suara bicara sampai ujung!
- Keluarkan HANYA JSON array murni:
[
  {"kata": "contoh", "start": 0.12, "end": 0.45}
]`;

  const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const model of models) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inlineData: { mimeType: 'audio/mp3', data: audioBase64 } },
                  { text: prompt }
                ]
              }],
              generationConfig: { responseMimeType: 'application/json' }
            })
          }
        );
        const json = await res.json();
        if (json.candidates && json.candidates[0]) {
          let raw = json.candidates[0].content.parts[0].text.trim();
          const awal = raw.indexOf('[');
          const akhir = raw.lastIndexOf(']');
          if (awal !== -1 && akhir !== -1) raw = raw.slice(awal, akhir + 1);
          const parsed = JSON.parse(raw);

          if (Array.isArray(parsed) && parsed.length > 0) {
            const hasilKata = [];
            for (const x of parsed) {
              if (!x || !x.kata || typeof x.start !== 'number' || typeof x.end !== 'number') continue;
              const sLocal = Math.max(0, Math.min(durasiChunk, x.start));
              const eLocal = Math.max(sLocal + 0.06, Math.min(durasiChunk, x.end));
              const subKata = String(x.kata).trim().split(/\s+/).filter(Boolean);

              if (subKata.length === 1) {
                hasilKata.push({
                  kata: subKata[0],
                  start: offsetDetik + sLocal,
                  end: offsetDetik + eLocal
                });
              } else if (subKata.length > 1) {
                const totalHuruf = subKata.reduce((acc, w) => acc + w.length, 0) || 1;
                let kursor = sLocal;
                for (const w of subKata) {
                  const dur = (w.length / totalHuruf) * (eLocal - sLocal);
                  hasilKata.push({
                    kata: w,
                    start: offsetDetik + kursor,
                    end: offsetDetik + kursor + dur
                  });
                  kursor += dur;
                }
              }
            }
            if (hasilKata.length > 0) return hasilKata;
          }
        } else {
          console.log(`Putaran ${attempt} chunk offset ${offsetDetik}s (${model}) respon:`, JSON.stringify(json.error || json));
        }
      } catch (e) {
        console.log(`Putaran ${attempt} gagal chunk offset ${offsetDetik}s (${model}):`, e.message);
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return [];
}

// Pecah audio klip menjadi segmen 10 detik agar transkripsi hingga ujung video 100% lengkap & presisi
async function transkripKataDariAudio(audioPath, durasiClip) {
  const ukuranChunk = 10; // 10 detik per chunk agar waktu per kata makin presisi dan tidak terpotong di ujung
  const semuaKata = [];

  for (let offset = 0; offset < durasiClip - 0.1; offset += ukuranChunk) {
    const durasiSegmen = Math.min(ukuranChunk, durasiClip - offset);
    const chunkFile = `chunk_${Math.floor(offset)}.mp3`;

    execSync(
      `ffmpeg -y -ss ${offset.toFixed(3)} -t ${durasiSegmen.toFixed(3)} -i "${audioPath}" -vn -ac 1 -ar 16000 -b:a 64k "${chunkFile}"`,
      { stdio: 'inherit' }
    );

    const kataChunk = await transkripSatuChunkAudio(chunkFile, durasiSegmen, offset);
    semuaKata.push(...kataChunk);

    // Jeda ringan 1 detik antar-segmen agar tidak terkena limit API
    await new Promise(r => setTimeout(r, 1000));
  }

  // Kalibrasi dengan envelope suara asli (silencedetect) agar subtitle tidak muncul di saat hening
  const speechSegments = deteksiRentangSuaraAktif(audioPath, durasiClip);
  if (speechSegments.length > 0 && semuaKata.length > 0) {
    for (const item of semuaKata) {
      const segmenCocok = speechSegments.find(seg => seg.start > item.start && seg.start - item.start < 0.30 && seg.end > item.start + 0.08);
      if (segmenCocok) {
        item.start = segmenCocok.start;
        if (item.end <= item.start) item.end = Math.min(durasiClip, item.start + 0.14);
      }
    }
  }

  return semuaKata;
}

function tulisFileASS(daftarKata, assPath, durasiClip, fontCfg, hookText = '') {
  if (!daftarKata || daftarKata.length === 0) {
    throw new Error('Tidak ada suara/VO manusia yang terdeteksi di segmen video ini.');
  }

  // Rapikan urutan waktu kata dan kompensasi persepsi visual (-0.04 detik) agar pas dengan gerakan bibir/VO
  const kataRapi = [...daftarKata]
    .sort((a, b) => a.start - b.start)
    .map(k => ({
      kata: k.kata,
      start: Math.max(0, k.start - 0.04),
      end: Math.min(durasiClip, Math.max(k.start + 0.05, k.end - 0.02))
    }));

  for (let i = 0; i < kataRapi.length - 1; i++) {
    if (kataRapi[i + 1].start < kataRapi[i].end) {
      kataRapi[i].end = Math.max(kataRapi[i].start + 0.02, kataRapi[i + 1].start);
    }
  }

  // Kelompokkan menjadi 3-4 kata per baris tampilan berdasarkan jeda intonasi bicara asli
  const grupBaris = [];
  let tampung = [];

  for (let i = 0; i < kataRapi.length; i++) {
    const item = kataRapi[i];
    const jedaAntarKata = tampung.length > 0 ? item.start - tampung[tampung.length - 1].end : 0;
    const teksSementara = [...tampung.map(x => x.kata), item.kata].join(' ');

    if (tampung.length > 0 && (jedaAntarKata > 0.35 || tampung.length >= 4 || teksSementara.length > 22)) {
      grupBaris.push(tampung);
      tampung = [];
    }
    tampung.push(item);
  }
  if (tampung.length > 0) grupBaris.push(tampung);

  const headerAss = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ViralSub,${fontCfg.fontName},${fontCfg.fontSize},&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,${fontCfg.spacing},0,1,${fontCfg.outline},2,2,80,80,340,1
Style: HookBanner,Montserrat,54,&H00FFFFFF,&H0000FFFF,&H00000000,&HE0101010,-1,0,0,0,100,100,1,0,3,16,0,8,70,70,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Kumpulkan seluruh segmen mentah terlebih dahulu untuk dipastikan 0% overlap (anti-glitch double subtitle)
  const rawSubEvents = [];

  grupBaris.forEach((grup, idxBaris) => {
    const akhirKataTerakhir = grup[grup.length - 1].end;
    const batasAkhirBaris = idxBaris < grupBaris.length - 1
      ? Math.min(grupBaris[idxBaris + 1][0].start, akhirKataTerakhir + 0.12)
      : Math.min(durasiClip, akhirKataTerakhir + 0.25);

    grup.forEach((kataAktifObj, idxKataAktif) => {
      const wStart = kataAktifObj.start;
      const wEnd = idxKataAktif < grup.length - 1
        ? grup[idxKataAktif + 1].start
        : batasAkhirBaris;

      if (wEnd <= wStart + 0.015) return;

      const teksBarisBerjalan = grup.map((obj, i) => {
        if (i === idxKataAktif) {
          return `{\\c&H0000FFFF&}${obj.kata}{\\c&H00FFFFFF&}`;
        }
        return obj.kata;
      }).join(' ');

      const animasi = idxKataAktif === 0
        ? `{\\fscx86\\fscy86\\t(0,65,\\fscx103\\fscy103)\\t(65,120,\\fscx100\\fscy100)}`
        : '';

      rawSubEvents.push({
        start: wStart,
        end: wEnd,
        text: `${animasi}${teksBarisBerjalan}`
      });
    });
  });

  // Kunci ketat anti-overlap: pastikan event sebelumnya selalu selesai tepat sebelum event berikutnya mulai
  rawSubEvents.sort((a, b) => a.start - b.start);
  const events = [];

  // Tambahkan Hook Banner di bagian atas layar selama 3.5 detik pertama
  if (hookText) {
    const hookClean = hookText.replace(/[\r\n]+/g, ' ').trim().toUpperCase();
    const durasiHook = Math.min(3.5, durasiClip);
    events.push(`Dialogue: 1,0:00:00.00,${detikKeAss(durasiHook)},HookBanner,,0,0,0,,{\\fad(120,280)}${hookClean}`);
  }

  for (let i = 0; i < rawSubEvents.length; i++) {
    const cur = rawSubEvents[i];
    if (i < rawSubEvents.length - 1 && cur.end > rawSubEvents[i + 1].start) {
      cur.end = rawSubEvents[i + 1].start;
    }
    if (cur.end - cur.start < 0.02) continue;
    events.push(`Dialogue: 0,${detikKeAss(cur.start)},${detikKeAss(cur.end)},ViralSub,,0,0,0,,${cur.text}`);
  }

  fs.writeFileSync(assPath, headerAss + events.join('\n') + '\n', 'utf8');
}

function unduhVideoDenganFallback(url) {
  // Bersihkan parameter pelacak ?si= pada link share YouTube agar lebih bersih
  let cleanUrl = url.trim();
  if (cleanUrl.includes('youtu.be/')) {
    cleanUrl = cleanUrl.split('?')[0];
  }

  if (YOUTUBE_COOKIES) {
    fs.writeFileSync('cookies.txt', YOUTUBE_COOKIES, 'utf8');
  }

  const strategi = [];
  if (YOUTUBE_COOKIES) {
    strategi.push(`--js-runtimes node --remote-components ejs:github --cookies cookies.txt --extractor-args "youtube:player_client=tv_embedded,web_safari"`);
    strategi.push(`--js-runtimes node --remote-components ejs:github --impersonate chrome --cookies cookies.txt`);
    strategi.push(`--js-runtimes node --remote-components ejs:github --cookies cookies.txt --extractor-args "youtube:player_client=mweb,web"`);
  }
  strategi.push(`--js-runtimes node --remote-components ejs:github --extractor-args "youtube:player_client=tv_embedded,android"`);
  strategi.push(`--js-runtimes node --remote-components ejs:github --impersonate chrome`);
  strategi.push(`--js-runtimes node --remote-components ejs:github`);

  let errorTerakhir = '';
  for (let i = 0; i < strategi.length; i++) {
    try {
      console.log(`Mencoba unduh video (strategi ${i + 1}/${strategi.length})...`);
      execSync(
        `yt-dlp ${strategi[i]} --no-check-certificates -f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "sumber.mp4" "${cleanUrl}"`,
        { stdio: 'inherit' }
      );
      if (fs.existsSync('sumber.mp4')) return;
    } catch (e) {
      errorTerakhir = e.message;
      console.log(`Strategi ${i + 1} gagal:`, e.message);
    }
  }
  throw new Error(`Gagal mengunduh video dari YouTube (${errorTerakhir})`);
}

async function main() {
  if (!VIDEO_URL) throw new Error('Link video kosong!');
  await kirimPesan(`✂️ AI Clipper mulai bekerja!\n🔗 Link: ${VIDEO_URL}\n🔤 Font Subtitle: ${FONT_CONFIG.label}\n\n1/3 Mengunduh video & mengekstrak suara VO...`);

  // Langsung unduh video tanpa ketergantungan pada subtitle YouTube
  unduhVideoDenganFallback(VIDEO_URL);

  // Cek durasi total video menggunakan ffprobe
  const durasiStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 sumber.mp4`).toString().trim();
  const durasiTotal = parseFloat(durasiStr) || 60;

  // Ekstrak audio seluruh video dalam format ringan (16kHz mono 32kbps) untuk didengarkan Gemini AI
  execSync(`ffmpeg -y -i sumber.mp4 -vn -ac 1 -ar 16000 -b:a 32k audio_full.mp3`, { stdio: 'inherit' });

  await kirimPesan('2/3 Gemini AI sedang mendengarkan suara video & mencari momen viral...');
  const momen = await cariMomenViralDariAudio('audio_full.mp3', durasiTotal);

  // Validasi agar rentang waktu tidak melebihi durasi video
  let startClip = waktuKeDetik(momen.start);
  let endClip = waktuKeDetik(momen.end);
  if (endClip > durasiTotal) endClip = durasiTotal;
  if (endClip - startClip < 15) {
    startClip = Math.max(0, endClip - 40);
  }
  const startFmt = detikKeHHMMSS(startClip);
  const endFmt = detikKeHHMMSS(endClip);
  const hookBanner = (momen.hook_banner || momen.judul || '').replace(/#Shorts/gi, '').trim();

  await kirimPesan(`🔥 Momen ditemukan!\n⏱️ ${startFmt} - ${endFmt}\n📌 ${momen.judul}\n💡 ${momen.alasan}\n\n3/3 Memotong video 9:16, dynamic zoom, backsound & subtitle (${FONT_CONFIG.fontName})...`);

  // Potong video ke format 9:16 (1080x1920)
  execSync(`ffmpeg -y -ss ${startFmt} -to ${endFmt} -i sumber.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" -c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 128k clip_mentah.mp4`, { stdio: 'inherit' });

  // Ukur durasi aktual tepat dari clip_mentah.mp4 agar sinkron 100% sampai frame terakhir
  const durasiClipAktualStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 clip_mentah.mp4`).toString().trim();
  const durasiClip = parseFloat(durasiClipAktualStr) || Math.max(1, endClip - startClip);

  // Ekstrak audio khusus potongan klip ini
  execSync(`ffmpeg -y -i clip_mentah.mp4 -vn -ac 1 -ar 16000 -b:a 64k audio_klip.mp3`, { stdio: 'inherit' });

  const daftarKataPresisi = await transkripKataDariAudio('audio_klip.mp3', durasiClip);

  tulisFileASS(daftarKataPresisi, 'sub_klip.ass', durasiClip, FONT_CONFIG, hookBanner);

  // Render final: Dynamic Zoom-In halus setiap 9 detik + Hook Banner 3.5 detik + Subtitle Anti-Overlap + Backsound Ambient Lembut
  const zoomFilter = "scale=1200:2134,crop=w='1200-120*max(0,sin(2*PI*t/9))':h='2134-214*max(0,sin(2*PI*t/9))':x='(iw-ow)/2':y='(ih-oh)/2',scale=1080:1920,ass=sub_klip.ass";
  const bgmSynth = `aevalsrc='0.018*sin(2*PI*130.81*t)+0.014*sin(2*PI*196.00*t)+0.011*sin(2*PI*246.94*t)+0.009*sin(2*PI*293.66*t)':s=44100:d=${durasiClip.toFixed(2)}`;

  execSync(
    `ffmpeg -y -i clip_mentah.mp4 -f lavfi -i "${bgmSynth}" -filter_complex "[0:v]${zoomFilter}[v];[1:a]lowpass=f=420,afade=t=in:st=0:d=1.5,afade=t=out:st=${Math.max(0, durasiClip - 1.5).toFixed(2)}:d=1.5[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2:weights='1 0.35'[a]" -map "[v]" -map "[a]" -c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 128k -movflags +faststart clip_jadi.mp4`,
    { stdio: 'inherit' }
  );

  const captionSosmed = momen.caption_sosmed || `${momen.judul} #shorts #fyp #podcast #edukasi #viral`;
  const caption = `✂️ KLIP VIRAL SIAP!\n\n📌 ${momen.judul}\n⏱️ Segmen: ${startFmt} - ${endFmt}\n🔤 Font: ${FONT_CONFIG.label}\n💡 Alasan: ${momen.alasan}\n\n📋 CAPTION & HASHTAG SIAP COPAS:\n${captionSosmed}`;
  await kirimVideo('clip_jadi.mp4', caption);

  // Kirim tombol pilihan font yang langsung masuk ke kolom ketik chat (tidak langsung terkirim)
  await kirimPesan('🎨 Pilih font untuk klip berikutnya (pencet tombolnya, nanti otomatis masuk ke kolom ketik—kamu tinggal tempel link YouTube-nya):', {
    inline_keyboard: [
      [
        { text: '✂️ Clip + Montserrat', switch_inline_query_current_chat: '/clip montserrat ' },
        { text: '💥 Clip + Anton',      switch_inline_query_current_chat: '/clip anton ' }
      ],
      [
        { text: '✨ Clip + Poppins',    switch_inline_query_current_chat: '/clip poppins ' },
        { text: '😄 Clip + Comic Neue', switch_inline_query_current_chat: '/clip comic ' }
      ],
      [
        { text: '🎙️ Clip + Roboto',     switch_inline_query_current_chat: '/clip roboto ' },
        { text: '🎬 Clip + DejaVu',     switch_inline_query_current_chat: '/clip dejavu ' }
      ]
    ]
  });
  console.log('Selesai! Klip berhasil dikirim.');
}

main().catch(async err => {
  console.error(err);
  await kirimPesan('⚠️ AI Clipper gagal: ' + err.message);
  process.exit(1);
});
