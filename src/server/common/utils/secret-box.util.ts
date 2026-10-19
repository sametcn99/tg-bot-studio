/**
 * AES-256-GCM secret box for payloads that must never live in the database
 * or API responses in plaintext (MTProto session strings). The key is
 * derived from the studio's JWT secret so no extra secret has to be
 * managed, and tampering/wrong-key decryption fails loudly.
 * @module common/utils/secret-box
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Seal format version marker. */
const SEALED_PREFIX = 'v1';

/**
 * Derives the 256-bit box key from the studio secret material.
 * @param {string} keyMaterial - Secret (JWT secret) to derive from.
 * @returns {Buffer} Raw AES-256 key.
 */
function deriveKey(keyMaterial: string): Buffer {
  return createHash('sha256').update(`${keyMaterial}:secret-box`).digest();
}

/**
 * Seals a plaintext secret into a self-contained `v1:<iv>:<tag>:<ct>`
 * base64 envelope.
 *
 * @param {string} plain - Secret plaintext.
 * @param {string} keyMaterial - Key derivation secret.
 * @returns {string} Sealed envelope.
 */
export function sealSecret(plain: string, keyMaterial: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(keyMaterial), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SEALED_PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Opens a {@link sealSecret} envelope.
 *
 * @param {string} sealed - Sealed envelope.
 * @param {string} keyMaterial - Key derivation secret used to seal.
 * @returns {string} Original plaintext.
 * @throws {Error} When the envelope is malformed, tampered with, or was
 * sealed with different key material.
 */
export function openSecret(sealed: string, keyMaterial: string): string {
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== SEALED_PREFIX) {
    throw new Error('Malformed sealed secret');
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(keyMaterial),
      Buffer.from(parts[1], 'base64'),
    );
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Sealed secret could not be opened (wrong key or tampered data)');
  }
}
