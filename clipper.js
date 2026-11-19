const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GEMINI_API_KEY   = (process.env.GEMINI_API_KEY || '').trim();
const TELEGRAM_TOKEN   = (process.env.TELEGRAM_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const VIDEO_URL        = (process.env.INPUT_URL || '').trim();
const YOUTUBE_COOKIES  = (process.env.YOUTUBE_COOKIES || '').trim();

async function kirimPesan(teks) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: teks.slice(0, 4000) })
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
  const centi = Math.floor((d - Math.floor(d)) * 100);
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

// Cari momen viral langsung dengan mendengarkan suara/VO video (berfungsi meski tanpa subtitle YouTube!)
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
- Keluarkan HANYA JSON murni tanpa teks tambahan:
{
  "start": "00:01:15",
  "end": "00:01:58",
  "judul": "Judul Hook Viral #Shorts",
  "alasan": "Alasan singkat kenapa momen ini berpotensi viral"
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

async function transkripKataDariAudio(audioPath, durasiClip) {
  const audioBase64 = fs.readFileSync(audioPath).toString('base64');
  const prompt = `Dengarkan audio klip berdurasi ${durasiClip.toFixed(2)} detik ini dengan sangat teliti.
Transkripsikan SETIAP KATA yang diucapkan manusia/VO (baik bahasa Indonesia, Inggris, maupun campuran) beserta waktu mulai (start) dan waktu selesai (end) dalam satuan DETIK (angka desimal, contoh: 1.24) yang BENAR-BENAR PAS dengan suara ucapannya!

ATURAN KETAT:
- Dengarkan ritme suara aslinya! Jangan menebak waktu secara rata. Jika pembicara diam/jeda, jangan isi kata di waktu diam tersebut.
- Tulis kata per kata secara terpisah (1 objek = 1 kata) agar sorotan karaoke berjalan tepat per kata.
- "start" dan "end" adalah detik relatif dari awal audio (0.00 sampai ${durasiClip.toFixed(2)}).
- Keluarkan HANYA JSON array murni tanpa teks tambahan:
[
  {"kata": "Halo", "start": 0.35, "end": 0.68},
  {"kata": "semuanya", "start": 0.69, "end": 1.15}
]`;

  const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
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
          // Pastikan jika AI menggabungkan >1 kata dalam satu objek, tetap dipecah proporsional per kata
          const hasilKata = [];
          for (const x of parsed) {
            if (!x || !x.kata || typeof x.start !== 'number' || typeof x.end !== 'number') continue;
            const s = Math.max(0, Math.min(durasiClip, x.start));
            const e = Math.max(s + 0.08, Math.min(durasiClip, x.end));
            const subKata = String(x.kata).trim().split(/\s+/).filter(Boolean);
            if (subKata.length === 1) {
              hasilKata.push({ kata: subKata[0], start: s, end: e });
            } else if (subKata.length > 1) {
              const totalHuruf = subKata.reduce((acc, w) => acc + w.length, 0) || 1;
              let kursor = s;
              for (const w of subKata) {
                const dur = ((w.length / totalHuruf) * (e - s));
                hasilKata.push({ kata: w, start: kursor, end: kursor + dur });
                kursor += dur;
              }
            }
          }
          return hasilKata;
        }
      } else {
        console.log(`Audio align ${model} respon:`, JSON.stringify(json.error || json));
      }
    } catch (e) {
      console.log(`Gagal audio align ${model}:`, e.message);
    }
  }
  return null;
}

