// database.js
// =============================================================
// A simple JSON-file database.
// It reads and writes three files:
//   users.json  → info & message history per user
//   logs.json   → important events
//   stats.json  → counters (total messages, uptime start, etc.)
// We read the whole file, change it in memory, then write it back.
// =============================================================

const fs = require("fs");
const path = require("path");
const logger = require("./utils/logger");

// Build absolute file paths so it works from any folder.
const USERS_FILE = path.join(__dirname, "users.json");
const LOGS_FILE = path.join(__dirname, "logs.json");
const STATS_FILE = path.join(__dirname, "stats.json");

// ---------- Low-level read/write helpers ----------

// Read a JSON file. If it does not exist or is broken,
// return the provided fallback value instead of crashing.
function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    // If file is empty, return fallback.
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    logger.error(`Failed to read ${filePath}: ${err.message}`);
    return fallback;
  }
}

// Write a JavaScript object to a JSON file (nicely formatted).
function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    logger.error(`Failed to write ${filePath}: ${err.message}`);
  }
}

// ---------- Make sure files exist with sensible defaults ----------
function initDatabase() {
  if (!fs.existsSync(USERS_FILE)) writeJson(USERS_FILE, {});
  if (!fs.existsSync(LOGS_FILE)) writeJson(LOGS_FILE, []);
  if (!fs.existsSync(STATS_FILE)) {
    writeJson(STATS_FILE, {
      totalMessages: 0,
      totalUsers: 0,
      startTime: Date.now(),
    });
  }
  logger.info("JSON database initialized.");
}

// ---------- USERS ----------

// Get all users as one object: { userId: userData }.
function getUsers() {
  return readJson(USERS_FILE, {});
}

// Get a single user by ID, or null if not found.
function getUser(userId) {
  const users = getUsers();
  return users[userId] || null;
}

// Create or overwrite a single user's data.
function saveUser(userId, userData) {
  const users = getUsers();
  users[userId] = userData;
  writeJson(USERS_FILE, users);
}

// ---------- LOGS ----------

// Add a log entry (with timestamp) to logs.json.
function addLog(event, details) {
  const logs = readJson(LOGS_FILE, []);
  logs.push({
    time: new Date().toISOString(),
    event: event,
    details: details || "",
  });
  // Keep only the most recent 500 logs so the file never grows huge.
  while (logs.length > 500) logs.shift();
  writeJson(LOGS_FILE, logs);
}

// Get the most recent N logs (default 20).
function getRecentLogs(count = 20) {
  const logs = readJson(LOGS_FILE, []);
  return logs.slice(-count);
}

// ---------- STATS ----------

function getStats() {
  return readJson(STATS_FILE, {
    totalMessages: 0,
    totalUsers: 0,
    startTime: Date.now(),
  });
}

function saveStats(stats) {
  writeJson(STATS_FILE, stats);
}

// Increase the total message counter by 1.
function incrementMessageCount() {
  const stats = getStats();
  stats.totalMessages = (stats.totalMessages || 0) + 1;
  saveStats(stats);
}

// Export everything other files might need.
module.exports = {
  initDatabase,
  getUsers,
  getUser,
  saveUser,
  addLog,
  getRecentLogs,
  getStats,
  saveStats,
  incrementMessageCount,
};
