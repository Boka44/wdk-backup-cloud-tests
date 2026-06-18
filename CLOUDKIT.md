# CloudKit setup for local testing

`npm run backup:cloudkit` validates the real `CloudKitProvider` + `CloudBackup` against a
live iCloud **private** database. It needs **two** values in `.env` plus a one-time
Console setup.

```env
CLOUDKIT_CONTAINER_IDENTIFIER=iCloud.com.example.wallet
CLOUDKIT_API_TOKEN=
# optional: CLOUDKIT_ENVIRONMENT=development   (default if omitted)
# optional: CLOUDKIT_CLOUD_EMAIL=              (stored in metadata only)
# optional: CLOUDKIT_CALLBACK_PORT=8787        (local sign-in callback server)
```

```bash
npm install
cp .env.example .env
# fill CLOUDKIT_CONTAINER_IDENTIFIER + CLOUDKIT_API_TOKEN, then:
npm run backup:cloudkit
```

---

## Prerequisites

| Requirement                        | Notes                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apple Developer Program access** | Needed to use the [CloudKit Console](https://icloud.developer.apple.com/). On an org team you need the **"Access to Certificates, Identifiers & Profiles"** permission. |
| **A CloudKit container**           | e.g. `iCloud.io.tether.wallet.backuptest` (Identifiers → **iCloud Containers**)                                                                                         |
| **Schema deployed**                | Record type `WalletBackup` in **Development** (see below)                                                                                                               |
| **An iCloud account**              | You sign in with it at runtime; the backup goes to _its_ private DB                                                                                                     |

---

## 1. `CLOUDKIT_CONTAINER_IDENTIFIER`

Create or reuse a CloudKit container.

- **Reuse:** copy the identifier from the [CloudKit Console](https://icloud.developer.apple.com/)
  container picker (format `iCloud.com.<team>.<app>`). Match the **environment** used for testing.
- **Create your own:** [Apple Developer → Identifiers](https://developer.apple.com/account/resources/identifiers/list)
  → switch the top-right filter from **App IDs** to **iCloud Containers** → **➕** → identifier
  must start with `iCloud.` (e.g. `iCloud.io.tether.wallet.backuptest`). A fresh test container
  is fully isolated from any production container.

```env
CLOUDKIT_CONTAINER_IDENTIFIER=iCloud.io.tether.wallet.backuptest
```

## 2. Deploy the schema (one-time, in CloudKit Console)

CloudKit Console → your container → **Schema** → Record Types → add `WalletBackup`, then
**Deploy Schema Changes** to **Development**:

| Field           | Type   |
| --------------- | ------ |
| `encryptionKey` | String |
| `savedAt`       | String |
| `platform`      | String |
| `version`       | Int64  |
| `cloudEmail`    | String |

(`@tetherto/wdk-backup-cloud` defaults: `recordType: WalletBackup`, `recordName: wallet_backup_key`,
private database, `_defaultZone`.)

## 3. `CLOUDKIT_API_TOKEN` (+ Allowed Origins)

CloudKit Console → your container → **API Tokens** → **+** → create a token for **Development**
(match `CLOUDKIT_ENVIRONMENT`). Copy it immediately — it's shown once.

```env
CLOUDKIT_API_TOKEN=<paste token>
```

⚠️ **Required:** on that token, set **Allowed Origins → "Any Domain"**. The script's local
sign-in page (`http://localhost:8787`) must be allowed to receive the token Apple posts back.
Without this the sign-in popup completes but the token never returns.

> The API token is **app-level** and the same for every user — that's why it's safe in env.
> The per-user **web-auth token is _not_ in `.env`** — it's minted live in step 4.

## 4. Run — sign in live

```bash
npm run backup:cloudkit
```

1. A browser opens `http://localhost:8787`.
2. Click **Sign in with Apple ID** → authenticate (tick "keep me signed in" for a longer token).
3. Apple posts the session back; the script runs the real provider end-to-end.

**Success looks like:**

```
Wallet address: 0x...
Encrypted payload length: ...
✅ Got web-auth token (len ...). Running real CloudKitProvider…
isAvailable(): true
uploadEncryptedKey(): ok
downloadEncryptedKey(): ok
  round-trip matches: true
🎉 CloudKitProvider + CloudBackup validated end-to-end.
```

**Verify in Console:** **Data** → Private Database → Development → `WalletBackup` → `wallet_backup_key`.

## Troubleshooting

| Error / symptom                                               | Likely cause                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Sign-in popup completes but terminal hangs                    | API token **Allowed Origins** not set to "Any Domain"            |
| `No redirectURL returned`                                     | Wrong/typo'd `CLOUDKIT_API_TOKEN`, or wrong environment          |
| `400 bad_request … unexpected input at [line: 1, column: 33]` | The `force_update` bug — apply the patch above                   |
| `RECORD_TYPE` / schema errors                                 | Deploy `WalletBackup` + fields to **Development**                |
| `401` after a while                                           | Web-auth token expired (~30 min) — just re-run and sign in again |
| `isAvailable(): false`                                        | Wrong API token, wrong environment, or schema not deployed       |
| No Apple Developer access                                     | Use Google `npm run backup` instead, or ask a team Admin         |

---
