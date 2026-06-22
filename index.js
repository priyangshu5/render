// index.js
// =============================================================
// Main entry point. Starts Firebase, the JSON database, the
// Telegram control bot, and the WhatsApp bot (with persistent
// Firestore-backed sessions).
// =============================================================

const logger = require("./utils/logger");
const db = require("./database");
const { initFirebase } = require("./firebase");
const { startTelegram, sendToOwner } = require("./telegramBot");
const { startWhatsApp } = require("./whatsappBot");

async function main() {
  logger.info("======================================");
  logger.info("   Starting Mimu - AI Assistant 🤖");
  logger.info("======================================");

  // 1. Initialize Firebase Firestore (for persistent sessions).
  initFirebase();

  // 2. Make sure local JSON files exist (users/logs/stats).
  db.initDatabase();

  // 3. Start the Telegram control panel.
  startTelegram();

  // 4. Start WhatsApp (loads session from Firestore — no QR if valid).
  await startWhatsApp();

  sendToOwner("🤖 Mimu started. Session loaded from Firestore (if available).");
  logger.info("Mimu is up and running.");
}

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  db.addLog("crash", `uncaughtException: ${err.message}`);
});

process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled promise rejection: ${reason}`);
  db.addLog("crash", `unhandledRejection: ${reason}`);
});

main().catch((err) => {
  logger.error(`Fatal startup error: ${err.message}`);
});
