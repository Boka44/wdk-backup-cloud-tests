# wdk-backup-cloud test scripts

Minimal spike: create an EVM wallet, encrypt the seed, upload to **Google Drive** or **CloudKit** via [`@tetherto/wdk-backup-cloud`](https://github.com/Boka44/wdk-backup-cloud).

## Setup

```bash
npm install
cp .env.example .env
```

## Google Drive

**`.env`**

```env
GOOGLE_ACCESS_TOKEN=ya29....
```

Get a token with [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/):

1. Google Cloud project → enable **Drive API** → **OAuth client** (Web app).
2. Add redirect URI: `https://developers.google.com/oauthplayground`
3. Playground → scope: `https://www.googleapis.com/auth/drive.appdata`
4. Authorize → Exchange → copy **Access token** (starts with `ya29.` — not an API key).

**Run**

```bash
npm run backup
```

Creates a wallet, encrypts the seed, uploads to your Google account `appDataFolder`, downloads to verify.

## CloudKit

**`.env`** (all three required)

```env
CLOUDKIT_CONTAINER_IDENTIFIER=iCloud.com.example.wallet
CLOUDKIT_API_TOKEN=
CLOUDKIT_WEB_AUTH_TOKEN=
```

**Run**

```bash
npm run backup:cloudkit
```

CloudKit needs Apple Dashboard setup plus a per-user web auth token. See **[CLOUDKIT.md](./CLOUDKIT.md)** for how to get each value.

## Optional

```env
WALLET_PASSPHRASE=demo-passphrase
EVM_RPC_URL=https://ethereum.publicnode.com
```

## What the scripts do

1. Generate a BIP-39 seed and EVM address (`@tetherto/wdk-wallet-evm`)
2. Encrypt the seed (AES-256-GCM + scrypt, same idea as `wdk-cli`)
3. Upload via `CloudBackup` + `GoogleDriveProvider` or `CloudKitProvider`

This tests the backup SDK only — not a production wallet app.
