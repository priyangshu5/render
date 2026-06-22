// =========================================================
// whatsappBot.js
// ---------------------------------------------------------
// Core WhatsApp engine (Baileys) with Firestore-backed
// persistent sessions. The session survives every kind of
// restart and is only cleared when WhatsApp truly logs out.
//
// NOTE: "pino" has been removed. Baileys needs *some* logger
// object, so we pass a tiny "silentLogger" that does nothing.
// =========================================================

const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");

const config = require("./config");
const logger = require("./utils/logger");
const db = require("./database");
const memory = require("./memoryManager");
const { getAIReply } = require("./openrouter");
const { isOnCooldown, isRateLimited } = require("./utils/rateLimiter");
const { sleep, isPrivateChat, getPhoneFromJid } = require("./utils/helpers");
const {
  useFirebaseAuthState,
  clearFirebaseAuthState,
} = require("./firebaseAuthState");

const ASSETS_FOLDER = path.join(__dirname, "assets");

// ---------------------------------------------------------
// Baileys requires a logger object with these methods. Since
// we removed pino, we give it a "silent" logger that does
// nothing and can create a "child" of itself (Baileys calls
// logger.child(...) internally).
// ---------------------------------------------------------
const silentLogger = {
  level: "silent",
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child() {
    return silentLogger;
  },
};

let sock = null;
let isConnected = false;
let shouldRun = true;
let isStarting = false;
let lastQRBuffer = null;

const callbacks = {
  onQR: null,
  onConnected: null,
};

function setCallbacks(newCallbacks) {
  if (newCallbacks.onQR) callbacks.onQR = newCallbacks.onQR;
  if (newCallbacks.onConnected) callbacks.onConnected = newCallbacks.onConnected;
}

// ---------- Start / connect ----------
async function startWhatsApp() {
  if (isStarting) {
    logger.info("startWhatsApp called but already starting. Ignoring.");
    return;
  }
  isStarting = true;
  shouldRun = true;

  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch (e) {}
    sock = null;
  }

  // Load auth state FROM FIRESTORE instead of a local folder.
  const { state, saveCreds } = await useFirebaseAuthState();
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: silentLogger, // our no-op logger (replaces pino)
    printQRInTerminal: false,
    browser: ["Mimu", "Chrome", "1.0.0"],
  });

  // Save creds to Firestore whenever they change.
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info("QR code received. Sending to Telegram...");
      try {
        const pngBuffer = await QRCode.toBuffer(qr, {
          type: "png",
          width: 512,
          margin: 2,
        });
        lastQRBuffer = pngBuffer;
        if (callbacks.onQR) callbacks.onQR(pngBuffer);
      } catch (err) {
        logger.error(`Failed to generate QR image: ${err.message}`);
      }
    }

    if (connection === "open") {
      isConnected = true;
      isStarting = false;
      lastQRBuffer = null;
      logger.info("WhatsApp login successful.");
      db.addLog("whatsapp_login", "Login successful");
      if (callbacks.onConnected) callbacks.onConnected();
    }

    if (connection === "close") {
      isConnected = false;
      isStarting = false;

      const statusCode =
        lastDisconnect &&
        lastDisconnect.error &&
        lastDisconnect.error.output &&
        lastDisconnect.error.output.statusCode;

      const loggedOut = statusCode === DisconnectReason.loggedOut;

      logger.warn(
        `WhatsApp connection closed. Code: ${statusCode}. LoggedOut: ${loggedOut}`
      );
      db.addLog("whatsapp_disconnect", `Code ${statusCode}`);

      if (loggedOut) {
        logger.warn("Logged out by WhatsApp. Clearing Firestore session.");
        try {
          await clearFirebaseAuthState();
        } catch (e) {
          logger.error(`Failed to clear session: ${e.message}`);
        }
        if (shouldRun) {
          await sleep(2000);
          startWhatsApp();
        }
      } else if (shouldRun) {
        logger.info("Reconnecting in 3 seconds...");
        if (sock) {
          try {
            sock.ev.removeAllListeners();
          } catch (e) {}
        }
        await sleep(3000);
        startWhatsApp();
      }
    }
  });

  sock.ev.on("messages.upsert", async (event) => {
    try {
      await handleIncomingMessages(event);
    } catch (err) {
      logger.error(`Error handling message: ${err.message}`);
      logger.error(err.stack);
    }
  });

  return sock;
}

