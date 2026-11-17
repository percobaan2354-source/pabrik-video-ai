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
    if (!teks.startsWith('/buat')) {
      await balasTelegram(env.TELEGRAM_TOKEN, chatId,
        '🎬 Format perintah:\n/buat Judul Video\n\nContoh dengan ukuran & bahasa:\n/buat Kenapa Kucing Takut Timun | 9:16 | Indonesia'
      );
      return new Response('OK');
    }

    const isi = teks.replace(/^\/buat\s*/i, '');
    const bagian = isi.split('|').map(s => s.trim());
    const judul  = bagian[0] || 'Fakta Unik Dunia';
    const ukuran = bagian[1] || '9:16';
    const bahasa = bagian[2] || 'Indonesia';

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
      await balasTelegram(env.TELEGRAM_TOKEN, chatId,
        `⚙️ Pesanan diterima!\n\n📌 Judul: ${judul}\n📐 Ukuran: ${ukuran}\n🗣️ Bahasa: ${bahasa}\n\nTunggu ±3 menit, video langsung masuk ke sini.`
      );
    } else {
      const err = await ghRes.text();
      await balasTelegram(env.TELEGRAM_TOKEN, chatId, `❌ Gagal memicu GitHub: ${err}`);
    }

    return new Response('OK');
  }
};

async function balasTelegram(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}
