# CloudKit backup — validation findings

Validation of `CloudKitProvider` + `CloudBackup` from
[`@tetherto/wdk-backup-cloud`](https://github.com/Boka44/wdk-backup-cloud) against a
**live iCloud private database**, run from `scripts/wallet-backup-cloudkit.js`.

**Result: validated end-to-end** — `isAvailable()` → `uploadEncryptedKey()` →
`downloadEncryptedKey()` round-trips correctly, **after** fixing one upstream bug
(see [Bug #1](#bug-1--operationtype-uses-snake_case-must-be-camelcase)).

---

## TL;DR

- ✅ The SDK design is sound. `CloudBackup` + `CloudKitProvider` work against a real
  private DB once you give them a valid, **dynamically acquired** web-auth token.
- 🐛 **One real bug** blocks every write: the record-save `operationType` is sent as
  `force_update` (snake_case); CloudKit requires `forceUpdate` (camelCase). **One-line fix.**
- ⚠️ The original spike approach (`CLOUDKIT_WEB_AUTH_TOKEN` in `.env`) is **structurally
  wrong** and can never work for a real integration — see [Why the static token fails](#why-a-static-web-auth-token-cannot-work).
- 🧭 Architecture: the REST provider is the **right cross-platform foundation** (iOS,
  Android, web, Node). Native CloudKit is an *optional* iOS-only UX upgrade, not a
  requirement. The `getCloudKitAuth` callback is the correct per-platform seam.

---

## How CloudKit web auth actually works

CloudKit Web Services need **two** credentials, and they are different in kind:

| Credential | Scope | Lifetime | Where it comes from |
|---|---|---|---|
| `ckAPIToken` | **App / container** — same for every user | Long-lived | Created once in CloudKit Console; safe to keep in app config / env |
| `ckWebAuthToken` | **Per-user** — identifies one iCloud user's private DB | ~30 min (2 weeks with "keep me signed in") | Minted by the user signing in **through that API token** |

The web-auth token is obtained via a sign-in flow ([Apple docs](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/SettingUpWebServices.html)):

1. Request `…/users/caller?ckAPIToken=<token>` → returns `AUTHENTICATION_REQUIRED` + a `redirectURL`.
2. Open `redirectURL` → Apple sign-in dialog.
3. After sign-in, Apple delivers the token back (via `postMessage` from
   `cdn.apple-cloudkit.com`, or a configured redirect URL).
4. All later requests send **both** `ckAPIToken` **and** `ckWebAuthToken`.

The provider writes to the **private** database (hardcoded `/private/` in the request
URL), so the data lives in the **user's own iCloud**, counts against **their** iCloud
quota, and **is not readable by Tether** — even in the CloudKit Console you cannot browse
another user's private DB. The wallet seed is additionally encrypted (scrypt + AES-256-GCM)
before upload, so it is ciphertext at rest as well.

### Why a static web-auth token cannot work

The first spike read `CLOUDKIT_WEB_AUTH_TOKEN` from `.env`. That fails for three reasons:

1. **Per-user** — the developer never possesses a user's token; only the signed-in user does.
2. **Expires** (~30 min) — a pasted value goes stale almost immediately.
3. **Bound to the sign-in's API token** — a token minted elsewhere is invalid for our
   API token. This is exactly why tokens from `xcrun cktool save-token --type user` and
   from the CloudKit Console's "act as iCloud account" both returned 401/failed: each was
   bound to *its own* API token (cktool's, or the Console's locked-to-`icloud.developer.apple.com`
   token), not ours.

The fix is to acquire the token **live** and hand it to the provider's `getCloudKitAuth`
callback. `scripts/wallet-backup-cloudkit.js` does this for the terminal: it serves a
localhost page that runs the sign-in flow and forwards the token back to the Node process.

> Prereq discovered while validating: your API token's **Allowed Origins** must be set to
> **"Any Domain"** for the localhost page to receive the `postMessage`. (Plain
> `http://localhost` works — HTTPS was not required.)

---

## Architecture: native vs. REST + callback

### The key correction

The **native CloudKit framework** (`CKContainer`/`CKDatabase`) is **iOS/macOS only**. But
**CloudKit Web Services (REST)** work on **any** platform — iOS, Android, web, Node —
because all you need is HTTP + a browser-based Apple sign-in to obtain `ckWebAuthToken`.
So the REST provider is genuinely universal, including **iCloud-on-Android** for users who
have an Apple ID.

Reference: [`capacitor-cloudkit`](https://github.com/nkalupahana/capacitor-cloudkit) implements
exactly this — one `authenticate() => { ckWebAuthToken }` interface with a per-platform
token adapter:

| Platform | How the token adapter gets `ckWebAuthToken` |
|---|---|
| **Web** | fetch `redirectURL` → `window.open` → `postMessage(ckSession)` from `cdn.apple-cloudkit.com` ([web.ts](https://github.com/nkalupahana/capacitor-cloudkit/blob/main/src/web.ts)) |
| **Android** | fetch `redirectURL` → WebView activity → parse `ckWebAuthToken=` from the redirect ([CloudKitPlugin.java](https://github.com/nkalupahana/capacitor-cloudkit/blob/main/android/src/main/java/cloudkit/baseline/getbaseline/app/CloudKitPlugin.java)) |
| **iOS** | URL-scheme redirect, or native `CKFetchWebAuthTokenOperation`, or go full-native |
| **Terminal** | loopback `localhost` server (this repo's script) |

### Tradeoffs

| | Native CloudKit (`CKContainer`) | REST + `getCloudKitAuth` callback (this provider) |
|---|---|---|
| Auth | Automatic from device iCloud — no tokens, no sign-in UI | Acquire `ckWebAuthToken` per-platform via sign-in |
| Token expiry | None (OS-managed) | 30 min / 2 weeks — must re-auth/refresh |
| Code reuse | iOS-only; reimplement CRUD natively | One JS codebase for iOS + Android + web |
| Offline/sync | First-class | None (raw REST) |
| Best for | Best *UX* on iOS | Cross-platform consistency |

### Recommendation

**Adopt the REST + callback provider as the foundation.** It is the only approach that
unifies iOS, Android, and web. For **React Native**, implement a small `getCloudKitAuth`
adapter that does the Apple sign-in with the appropriate redirect (iOS URL-scheme /
in-app browser; Android WebView, as `capacitor-cloudkit` does) and returns the token.
Native CloudKit on iOS remains a possible *later* UX optimization (no token expiry, no
sign-in popup) — but it is not required to ship, and it sacrifices the shared codebase.

On **Android**, iCloud backup is only for users who *have* an Apple ID; Google Drive (the
already-validated provider) remains the primary path for Android users.

---

## Bugs & improvements for `wdk-backup-cloud` (upstream)

### Bug #1 — `operationType` uses snake_case, must be camelCase

**Severity: blocking.** Every `uploadEncryptedKey()` fails with HTTP 400.

`saveRecord()` sends:

```js
operationType: "force_update",   // ❌ invalid
```

CloudKit returns:

```
400 bad_request — "badRequestException: unexpected input at [line: 1, column: 33]"
```

Per Apple's [Modifying Records reference](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/ModifyRecords.html),
valid `operationType` values are camelCase: `create`, `update`, **`forceUpdate`**,
`replace`, `forceReplace`, `delete`, `forceDelete`. (Column 33 of the serialized body lands
exactly on the `operationType` value.)

**Fix** (in `src`, which compiles to both `dist/index.js` and `dist/index.mjs`):

```diff
- operationType: "force_update",
+ operationType: "forceUpdate",
```

The `delete` path already uses a valid value (`"delete"`), so only the save is affected.
Verified locally: with this one change, upload + download + round-trip all succeed.

### Improvement #1 — `platform` is hardcoded to `"ios"`

`upload()` always writes `platform: "ios"` regardless of the real runtime, while
`download()` only ever maps to `"ios"`/`"android"`. For a cross-platform backup the source
platform should be passed in (e.g. via metadata) so a record written from web/Android isn't
mislabeled `ios`.

### Note (not a bug) — token rotation is fine

Apple's docs mention single-round-trip session tokens, which raised a concern that the
provider (which doesn't read the refreshed token back from responses) might fail on its
multi-request sequence (probe → save → verify). **Tested: it does not.** The 30-min
`ckWebAuthToken` is reusable across requests within its lifetime, so the provider's
re-use is correct in practice.

---

## How to reproduce

```bash
npm install
cp .env.example .env          # fill CLOUDKIT_CONTAINER_IDENTIFIER + CLOUDKIT_API_TOKEN
# In CloudKit Console: deploy the WalletBackup schema + set API token Allowed Origins = Any Domain
npm run backup:cloudkit       # opens a browser, sign in with Apple ID
```

Until Bug #1 is fixed upstream, the local `node_modules` copy must be patched
(`force_update` → `forceUpdate` in `dist/index.mjs`, which the ESM project loads, **and**
`dist/index.js`). See [CLOUDKIT.md](CLOUDKIT.md) for full setup.