async function handleIncomingMessages(event) {
  logger.info(
    `messages.upsert received. type=${event.type}, count=${event.messages.length}`
  );
  if (event.type !== "notify") {
    logger.info(`Ignoring event of type "${event.type}"`);
    return;
  }

  for (const msg of event.messages) {
    if (!msg.message || msg.key.fromMe) {
      logger.info("Skipping: empty message or sent by me (fromMe).");
      continue;
    }

    const jid = msg.key.remoteJid;
    logger.info(`Message from JID: ${jid}`);

    if (!isPrivateChat(jid)) {
      logger.info(`Skipping: ${jid} is not a private chat.`);
      continue;
    }

    const text = extractText(msg);
    if (!text) {
      logger.info("Skipping: no text content (image/sticker/etc).");
      continue;
    }

    logger.info(`Processing text: "${text}"`);
    await processUserMessage(jid, text);
  }
}

function extractText(msg) {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ||
    (m.extendedTextMessage && m.extendedTextMessage.text) ||
    (m.imageMessage && m.imageMessage.caption) ||
    (m.videoMessage && m.videoMessage.caption) ||
    ""
  ).trim();
}

async function processUserMessage(jid, text) {
  const userId = jid;
  const phone = getPhoneFromJid(jid);

  const user = memory.getOrCreateUser(userId, phone);

  if (isOnCooldown(userId)) {
    logger.info(`Cooldown: ignoring fast message from ${phone}`);
    return;
  }

  if (isRateLimited(userId)) {
    logger.info(`Rate limited: ${phone}`);
    await sendText(
      jid,
      "You're sending messages a little too fast 😊 Please wait a moment."
    );
    return;
  }

  db.incrementMessageCount();
  db.addLog("message_in", `${phone}: ${text.slice(0, 80)}`);

  const lower = text.toLowerCase();

  const reactivationWords = ["mimu", "can you help", "talk with mimu", "help"];
  if (
    user.state === memory.STATES.REJECTED &&
    reactivationWords.some((w) => lower.includes(w))
  ) {
    memory.setState(userId, memory.STATES.ACTIVE);
  }

  const rejectionWords = [
    "stop",
    "no bot",
    "don't reply",
    "dont reply",
    "leave me",
    "i don't want",
    "i dont want",
  ];
  if (
    user.state !== memory.STATES.REJECTED &&
    rejectionWords.some((w) => lower.includes(w))
  ) {
    memory.setState(userId, memory.STATES.REJECTED);
    await sendText(
      jid,
      'No problem at all. I\'ll stay quiet now. If you ever need me, just type "Mimu" and I\'ll be right here. 🙂'
    );
    return;
  }

  if (user.state === memory.STATES.REJECTED) {
    memory.saveMessageForOwner(userId, text);
    memory.addToHistory(userId, "user", text);
    logger.info(`Stored silent message from rejected user ${phone}`);
    return;
  }

  const contactWords = [
    "contact",
    "number",
    "phone",
    "business card",
    "email",
    "reach",
    "call him",
  ];
  if (contactWords.some((w) => lower.includes(w))) {
    await sendContactCard(jid);
    memory.addToHistory(userId, "user", text);
    memory.setState(userId, memory.STATES.ACTIVE);
    return;
  }

  if (memory.shouldWelcome(userId)) {
    await sendWelcome(jid);
    memory.markWelcomed(userId);
    memory.setState(userId, memory.STATES.ACTIVE);
  }

  memory.setState(userId, memory.STATES.ACTIVE);

  await showTyping(jid);

  const history = memory.getHistory(userId);
  logger.info(`Asking AI for reply to ${phone}...`);
  const reply = await getAIReply(history, text);
  logger.info(`AI reply received (${reply.length} chars). Sending...`);

  memory.addToHistory(userId, "user", text);
  memory.addToHistory(userId, "assistant", reply);

  await sendText(jid, reply);
  db.addLog("message_out", `to ${phone}: ${reply.slice(0, 80)}`);
}

