/**
 * CloudKit backup spike — same wallet + encrypt flow as Google, CloudKitProvider upload.
 *
 * Prereqs: CloudKit credentials in .env (see ../.env.example and CLOUDKIT.md)
 *
 * Usage:
 *   npm run backup:cloudkit
 */

import 'dotenv/config'

import { scryptSync, randomBytes, createCipheriv } from 'node:crypto'

import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { CloudBackup, CloudKitProvider } from '@tetherto/wdk-backup-cloud'

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

function requireEnv (name) {
  const value = process.env[name]
  if (!value?.trim()) {
    throw new Error(`Missing ${name} in .env — see CLOUDKIT.md`)
  }
  return value.trim()
}

async function main () {
  const containerIdentifier = requireEnv('CLOUDKIT_CONTAINER_IDENTIFIER')
  const environment = process.env.CLOUDKIT_ENVIRONMENT === 'production'
    ? 'production'
    : 'development'
  const apiToken = requireEnv('CLOUDKIT_API_TOKEN')
  const webAuthToken = requireEnv('CLOUDKIT_WEB_AUTH_TOKEN')
  const passphrase = process.env.WALLET_PASSPHRASE ?? 'demo-passphrase'

  const seedPhrase = WalletManagerEvm.getRandomSeedPhrase()
  const wallet = new WalletManagerEvm(seedPhrase, {
    provider: process.env.EVM_RPC_URL ?? 'https://ethereum.publicnode.com'
  })
  const account = await wallet.getAccount()
  console.log('Created wallet — address:', await account.getAddress())

  const encryptedKey = encrypt(seedPhrase, passphrase)
  console.log('Encrypted seed payload length:', encryptedKey.length)

  const provider = new CloudKitProvider({
    containerIdentifier,
    environment,
    cloudEmail: process.env.CLOUDKIT_CLOUD_EMAIL ?? '',
    getCloudKitAuth: async () => ({ apiToken, webAuthToken })
  })

  const cloud = new CloudBackup(provider)

  const available = await cloud.isAvailable()
  if (!available) {
    throw new Error(
      'CloudKit not available — check apiToken, webAuthToken (expires), and schema in Dashboard'
    )
  }
  console.log('CloudKit available.')

  await cloud.uploadEncryptedKey(encryptedKey)
  console.log('Uploaded backup to CloudKit.')

  const downloaded = await cloud.downloadEncryptedKey()
    console.log('Download verified:', downloaded !== null)
    if (downloaded) {
      console.log('Record savedAt:', downloaded.savedAt)
    }

  wallet.dispose()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
