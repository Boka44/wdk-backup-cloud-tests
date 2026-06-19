/**
 * Minimal spike: local @tetherto/wdk-wallet-evm + @tetherto/wdk-backup-cloud
 *
 * Usage:
 *   npm run backup
 *
 * With a real Google Drive token:
 *   GOOGLE_ACCESS_TOKEN=... npm run backup
 */

import 'dotenv/config'

import { scryptSync, randomBytes, createCipheriv } from 'node:crypto'

import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { CloudBackup, GoogleDriveProvider } from '@tetherto/wdk-backup-cloud'

// Same crypto as tools/wdk-cli/src/security/encryption.js
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

async function main () {
  const passphrase = process.env.WALLET_PASSPHRASE ?? 'demo-passphrase'
  const accessToken = process.env.GOOGLE_ACCESS_TOKEN

  // 1. Create EVM wallet
  const seedPhrase = WalletManagerEvm.getRandomSeedPhrase()
  const wallet = new WalletManagerEvm(seedPhrase, {
    provider: process.env.EVM_RPC_URL ?? 'https://ethereum.publicnode.com'
  })
  const account = await wallet.getAccount()
  const address = await account.getAddress()
  console.log('Created wallet — address:', address)

  // 2. Encrypt seed (app-layer; not part of wdk-backup-cloud)
  const encryptedKey = encrypt(seedPhrase, passphrase)
  console.log('Encrypted seed payload length:', encryptedKey.length)

  if (!accessToken) {
    console.log('No GOOGLE_ACCESS_TOKEN — skipping cloud upload.')
    console.log('Set GOOGLE_ACCESS_TOKEN to test GoogleDriveProvider.')
    wallet.dispose()
    return
  }

  // 3. Upload to Google Drive appDataFolder
  const cloud = new CloudBackup(new GoogleDriveProvider({ accessToken }))
  await cloud.uploadEncryptedKey(encryptedKey)
  console.log('Uploaded backup to Google Drive.')

  const downloaded = await cloud.downloadEncryptedKey()
  console.log('Download verified:', downloaded !== null)

  wallet.dispose()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