function tulisFileASS(daftarKata, assPath, durasiClip) {
  if (!daftarKata || daftarKata.length === 0) {
    throw new Error('Tidak ada suara/VO manusia yang terdeteksi di segmen video ini.');
  }

  // Rapikan urutan waktu kata agar tidak saling tumpang tindih
  const kataRapi = [...daftarKata].sort((a, b) => a.start - b.start);
  for (let i = 0; i < kataRapi.length - 1; i++) {
    if (kataRapi[i + 1].start < kataRapi[i].end) {
      kataRapi[i].end = Math.max(kataRapi[i].start + 0.05, kataRapi[i + 1].start);
    }
  }

  // Kelompokkan menjadi 3-4 kata per baris tampilan berdasarkan jeda suara asli
  const grupBaris = [];
  let tampung = [];

  for (let i = 0; i < kataRapi.length; i++) {
    const item = kataRapi[i];
    const jedaAntarKata = tampung.length > 0 ? item.start - tampung[tampung.length - 1].end : 0;
    const teksSementara = [...tampung.map(x => x.kata), item.kata].join(' ');

    if (tampung.length > 0 && (jedaAntarKata > 0.45 || tampung.length >= 4 || teksSementara.length > 22)) {
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
Style: ViralSub,DejaVu Sans,64,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,80,80,340,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = [];

  grupBaris.forEach((grup, idxBaris) => {
    const akhirKataTerakhir = grup[grup.length - 1].end;
    const batasAkhirBaris = idxBaris < grupBaris.length - 1
      ? Math.min(grupBaris[idxBaris + 1][0].start, akhirKataTerakhir + 0.15)
      : Math.min(durasiClip, akhirKataTerakhir + 0.25);

    // Setiap kata di dalam baris mendapat event sendiri agar sorotan kuning (&H0000FFFF&) berjalan seiring suara VO
    grup.forEach((kataAktifObj, idxKataAktif) => {
      const wStart = kataAktifObj.start;
      const wEnd = idxKataAktif < grup.length - 1
        ? Math.max(wStart + 0.05, grup[idxKataAktif + 1].start)
        : Math.max(wStart + 0.05, batasAkhirBaris);

      if (wEnd <= wStart) return;

      const teksBarisBerjalan = grup.map((obj, i) => {
        if (i === idxKataAktif) {
          return `{\\c&H0000FFFF&}${obj.kata}{\\c&H00FFFFFF&}`;
        }
        return obj.kata;
      }).join(' ');

      const animasi = idxKataAktif === 0
        ? `{\\fscx86\\fscy86\\t(0,70,\\fscx103\\fscy103)\\t(70,130,\\fscx100\\fscy100)}`
        : '';

      events.push(`Dialogue: 0,${detikKeAss(wStart)},${detikKeAss(wEnd)},ViralSub,,0,0,0,,${animasi}${teksBarisBerjalan}`);
    });
  });

  fs.writeFileSync(assPath, headerAss + events.join('\n') + '\n', 'utf8');
}

function unduhVideoDenganFallback(url) {
  if (YOUTUBE_COOKIES) {
    fs.writeFileSync('cookies.txt', YOUTUBE_COOKIES, 'utf8');
  }

  const strategi = [];
  if (YOUTUBE_COOKIES) {
    strategi.push(`--js-runtimes node --remote-components ejs:github --impersonate chrome --cookies cookies.txt`);
    strategi.push(`--js-runtimes node --remote-components ejs:github --cookies cookies.txt --extractor-args "youtube:player_client=web_safari,tv"`);
  }
  strategi.push(`--js-runtimes node --remote-components ejs:github --impersonate chrome --extractor-args "youtube:player_client=android,tv"`);
  strategi.push(`--js-runtimes node --remote-components ejs:github`);

  let errorTerakhir = '';
  for (let i = 0; i < strategi.length; i++) {
    try {
      console.log(`Mencoba unduh video (strategi ${i + 1}/${strategi.length})...`);
      execSync(
        `yt-dlp ${strategi[i]} -f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "sumber.mp4" "${url}"`,
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
  await kirimPesan(`✂️ AI Clipper mulai bekerja!\n🔗 Link: ${VIDEO_URL}\n\n1/3 Mengunduh video & mengekstrak suara VO...`);

  // Langsung unduh video tanpa ketergantungan pada subtitle YouTube (bebas limit 429 endpoint subtitle!)
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

  await kirimPesan(`🔥 Momen ditemukan!\n⏱️ ${startFmt} - ${endFmt}\n📌 ${momen.judul}\n💡 ${momen.alasan}\n\n3/3 Memotong video 9:16 & membuat subtitle karaoke presisi dari suara VO...`);

  // Potong video ke format 9:16 (1080x1920)
  execSync(`ffmpeg -y -ss ${startFmt} -to ${endFmt} -i sumber.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" -c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 128k clip_mentah.mp4`, { stdio: 'inherit' });

  // Ekstrak audio khusus potongan klip ini agar timestamp per kata benar-benar sinkron dari detik 0.00
  execSync(`ffmpeg -y -i clip_mentah.mp4 -vn -ac 1 -ar 16000 -b:a 48k audio_klip.mp3`, { stdio: 'inherit' });

  const durasiClip = Math.max(1, endClip - startClip);
  const daftarKataPresisi = await transkripKataDariAudio('audio_klip.mp3', durasiClip);

  tulisFileASS(daftarKataPresisi, 'sub_klip.ass', durasiClip);

  // Tempel subtitle ASS beranimasi dengan sorotan kuning berjalan ke video final
  execSync(`ffmpeg -y -i clip_mentah.mp4 -vf "ass=sub_klip.ass" -c:v libx264 -preset veryfast -crf 22 -c:a copy -movflags +faststart clip_jadi.mp4`, { stdio: 'inherit' });

  const caption = `✂️ KLIP VIRAL SIAP!\n\n📌 ${momen.judul}\n⏱️ Segmen: ${startFmt} - ${endFmt}\n💡 Alasan: ${momen.alasan}`;
  await kirimVideo('clip_jadi.mp4', caption);
  console.log('Selesai! Klip berhasil dikirim.');
}

main().catch(async err => {
  console.error(err);
  await kirimPesan('⚠️ AI Clipper gagal: ' + err.message);
  process.exit(1);
});
