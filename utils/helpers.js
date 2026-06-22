// utils/helpers.js
// =============================================================
// A collection of small, reusable helper functions.
// Keeping them here avoids repeating the same code everywhere.
// =============================================================

// Pause execution for a given number of milliseconds.
// Used to create realistic "typing" delays.
// Example: await sleep(1500) waits 1.5 seconds.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Get the current date and time as a readable string.
// Example output: "2026-06-13 14:30:05"
function timestamp() {
  return new Date().toISOString().replace("T", " ").split(".")[0];
}

// WhatsApp gives us long IDs like "919395402973@s.whatsapp.net"
// or the newer "195391551209526@lid". This pulls out just the
// identifier part (before the @) for cleaner logs.
function getPhoneFromJid(jid) {
  if (!jid) return "unknown";
  return jid.split("@")[0];
}

// Decide if a WhatsApp chat ID is a PRIVATE chat (a single person).
// Groups end in "@g.us", status/broadcast use "status@broadcast",
// channels use "@newsletter". We only want one-to-one private chats.
// NOTE: WhatsApp now also uses "@lid" (Linked ID) for private chats,
// so we must allow it too — otherwise real messages get ignored.
function isPrivateChat(jid) {
  if (!jid) return false;
  if (jid.endsWith("@g.us")) return false;          // group
  if (jid === "status@broadcast") return false;      // status/stories
  if (jid.endsWith("@broadcast")) return false;      // broadcast list
  if (jid.endsWith("@newsletter")) return false;     // channel
  // Allow normal private chats AND the newer @lid private chats.
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}

// Export all helpers as one object.
module.exports = {
  sleep,
  timestamp,
  getPhoneFromJid,
  isPrivateChat,
};
