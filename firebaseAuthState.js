// firebaseAuthState.js
// =============================================================
// A Firestore-backed auth state for Baileys, using the REST
// helpers in firebase.js (axios). Stores creds and signal keys
// in Firestore so the WhatsApp session survives ANY restart
// with no QR rescan.
//
// Firestore document layout:
//   sessions/whatsapp        -> field "creds"  (string)
//   sessions/whatsapp_keys/<docId> -> field "value" (string)
// =============================================================

const { initAuthCreds, BufferJSON } = require("@whiskeysockets/baileys");
const {
  getDocString,
  setDocString,
  deleteDoc,
  listDocIds,
} = require("./firebase");
const logger = require("./utils/logger");

const CREDS_DOC = "sessions/whatsapp";
const KEYS_COLLECTION = "sessions/whatsapp_keys";

// Convert values (including Buffers) to/from JSON-safe strings.
function encode(value) {
  return JSON.stringify(value, BufferJSON.replacer);
}
function decode(str) {
  return JSON.parse(str, BufferJSON.reviver);
}

// Make a Firestore-safe document id from a key type + id.
function safeId(type, id) {
  return `${type}-${id}`.replace(/[~*/[\]]/g, "_").replace(/\//g, "__");
}

async function useFirebaseAuthState() {
  // ---- Load creds (or create fresh) ----
  let creds;
  const storedCreds = await getDocString(CREDS_DOC, "creds");
  if (storedCreds) {
    creds = decode(storedCreds);
    logger.info("Loaded WhatsApp creds from Firestore.");
  } else {
    creds = initAuthCreds();
    logger.info("No creds in Firestore. Created fresh creds (QR needed).");
  }

  // ---- Read keys ----
  async function getKeys(type, ids) {
    const result = {};
    await Promise.all(
      ids.map(async (id) => {
        const docId = safeId(type, id);
        const stored = await getDocString(`${KEYS_COLLECTION}/${docId}`, "value");
        if (stored) {
          result[id] = decode(stored);
        }
      })
    );
    return result;
  }

  // ---- Write/delete keys ----
  async function setKeys(data) {
    const tasks = [];
    for (const type of Object.keys(data)) {
      for (const id of Object.keys(data[type])) {
        const value = data[type][id];
        const docId = safeId(type, id);
        const docPath = `${KEYS_COLLECTION}/${docId}`;
        if (value) {
          tasks.push(setDocString(docPath, "value", encode(value)));
        } else {
          tasks.push(deleteDoc(docPath));
        }
      }
    }
    await Promise.all(tasks);
  }

  // ---- Save creds ----
  async function saveCreds() {
    await setDocString(CREDS_DOC, "creds", encode(creds));
  }

  const state = {
    creds,
    keys: {
      get: async (type, ids) => getKeys(type, ids),
      set: async (data) => setKeys(data),
    },
  };

  return { state, saveCreds };
}

// Wipe the stored session entirely (only when WhatsApp logs us out).
async function clearFirebaseAuthState() {
  const keyIds = await listDocIds(KEYS_COLLECTION);
  await Promise.all(
    keyIds.map((id) => deleteDoc(`${KEYS_COLLECTION}/${id}`))
  );
  await deleteDoc(CREDS_DOC);
  logger.info("Cleared WhatsApp session from Firestore.");
}

module.exports = { useFirebaseAuthState, clearFirebaseAuthState };
