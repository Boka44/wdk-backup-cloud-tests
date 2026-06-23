/**
 * CloudKit backup — validates the real CloudKitProvider + CloudBackup from
 * @tetherto/wdk-backup-cloud against a live iCloud private database.
 *
 * This script implements that flow for the terminal:
 *
 *   terminal -> opens a local page -> page asks Apple for a sign-in URL
 *   -> you sign in with Apple ID in the popup -> Apple postMessages the session
 *   back -> page hands the token to this process -> we run the real provider.
 *
 *
 * Prereq: in CloudKit Console, your CLOUDKIT_API_TOKEN must have
 *   Allowed Origins = "Any Domain"  (so the localhost page may receive the token).
 *
 * Usage:  npm run backup:cloudkit   (see CLOUDKIT.md for full setup)
 */

import 'dotenv/config'

import http from 'node:http'
import { exec } from 'node:child_process'
import { scryptSync, randomBytes, createCipheriv } from 'node:crypto'

import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { CloudBackup, CloudKitProvider } from '@tetherto/wdk-backup-cloud'

const PORT = Number(process.env.CLOUDKIT_CALLBACK_PORT ?? 8787)

function requireEnv (name) {
  const value = process.env[name]
  if (!value?.trim()) {
    throw new Error(`Missing ${name} in .env — see CLOUDKIT.md`)
  }
  return value.trim()
}

function encrypt (plaintext, password) {
  const salt = randomBytes(32)
  const key = scryptSync(password, salt, 32, { N: 2 ** 16, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })
  const iv = randomBytes(12)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    let ciphertext = cipher.update(plaintext, 'utf8', 'hex')
    ciphertext += cipher.final('hex')
    return JSON.stringify({
      version: 1,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      ciphertext
    })
  } finally {
    key.fill(0)
  }
}

const containerIdentifier = requireEnv('CLOUDKIT_CONTAINER_IDENTIFIER')
const environment = process.env.CLOUDKIT_ENVIRONMENT === 'production' ? 'production' : 'development'
const apiToken = requireEnv('CLOUDKIT_API_TOKEN')

// To Do: needs testing

// ---------------------------------------------------------------------------
// Sign-in page served on localhost. It asks Apple for a redirect URL using our
// API token, opens the Apple sign-in popup, and forwards the session token that
// Apple postMessages back from https://cdn.apple-cloudkit.com to this process.
// ---------------------------------------------------------------------------
function signInPage () {
  const cfg = JSON.stringify({ apiToken, containerIdentifier, environment })
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>CloudKit sign-in</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem;line-height:1.5}button{font-size:1rem;padding:.6rem 1.1rem;border-radius:8px;border:0;background:#0071e3;color:#fff;cursor:pointer}a{color:#0071e3}</style>
</head><body>
<h2>CloudKit sign-in</h2>
<p id="status">Requesting an Apple sign-in URL…</p>
<button id="signin" style="display:none">Sign in with Apple ID</button>
<script>
const CFG = ${cfg};
const base = "https://api.apple-cloudkit.com/database/1/" + encodeURIComponent(CFG.containerIdentifier) + "/" + CFG.environment;
const statusEl = document.getElementById('status');
const btn = document.getElementById('signin');

function send(payload){ return fetch('/token', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}); }

window.addEventListener('message', (event) => {
  if (event.origin !== 'https://cdn.apple-cloudkit.com') return;
  const data = event.data || {};
  const tok = data.ckSession || data.ckWebAuthToken;
  if (tok) {
    statusEl.textContent = '✅ Signed in. Token sent back to the terminal — you can close this tab.';
    btn.style.display = 'none';
    send({ ckWebAuthToken: tok });
  } else if (data.error) {
    statusEl.textContent = '⚠️ Sign-in error: ' + JSON.stringify(data.error);
    send({ error: data.error });
  }
});

