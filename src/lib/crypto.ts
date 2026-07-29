import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto'
import { env } from '../config/env.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const KEY_LENGTH = 32
const HKDF_HASH = 'sha256'
const HKDF_SALT = Buffer.alloc(32, 0) // fixed zero salt — key versioning provides domain separation
const HKDF_INFO_PREFIX = 'kickvault-dek-v'

function deriveDEK(keyVersion: number): Buffer {
  const masterKey = Buffer.from(env.MASTER_ENCRYPTION_KEY, 'hex')
  const info = Buffer.from(HKDF_INFO_PREFIX + keyVersion, 'utf8')
  return Buffer.from(hkdfSync(HKDF_HASH, masterKey, HKDF_SALT, info, KEY_LENGTH))
}

export interface EncryptedData {
  encryptedValue: string // base64
  iv: string // base64
  authTag: string // base64
  keyVersion: number
}

export function encrypt(plaintext: string, keyVersion: number = 1): EncryptedData {
  const dek = deriveDEK(keyVersion)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, dek, iv, { authTagLength: TAG_LENGTH })
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    encryptedValue: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyVersion,
  }
}

export function decrypt(data: EncryptedData): string {
  const dek = deriveDEK(data.keyVersion)
  const iv = Buffer.from(data.iv, 'base64')
  const authTag = Buffer.from(data.authTag, 'base64')
  const encryptedBuffer = Buffer.from(data.encryptedValue, 'base64')
  const decipher = createDecipheriv(ALGORITHM, dek, iv, { authTagLength: TAG_LENGTH })
  decipher.setAuthTag(authTag) // MUST be set before update()
  return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]).toString('utf8')
}
