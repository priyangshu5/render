// utils/rateLimiter.js
// =============================================================
// Protects the bot from spam and abuse.
// 1) Cooldown: a user must wait X seconds between messages.
// 2) Rate limit: a user can send at most N messages per minute.
// Everything is stored in memory (RAM), reset when bot restarts.
// =============================================================

const config = require("../config");

// Tracks the last time (timestamp in ms) each user sent a message.
const lastMessageTime = {};

// Tracks how many messages each user sent in the current minute window.
// Shape: { userId: { count: number, windowStart: timestamp } }
const messageCounts = {};

// Check the cooldown. Returns true if the user must wait (is spamming).
function isOnCooldown(userId) {
  const now = Date.now(); // current time in milliseconds
  const last = lastMessageTime[userId] || 0;
  const cooldownMs = config.USER_COOLDOWN_SECONDS * 1000;

  if (now - last < cooldownMs) {
    return true; // too soon since last message
  }

  // Not on cooldown — record this moment as their last message time.
  lastMessageTime[userId] = now;
  return false;
}

// Check the per-minute rate limit.
// Returns true if the user has gone OVER the allowed limit.
function isRateLimited(userId) {
  const now = Date.now();
  const oneMinute = 60 * 1000;

  // First message ever, or their minute window has expired → reset.
  if (
    !messageCounts[userId] ||
    now - messageCounts[userId].windowStart > oneMinute
  ) {
    messageCounts[userId] = { count: 1, windowStart: now };
    return false;
  }

  // Same minute window → increase their count.
  messageCounts[userId].count += 1;

  // Over the limit?
  return messageCounts[userId].count > config.MAX_MESSAGES_PER_MINUTE;
}

module.exports = {
  isOnCooldown,
  isRateLimited,
};