async function sendText(jid, text) {
  if (!sock || !isConnected) {
    logger.warn("Tried to send but WhatsApp is not connected.");
    return;
  }
  try {
    await sock.sendMessage(jid, { text });
    logger.info(`Sent message to ${getPhoneFromJid(jid)}`);
  } catch (err) {
    logger.error(`Failed to send text: ${err.message}`);
  }
}

async function showTyping(jid) {
  try {
    await sock.sendPresenceUpdate("composing", jid);
    await sleep(1500);
    await sock.sendPresenceUpdate("paused", jid);
  } catch (err) {}
}

async function sendWelcome(jid) {
  const welcomeText =
    "Hello 👋\n\n" +
    "I am Mimu, Priyangshu's AI Assistant.\n\n" +
    "Priyangshu is currently unavailable.\n\n" +
    "I would be happy to assist you.\n\n" +
    "If you want to talk to Priyangshu personally, please kindly wait for his response.\n\n" +
    "You can:\n" +
    "• Continue with Mimu\n" +
    "• Leave a message for Priyangshu\n" +
    "• Ask for Contact Information";

  const logoPath = path.join(ASSETS_FOLDER, "logo.png");
  try {
    if (fs.existsSync(logoPath)) {
      await sock.sendMessage(jid, {
        image: fs.readFileSync(logoPath),
        caption: welcomeText,
      });
      logger.info(`Sent welcome (with logo) to ${getPhoneFromJid(jid)}`);
    } else {
      await sendText(jid, welcomeText);
    }
  } catch (err) {
    logger.error(`Failed to send welcome: ${err.message}`);
    await sendText(jid, welcomeText);
  }
}

async function sendContactCard(jid) {
  const profile = require("./owner_profile.json");

  const caption =
    `📇 *${profile.fullName}*\n\n` +
    `Here are ${profile.fullName}'s contact details:\n\n` +
    `📞 Phone: ${profile.phone}\n` +
    `📞 Alt: ${profile.secondaryPhone}\n` +
    `✉️ Email: ${profile.email}\n\n` +
    `— Shared by Mimu, ${profile.fullName}'s AI Assistant`;

  const cardPath = path.join(ASSETS_FOLDER, "contact_card.jpg");
  try {
    if (fs.existsSync(cardPath)) {
      await sock.sendMessage(jid, {
        image: fs.readFileSync(cardPath),
        caption: caption,
      });
      logger.info(`Sent contact card to ${getPhoneFromJid(jid)}`);
    } else {
      await sendText(jid, caption);
    }
  } catch (err) {
    logger.error(`Failed to send contact card: ${err.message}`);
    await sendText(jid, caption);
  }
}

function getStatus() {
  return { connected: isConnected, running: shouldRun };
}

function isWhatsAppConnected() {
  return isConnected;
}

function getLastQR() {
  return lastQRBuffer;
}

// Stop ONLY the socket. Never deletes credentials or Firestore.
async function stopWhatsApp() {
  shouldRun = false;
  isConnected = false;
  isStarting = false;
  try {
    if (sock) {
      sock.ev.removeAllListeners();
      // IMPORTANT: do NOT call sock.logout() — that would end the
      // WhatsApp session and force a QR rescan. Just close the socket.
      sock.end(undefined);
    }
  } catch (err) {
    logger.error(`Error stopping WhatsApp: ${err.message}`);
  }
  sock = null;
  logger.info("WhatsApp socket stopped (session preserved).");
}

async function broadcast(message) {
  const users = db.getUsers();
  let sent = 0;
  for (const userId of Object.keys(users)) {
    await sendText(userId, message);
    sent += 1;
    await sleep(800);
  }
  return sent;
}

module.exports = {
  startWhatsApp,
  stopWhatsApp,
  getStatus,
  isWhatsAppConnected,
  getLastQR,
  setCallbacks,
  broadcast,
};
