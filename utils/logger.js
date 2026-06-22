// utils/logger.js
// =============================================================
// A simple logger built on Node's built-in "console".
// We do NOT use "pino" anymore — it caused "missing package"
// errors on hosting. console.log works everywhere with zero
// extra dependencies.
//
// We still create a "logs" folder so other parts of the app
// that expect it keep working.
// =============================================================

const fs = require("fs");
const path = require("path");

// Make sure the "logs" folder exists. If not, create it.
const logsDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Build a readable timestamp like "2026-06-14 21:05:33".
function now() {
  return new Date().toISOString().replace("T", " ").split(".")[0];
}

// Our logger mimics pino's main methods (info/warn/error/debug)
// so the rest of the code does not need to change.
const logger = {
  info(...args) {
    console.log(`[INFO]  ${now()} -`, ...args);
  },
  warn(...args) {
    console.warn(`[WARN]  ${now()} -`, ...args);
  },
  error(...args) {
    console.error(`[ERROR] ${now()} -`, ...args);
  },
  debug(...args) {
    // Quiet by default; uncomment the next line if you want debug logs.
    // console.log(`[DEBUG] ${now()} -`, ...args);
  },
};

module.exports = logger;
