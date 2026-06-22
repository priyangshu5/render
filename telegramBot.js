// telegramBot.js
// =============================================================
// Owner-only admin control panel on Telegram.
// Updated so /stopbot, /restart, /startbot, /qr preserve the
// WhatsApp session (Firestore-backed). /qr only sends a code if
// not already connected.
// =============================================================

const TelegramBot = require("node-telegram-bot-api");

const config = require("./config");
const logger = require("./utils/logger");
const db = require("./database");
const wa = require("./whatsappBot");

let bot = null;
let lastQRBuffer = null;

function isOwner(chatId) {
  return String(chatId) === String(config.OWNER_TELEGRAM_ID);
}

function startTelegram() {
  bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
  logger.info("Telegram control bot started.");

  wa.setCallbacks({
    onQR: (pngBuffer) => {
      lastQRBuffer = pngBuffer;
      sendQRToOwner(pngBuffer);
    },
    onConnected: () => {
      sendToOwner("✅ WhatsApp login successful.");
    },
  });

  bot.onText(/^\/(start|help)$/, (msg) => {
    if (!guard(msg)) return;
    sendToOwner(helpText());
  });

  bot.onText(/^\/status$/, (msg) => {
    if (!guard(msg)) return;
    const s = wa.getStatus();
    const stats = db.getStats();
    const uptime = formatUptime(Date.now() - (stats.startTime || Date.now()));
    sendToOwner(
      `📊 *Mimu Status*\n\n` +
        `WhatsApp connected: ${s.connected ? "✅ Yes" : "❌ No"}\n` +
        `Bot running: ${s.running ? "✅ Yes" : "❌ No"}\n` +
        `Total users: ${stats.totalUsers || 0}\n` +
        `Total messages: ${stats.totalMessages || 0}\n` +
        `Uptime: ${uptime}`
    );
  });

  // Start the socket using stored credentials (no session deletion).
  bot.onText(/^\/startbot$/, async (msg) => {
    if (!guard(msg)) return;
    sendToOwner("Starting WhatsApp bot (using saved session)...");
    await wa.startWhatsApp();
  });

  // Stop ONLY the socket. Session stays in Firestore.
  bot.onText(/^\/stopbot$/, async (msg) => {
    if (!guard(msg)) return;
    await wa.stopWhatsApp();
    sendToOwner("🛑 WhatsApp socket stopped. Session preserved.");
  });

  // Restart cleanly, keeping the session.
  bot.onText(/^\/restart$/, async (msg) => {
    if (!guard(msg)) return;
    sendToOwner("♻️ Restarting WhatsApp socket (session preserved)...");
    await wa.stopWhatsApp();
    setTimeout(() => wa.startWhatsApp(), 2000);
  });

  // Only send a QR if NOT already connected.
  bot.onText(/^\/qr$/, (msg) => {
    if (!guard(msg)) return;
    if (wa.isWhatsAppConnected()) {
      sendToOwner("✅ WhatsApp is already connected.");
      return;
    }
    const qr = wa.getLastQR() || lastQRBuffer;
    if (qr) {
      sendQRToOwner(qr);
    } else {
      sendToOwner(
        "No QR available yet. The bot will generate one if the saved " +
          "session is missing or invalid. Try /restart if needed."
      );
    }
  });

  bot.onText(/^\/users$/, (msg) => {
    if (!guard(msg)) return;
    const users = db.getUsers();
    const ids = Object.keys(users);
    let text = `👥 *Users: ${ids.length}*\n\n`;
    ids.slice(0, 15).forEach((id) => {
      const u = users[id];
      text += `• ${u.phone} — ${u.messageCount || 0} msgs — ${u.state}\n`;
    });
    if (ids.length > 15) text += `\n...and ${ids.length - 15} more.`;
    sendToOwner(text);
  });

  bot.onText(/^\/logs$/, (msg) => {
    if (!guard(msg)) return;
    const logs = db.getRecentLogs(15);
    if (logs.length === 0) {
      sendToOwner("No logs yet.");
      return;
    }
    let text = "📜 *Recent logs:*\n\n";
    logs.forEach((l) => {
      text += `• ${l.time.split("T")[1].split(".")[0]} — ${l.event}: ${l.details}\n`;
    });
    sendToOwner(text);
  });

  bot.onText(/^\/ping$/, (msg) => {
    if (!guard(msg)) return;
    sendToOwner("🏓 Pong! Mimu is alive.");
  });

  bot.onText(/^\/memory$/, (msg) => {
    if (!guard(msg)) return;
    const users = db.getUsers();
    let text = "🧠 *Messages left for you:*\n\n";
    let found = false;
    for (const id of Object.keys(users)) {
      const u = users[id];
      if (u.savedMessages && u.savedMessages.length > 0) {
        found = true;
        text += `📱 ${u.phone}:\n`;
        u.savedMessages.slice(-5).forEach((m) => {
          text += `   • ${m.content}\n`;
        });
        text += "\n";
      }
    }
    if (!found) text = "No saved messages right now.";
    sendToOwner(text);
  });

  bot.onText(/^\/broadcast (.+)/s, async (msg, match) => {
    if (!guard(msg)) return;
    const message = match[1];
    sendToOwner("📢 Broadcasting...");
    const count = await wa.broadcast(message);
    sendToOwner(`✅ Broadcast sent to ${count} users.`);
  });

  bot.on("message", (msg) => {
    if (!isOwner(msg.chat.id)) {
      bot.sendMessage(msg.chat.id, "Access denied.");
    }
  });

  bot.on("polling_error", (err) => {
    logger.error(`Telegram polling error: ${err.message}`);
  });

  return bot;
}

function guard(msg) {
  if (!isOwner(msg.chat.id)) {
    bot.sendMessage(msg.chat.id, "Access denied.");
    return false;
  }
  return true;
}

function sendToOwner(text) {
  if (!bot) return;
  bot
    .sendMessage(config.OWNER_TELEGRAM_ID, text, { parse_mode: "Markdown" })
    .catch((err) => logger.error(`Telegram send failed: ${err.message}`));
}

function sendQRToOwner(pngBuffer) {
  if (!bot) return;
  bot
    .sendPhoto(config.OWNER_TELEGRAM_ID, pngBuffer, {
      caption: "📱 Scan in WhatsApp → Linked Devices → Link a Device.",
    })
    .catch((err) => logger.error(`Telegram QR send failed: ${err.message}`));
}

function helpText() {
  return (
    "🤖 *Mimu Admin Panel*\n\n" +
    "/status - Bot status & stats\n" +
    "/startbot - Start WhatsApp (saved session)\n" +
    "/stopbot - Stop socket (keep session)\n" +
    "/restart - Restart socket (keep session)\n" +
    "/qr - Send QR only if not connected\n" +
    "/users - List users\n" +
    "/logs - Recent logs\n" +
    "/ping - Health check\n" +
    "/memory - Messages left for you\n" +
    "/broadcast <msg> - Message all users\n" +
    "/help - Show this menu"
  );
}

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

module.exports = { startTelegram, sendToOwner };
