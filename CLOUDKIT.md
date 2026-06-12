# CloudKit credentials for local testing

The `backup:cloudkit` script needs **three** values in `.env`. Unlike Google Drive (one OAuth token), CloudKit splits **app** credentials (Dashboard) from **user** credentials (iCloud sign-in).

```env
CLOUDKIT_CONTAINER_IDENTIFIER=iCloud.com.example.wallet
CLOUDKIT_API_TOKEN=
CLOUDKIT_WEB_AUTH_TOKEN=
```

Optional:

```env
CLOUDKIT_ENVIRONMENT=development   # default if omitted
CLOUDKIT_CLOUD_EMAIL=              # stored in backup metadata only
```

```bash
cp .env.example .env
# fill in CloudKit values
npm run backup:cloudkit
```

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Paid Apple Developer Program** ($99/yr) | Needed to use [CloudKit Dashboard](https://icloud.developer.apple.com/) and create containers — unless TW shares their container/tokens |
| **Schema deployed** | Record type `WalletBackup` in **Development** (see below) |
| **iCloud account** | The user whose private database you are writing to |

**Easiest path for TW coworkers:** ask the iOS / platform team for `CONTAINER`, `API_TOKEN`, and a fresh `WEB_AUTH_TOKEN` (dev). You may not need your own Apple account.

---

## 1. `CLOUDKIT_CONTAINER_IDENTIFIER`

The CloudKit container ID tied to your app.

**If TW already has a wallet app:**

- Ask for the container string (format: `iCloud.com.<team>.<app>`).
- Use the same **environment** they use for testing (`development` vs `production`).

**If setting up yourself:**

1. [Apple Developer](https://developer.apple.com/account/) → **Certificates, Identifiers & Profiles** → **Identifiers**.
2. Create an **App ID** (or open an existing one) → enable **CloudKit**.
3. Open [CloudKit Dashboard](https://icloud.developer.apple.com/) → select the container (usually `iCloud.<bundle id>`).
4. Copy the container identifier into `.env`:

```env
CLOUDKIT_CONTAINER_IDENTIFIER=iCloud.com.yourteam.wallet
```

---

## 2. `CLOUDKIT_API_TOKEN`

Long-lived **app** token for CloudKit Web Services. Created in the Dashboard (not in `.env` on a user’s machine in production — only for dev spikes).

1. CloudKit Dashboard → your container.
2. **API Tokens** (left sidebar).
3. **+** → create a token for **Development** (match `CLOUDKIT_ENVIRONMENT`).
4. Copy the token immediately (shown once).

```env
CLOUDKIT_API_TOKEN=<paste token>
CLOUDKIT_ENVIRONMENT=development
```

Keep this secret like any API key. Do not commit `.env`.

---

## 3. Schema (one-time, in Dashboard)

Before upload works, deploy this record type to **Development**:

**Record type:** `WalletBackup`

| Field | Type |
|-------|------|
| `encryptionKey` | String |
| `savedAt` | String |
| `platform` | String |
| `version` | Int64 |
| `cloudEmail` | String |

CloudKit Dashboard → **Schema** → add fields → **Deploy to Development**.

(`@tetherto/wdk-backup-cloud` defaults: `recordType: WalletBackup`, `recordName: wallet_backup_key`.)

---

## 4. `CLOUDKIT_WEB_AUTH_TOKEN` (user session)

Required for the **private** database. Identifies **which iCloud user** owns the backup. **Expires** — refresh when the script fails auth.

The Node script does **not** perform Apple sign-in. You must obtain this token elsewhere and paste it into `.env`.

### Option A — TW / iOS team (recommended)

Someone with the wallet iOS app (or internal build):

1. Sign in with iCloud in the app (or dev tool that uses your container).
2. Export the current **web auth token** for Development.
3. Share securely with you (Slack DM, 1Password, etc.).

Ask specifically for: *CloudKit web auth token for Development, private database.*

### Option B — CloudKit JS in browser (dev spike)

If you have container + API token and Dashboard **Web** access configured:

1. CloudKit Dashboard → container → **Web** (or website configuration) → allow your test origin (e.g. `http://localhost:8787`).
2. Use any minimal CloudKit JS sign-in page (or TW’s dev harness) with your `containerIdentifier` + `apiToken`.
3. Sign in with **Sign in with Apple ID**.
4. Browser DevTools → **Application** → **Cookies** → `https://api.apple-cloudkit.com`.
5. Copy cookie **`ckWebAuthToken`** → `.env`:

```env
CLOUDKIT_WEB_AUTH_TOKEN=<cookie value>
```

### Option C — Skip Node; test on device

Run backup through the **real iOS app** once `CloudKitProvider` is integrated. That is the production path; the playground script is optional for backend/SDK checks.

---

## 5. Run the test

```bash
npm install
npm run backup:cloudkit
```

**Success looks like:**

```
Created wallet — address: 0x...
Encrypted seed payload length: ...
CloudKit available.
Uploaded backup to CloudKit.
Download verified: true
```

**Verify in Dashboard:** CloudKit Dashboard → **Data** → Private Database → Development → record type `WalletBackup` → record `wallet_backup_key`.

---

## Troubleshooting

| Error / symptom | Likely cause |
|-----------------|--------------|
| `Missing CLOUDKIT_* in .env` | Copy `.env.example` → `.env` and fill all three required vars |
| `CloudKit not available` | Wrong/expired `WEB_AUTH_TOKEN`, wrong `API_TOKEN`, or schema not deployed |
| `401` / auth errors | Refresh `CLOUDKIT_WEB_AUTH_TOKEN` |
| `RECORD_TYPE` / schema errors | Deploy `WalletBackup` + fields to **Development** |
| Wrong environment | `API_TOKEN` and `CLOUDKIT_ENVIRONMENT` must both be Development (or both Production) |
| No Apple Developer access | Use Google `npm run backup` instead, or get tokens from TW |

---

## Google vs CloudKit (this repo)

| | Google (`npm run backup`) | CloudKit (`npm run backup:cloudkit`) |
|---|---------------------------|--------------------------------------|
| Dev setup | Google Cloud OAuth Playground | Apple Dashboard + user web auth token |
| Tokens in `.env` | `GOOGLE_ACCESS_TOKEN` | `API_TOKEN` + `WEB_AUTH_TOKEN` + container |
| Works without iOS app | Yes | Only if you can get `WEB_AUTH_TOKEN` another way |

See [wdk-backup-cloud README](https://github.com/Boka44/wdk-backup-cloud/tree/main) for integrator API details.
