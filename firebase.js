// firebase.js
// =============================================================
// Talks to Firebase Firestore using the REST API and "axios".
// We do NOT use the heavy "firebase-admin" package (it failed to
// install on hosting). Instead we:
//   1. Read serviceAccountKey.json (your secret key file).
//   2. Build & sign a JWT using Node's built-in "crypto".
//   3. Exchange that JWT for a short-lived access token.
//   4. Use the token to call Firestore's REST API.
// Everything here uses only "axios" + built-in Node modules.
// =============================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const logger = require("./utils/logger");

let serviceAccount = null;
let projectId = null;
let cachedToken = null;
let tokenExpiry = 0;

// Load the service account key file once.
function loadServiceAccount() {
  if (serviceAccount) return serviceAccount;

  const keyPath = path.join(__dirname, "serviceAccountKey.json");
  if (!fs.existsSync(keyPath)) {
    throw new Error(
      "serviceAccountKey.json not found. Download it from Firebase Console > " +
        "Project Settings > Service Accounts > Generate new private key, and " +
        "place it in the project root."
    );
  }
  serviceAccount = require(keyPath);
  projectId = serviceAccount.project_id;
  return serviceAccount;
}

// Base64-url encode a string or buffer (JWT uses url-safe base64).
function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// Build and sign a JWT, then exchange it for an access token.
async function getAccessToken() {
  // Reuse the cached token if it is still valid (with 60s safety margin).
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  const sa = loadServiceAccount();
  const nowSec = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600, // valid for 1 hour
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claim)
  )}`;

  // Sign with the private key from the service account using RS256.
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64url(signer.sign(sa.private_key));

  const jwt = `${unsigned}.${signature}`;

  // Exchange the JWT for an OAuth2 access token.
  const res = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  cachedToken = res.data.access_token;
  tokenExpiry = Date.now() + res.data.expires_in * 1000;
  return cachedToken;
}

// Base URL for Firestore REST documents.
function docUrl(docPath) {
  return (
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/${docPath}`
  );
}

// ---- Firestore stores values as typed fields. We keep things
//      simple by storing everything as a single string field.
//      These helpers wrap/unwrap that string. ----

// Read a document. Returns the stored string, or null if missing.
async function getDocString(docPath, fieldName) {
  const token = await getAccessToken();
  try {
    const res = await axios.get(docUrl(docPath), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fields = res.data.fields || {};
    if (fields[fieldName] && typeof fields[fieldName].stringValue === "string") {
      return fields[fieldName].stringValue;
    }
    return null;
  } catch (err) {
    if (err.response && err.response.status === 404) return null; // not found
    throw err;
  }
}

// Write/overwrite a document with a single string field (+ updatedAt).
async function setDocString(docPath, fieldName, value) {
  const token = await getAccessToken();
  const body = {
    fields: {
      [fieldName]: { stringValue: value },
      updatedAt: { stringValue: new Date().toISOString() },
    },
  };
  await axios.patch(docUrl(docPath), body, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

// Delete a document.
async function deleteDoc(docPath) {
  const token = await getAccessToken();
  try {
    await axios.delete(docUrl(docPath), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (err.response && err.response.status === 404) return; // already gone
    throw err;
  }
}

// List all document names under a collection path.
async function listDocIds(collectionPath) {
  const token = await getAccessToken();
  try {
    const res = await axios.get(docUrl(collectionPath), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const docs = res.data.documents || [];
    // Each document "name" ends with its id after the last "/".
    return docs.map((d) => d.name.split("/").pop());
  } catch (err) {
    if (err.response && err.response.status === 404) return [];
    throw err;
  }
}

// Called at startup just to verify the key works.
function initFirebase() {
  loadServiceAccount();
  logger.info(`Firebase (REST) initialized for project: ${projectId}`);
}

module.exports = {
  initFirebase,
  getDocString,
  setDocString,
  deleteDoc,
  listDocIds,
};
