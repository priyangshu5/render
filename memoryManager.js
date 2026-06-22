// memoryManager.js
// =============================================================
// Manages per-user memory and conversation state.
// "Memory" = the recent back-and-forth messages, so Mimu has
// context and can hold a real conversation.
// "State" = whether the user is actively chatting with Mimu,
// has rejected Mimu, or is brand new.
// =============================================================

const db = require("./database");
const config = require("./config");
const { timestamp } = require("./utils/helpers");

// Possible user states.
const STATES = {
  NEW: "new",          // never messaged before
  ACTIVE: "active",    // currently chatting with Mimu
  REJECTED: "rejected" // told Mimu to stop; messages stored silently
};

// Get a user, creating a fresh record if they don't exist yet.
function getOrCreateUser(userId, phone) {
  let user = db.getUser(userId);
  if (!user) {
    user = {
      id: userId,
      phone: phone,
      state: STATES.NEW,
      messageCount: 0,
      firstSeen: timestamp(),
      lastSeen: timestamp(),
      lastWelcome: 0,        // timestamp of last welcome message shown
      history: [],           // array of { role, content }
      savedMessages: [],     // messages left for Priyangshu
    };
    db.saveUser(userId, user);

    // Update the total user counter in stats.
    const stats = db.getStats();
    stats.totalUsers = (stats.totalUsers || 0) + 1;
    db.saveStats(stats);
  }
  return user;
}

// Add a message to the user's history.
// role is "user" (the human) or "assistant" (Mimu).
function addToHistory(userId, role, content) {
  const user = db.getUser(userId);
  if (!user) return;

  user.history.push({ role, content });

  // Keep only the most recent MEMORY_LIMIT messages for context.
  while (user.history.length > config.MEMORY_LIMIT) {
    user.history.shift();
  }

  user.lastSeen = timestamp();
  user.messageCount = (user.messageCount || 0) + 1;
  db.saveUser(userId, user);
}

// Return the conversation history for feeding into the AI.
function getHistory(userId) {
  const user = db.getUser(userId);
  return user ? user.history : [];
}

// Change a user's state (new/active/rejected).
function setState(userId, state) {
  const user = db.getUser(userId);
  if (!user) return;
  user.state = state;
  db.saveUser(userId, user);
}

// Record the time we last showed the welcome message.
function markWelcomed(userId) {
  const user = db.getUser(userId);
  if (!user) return;
  user.lastWelcome = Date.now();
  db.saveUser(userId, user);
}

// Decide whether we should show the welcome message again.
// Show it for brand-new users, or if enough time has passed.
function shouldWelcome(userId) {
  const user = db.getUser(userId);
  if (!user) return true;
  if (user.state === STATES.NEW) return true;

  const elapsedMinutes = (Date.now() - (user.lastWelcome || 0)) / 60000;
  return elapsedMinutes >= config.WELCOME_RESET_MINUTES;
}

// Silently store a message the user left for Priyangshu.
function saveMessageForOwner(userId, content) {
  const user = db.getUser(userId);
  if (!user) return;
  user.savedMessages.push({ time: timestamp(), content });
  db.saveUser(userId, user);
}

module.exports = {
  STATES,
  getOrCreateUser,
  addToHistory,
  getHistory,
  setState,
  markWelcomed,
  shouldWelcome,
  saveMessageForOwner,
};
