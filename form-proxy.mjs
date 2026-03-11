/**
 * form-proxy.mjs
 *
 * Standalone HTTP server (no npm deps) that:
 *  - Accepts POST /submit  { name, email, question }
 *  - Signs a JWT with the service account private key (Node.js crypto)
 *  - Exchanges it for a Google OAuth2 access token
 *  - Appends [timestamp, name, email, question] to the target Google Sheet
 *
 * Run: node form-proxy.mjs
 */

import { createServer } from 'node:http';
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = 3456;
const SHEET_ID = '13wdUR3-Hpm9Fx5RWQym2ZLxUMRalmbtFkzwyt8_Pw1s';
const SHEET_RANGE = 'Sheet1!A:D';          // adjust tab name if needed
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const SA_KEY_PATH =
  join(
    process.env.HOME || '/tmp',
    'Library/CloudStorage/Dropbox/Приложения/AI_Agents/DataBase/aishift-analytics-sa-key.json'
  );

// ---------------------------------------------------------------------------
// Load service account key
// ---------------------------------------------------------------------------

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(SA_KEY_PATH, 'utf8'));
} catch (err) {
  console.error('ERROR: cannot read service account key:', SA_KEY_PATH);
  console.error(err.message);
  process.exit(1);
}

const { client_email: SA_EMAIL, private_key: PRIVATE_KEY } = serviceAccount;

// ---------------------------------------------------------------------------
// JWT helpers (RS256, no dependencies)
// ---------------------------------------------------------------------------

function b64url(input) {
  const b64 = Buffer.isBuffer(input)
    ? input.toString('base64')
    : Buffer.from(JSON.stringify(input)).toString('base64');
  return b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeJWT() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: SA_EMAIL,
    scope: SCOPES,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${b64url(header)}.${b64url(payload)}`;

  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(PRIVATE_KEY, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${signingInput}.${signature}`;
}

// ---------------------------------------------------------------------------
// Token cache (reuse until 5 min before expiry)
// ---------------------------------------------------------------------------

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now() / 1000;
  if (cachedToken && now < tokenExpiresAt - 300) {
    return cachedToken;
  }

  const jwt = makeJWT();

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600);
  return cachedToken;
}

// ---------------------------------------------------------------------------
// Sheets append
// ---------------------------------------------------------------------------

async function appendRow(name, email, question) {
  const token = await getAccessToken();
  const timestamp = new Date().toISOString();

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [[timestamp, name, email, question]],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API error ${res.status}: ${text}`);
  }

  return await res.json();
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Only handle POST /submit
  if (req.method !== 'POST' || req.url !== '/submit') {
    res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw);

    const { name, email, question } = body;

    if (!name || !email || !question) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'name, email, question are required' }));
      return;
    }

    await appendRow(name, email, question);

    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));

    console.log(`[${new Date().toISOString()}] Appended: ${name} <${email}>`);
  } catch (err) {
    console.error('ERROR:', err.message);
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`form-proxy listening on http://localhost:${PORT}`);
  console.log(`Service account: ${SA_EMAIL}`);
  console.log(`Sheet ID: ${SHEET_ID}`);
});