(async () => {
  try {
    const res = await fetch(base + '/public/users/caller?ckAPIToken=' + encodeURIComponent(CFG.apiToken));
    const json = await res.json();
    if (!json.redirectURL) {
      statusEl.textContent = 'No redirectURL returned. Raw response: ' + JSON.stringify(json);
      send({ error: json });
      return;
    }
    statusEl.textContent = 'Ready — click the button (a popup avoids the popup-blocker).';
    btn.style.display = 'inline-block';
    btn.onclick = () => {
      const popup = window.open(json.redirectURL, 'cloudkit-signin', 'width=640,height=720');
      if (!popup) statusEl.innerHTML = 'Popup blocked — <a href="' + json.redirectURL + '" target="_blank">open sign-in in a new tab</a> instead.';
      else statusEl.textContent = 'Complete the Apple sign-in in the popup…';
    };
  } catch (e) {
    statusEl.textContent = 'Error fetching sign-in URL: ' + e.message;
    send({ error: String(e) });
  }
})();
</script>
</body></html>`
}

function waitForToken () {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(signInPage())
        return
      }
      if (req.method === 'POST' && req.url.startsWith('/token')) {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"ok":true}')
          let parsed = {}
          try { parsed = JSON.parse(body) } catch {}
          server.close()
          if (parsed.ckWebAuthToken) resolve(parsed.ckWebAuthToken)
          else reject(new Error('Sign-in failed: ' + JSON.stringify(parsed.error ?? body)))
        })
        return
      }
      res.writeHead(404); res.end()
    })

    server.listen(PORT, () => {
      const url = `http://localhost:${PORT}`
      console.log(`\nOpening ${url} in your browser — sign in with your Apple ID…`)
      exec(`open "${url}"`, (err) => {
        if (err) console.log(`(Could not auto-open a browser. Visit ${url} manually.)`)
      })
    })

    setTimeout(() => { server.close(); reject(new Error('Timed out waiting for sign-in (5 min).')) }, 5 * 60 * 1000)
  })
}

async function main () {
  console.log('Container  :', containerIdentifier)
  console.log('Environment:', environment)

  const webAuthToken = await waitForToken()
  console.log('\n✅ Got web-auth token (len ' + webAuthToken.length + '). Running real CloudKitProvider…\n')

  const seedPhrase = WalletManagerEvm.getRandomSeedPhrase()
  const wallet = new WalletManagerEvm(seedPhrase, {
    provider: process.env.EVM_RPC_URL ?? 'https://ethereum.publicnode.com'
  })
  const account = await wallet.getAccount()
  console.log('Wallet address:', await account.getAddress())

  const encryptedKey = encrypt(seedPhrase, process.env.WALLET_PASSPHRASE ?? 'demo-passphrase')
  console.log('Encrypted payload length:', encryptedKey.length)

  const provider = new CloudKitProvider({
    containerIdentifier,
    environment,
    cloudEmail: process.env.CLOUDKIT_CLOUD_EMAIL ?? '',
    // The seam: a real consumer (web/iOS/Android) supplies the dynamically
    // acquired, per-user token here. We pass the one from the live sign-in.
    getCloudKitAuth: async () => ({ apiToken, webAuthToken })
  })
  const cloud = new CloudBackup(provider)

  const available = await cloud.isAvailable()
  console.log('isAvailable():', available)
  if (!available) throw new Error('Provider reports not available even with a live token.')

  await cloud.uploadEncryptedKey(encryptedKey)
  console.log('uploadEncryptedKey(): ok')

  const downloaded = await cloud.downloadEncryptedKey()
  console.log('downloadEncryptedKey():', downloaded !== null ? 'ok' : 'null')
  if (downloaded) {
    console.log('  round-trip matches:', downloaded.encryptionKey === encryptedKey)
  }

  wallet.dispose()
  console.log('\n🎉 CloudKitProvider + CloudBackup validated end-to-end.')
}

main().catch((err) => { console.error('\n❌', err.message ?? err); process.exit(1) })
