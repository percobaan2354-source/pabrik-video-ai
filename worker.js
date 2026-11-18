export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Bot Pabrik Video Aktif!');

    const update = await request.json();
    const msg = update.message;
    if (!msg || !msg.text) return new Response('OK');

    const chatId = String(msg.chat.id);
    if (chatId !== String(env.TELEGRAM_CHAT_ID)) {
      return new Response('Unauthorized');
    }

    const teks = msg.text.trim();
    const lower = teks.toLowerCase();

    // 1. Perintah /status -> Cek antrean & progres render di GitHub Actions
    if (lower.startsWith('/status')) {
      const runRes = await fetch(
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/render.yml/runs?per_page=1`,
        {
          headers: {
            'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'Cloudflare-Worker-Bot'
          }
        }
      );

      if (!runRes.ok) {
        await balasTelegram(env.TELEGRAM_TOKEN, chatId, '❌ Gagal mengecek status GitHub Actions.');
        return new Response('OK');
      }

      const data = await runRes.json();
      const lastRun = data.workflow_runs && data.workflow_runs[0];
      if (!lastRun) {
        await balasTelegram(env.TELEGRAM_TOKEN, chatId, '📭 Belum ada riwayat render video.');
        return new Response('OK');
      }

      const statusMap = {
        queued: '⏳ Sedang antre...',
        in_progress: '⚙️ Sedang merender video...',
        completed: lastRun.conclusion === 'success' ? '✅ Selesai (Sukses)' : `⚠️ Selesai (${lastRun.conclusion})`
      };
      const statusTeks = statusMap[lastRun.status] || lastRun.status;
      await balasTelegram(
        env.TELEGRAM_TOKEN,
        chatId,
        `📊 *STATUS RENDER TERAKHIR*\n\nStatus: ${statusTeks}\nWaktu: ${lastRun.created_at}`,
        'Markdown'
      );
      return new Response('OK');
    }

    // 2. Perintah /ide -> Minta 5 ide judul viral dari Gemini siap tap
    if (lower.startsWith('/ide')) {
      if (!env.GEMINI_API_KEY) {
        await balasTelegram(env.TELEGRAM_TOKEN, chatId, '⚠️ GEMINI_API_KEY belum dipasang di Cloudflare Worker.');
        return new Response('OK');
      }

      const topik = teks.replace(/^\/ide(@\w+)?\s*/i, '').trim() || 'fakta unik sains, sejarah, dan psikologi';
      await balasTelegram(env.TELEGRAM_TOKEN, chatId, '🧠 Sedang meracik 5 ide judul viral...');

      const gemRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Buatkan 5 ide judul video pendek edukasi yang sangat bikin penasaran tentang: ${topik}. Format tiap baris PERSIS seperti ini tanpa nomor atau tanda baca lain:\n/buat Judul Menarik di Sini`
              }]
            }]
          })
        }
      );

      const gemJson = await gemRes.json();
      const hasilIde = gemJson?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (hasilIde) {
        await balasTelegram(
          env.TELEGRAM_TOKEN,
          chatId,
          `💡 *5 IDE JUDUL VIRAL*\n_(Tap perintah di bawah untuk menyalin lalu kirim)_:\n\n${hasilIde}`,
          'Markdown'
        );
      } else {
        await balasTelegram(env.TELEGRAM_TOKEN, chatId, '❌ Gagal mengambil ide dari Gemini.');
      }
      return new Response('OK');
    }

    // 3. Perintah pembuatan video: /buat, /buat_en, /buat_yt
    let mode = null;
    if (lower.startsWith('/buat_en')) mode = 'en';
    else if (lower.startsWith('/buat_yt')) mode = 'yt';
    else if (lower.startsWith('/buat')) mode = 'id';

    if (!mode) {
      await balasTelegram(
        env.TELEGRAM_TOKEN,
        chatId,
        '🎬 *MENU PABRIK VIDEO AI*\n\n' +
        '• `/buat Judul Video` → Video vertikal 9:16 (Indonesia)\n' +
        '• `/buat_en Video Title` → Video vertikal 9:16 (Inggris)\n' +
        '• `/buat_yt Judul Video` → Video panjang 16:9 (YouTube)\n' +
        '• `/ide` → Minta 5 ide judul viral otomatis\n' +
        '• `/status` → Cek progres render video',
        'Markdown'
      );
      return new Response('OK');
    }

    const isi = teks.replace(/^\/buat(_en|_yt)?(@\w+)?\s*/i, '').trim();

    // Jika user hanya memencet tombol /buat dari menu tanpa mengetik judul
    if (!isi) {
      const contohCmd = mode === 'en' ? '/buat_en Why Do Cats Fear Cucumbers?'
        : mode === 'yt' ? '/buat_yt Sejarah Perang Burung Emu Australia'
        : '/buat Kenapa Kita Merem Saat Bersin?';

      await balasTelegram(
        env.TELEGRAM_TOKEN,
        chatId,
        `✍️ Ketik judul setelah perintah ya!\n\nContoh siap pakai:\n\`${contohCmd}\`\n\nAtau pakai pemisah lengkap:\n\`/buat Judul | 9:16 | Indonesia\``,
        'Markdown'
      );
      return new Response('OK');
    }

    const bagian = isi.split('|').map(s => s.trim());
    const judul  = bagian[0];
    const ukuran = bagian[1] || (mode === 'yt' ? '16:9' : '9:16');
    const bahasa = bagian[2] || (mode === 'en' ? 'Inggris' : 'Indonesia');

    const ghRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/render.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Cloudflare-Worker-Bot'
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: { judul, ukuran, bahasa }
        })
      }
    );

    if (ghRes.ok) {
      await balasTelegram(
        env.TELEGRAM_TOKEN,
        chatId,
        `⚙️ *Pesanan diterima!*\n\n📌 Judul: ${judul}\n📐 Ukuran: ${ukuran}\n🗣️ Bahasa: ${bahasa}\n\nKetik /status untuk cek progres. Video masuk ke sini dalam ±3 menit.`,
        'Markdown'
      );
    } else {
      const err = await ghRes.text();
      await balasTelegram(env.TELEGRAM_TOKEN, chatId, `❌ Gagal memicu GitHub: ${err}`);
    }

    return new Response('OK');
  }
};

async function balasTelegram(token, chatId, text, parseMode = '') {
  const payload = { chat_id: chatId, text };
  if (parseMode) payload.parse_mode = parseMode;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
