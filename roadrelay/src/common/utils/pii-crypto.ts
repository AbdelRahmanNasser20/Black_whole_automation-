import * as crypto from 'crypto';

/**
 * Symmetric envelope encryption + deterministic HMAC for PII fields
 * (currently phone numbers, but applies to anything that needs to be
 * looked-up *and* stored encrypted).
 *
 *  - Hash:    HMAC-SHA256(secret, value)  -> indexable, irreversible.
 *  - Cipher:  AES-256-GCM with random IV   -> stored alongside HMAC.
 *
 * In production, the AES key should come from KMS / Secrets Manager
 * via envelope encryption (data key per record). This module exposes
 * the same interface so the implementation can be swapped without
 * touching call sites.
 */
export class PiiCrypto {
  private readonly key: Buffer;
  private readonly hmacSecret: Buffer;

  constructor(
    base64Key: string,
    public readonly keyId: string,
    hmacSecret: string,
  ) {
    if (!base64Key) {
      throw new Error('PII_ENCRYPTION_KEY is not configured');
    }
    const buf = Buffer.from(base64Key, 'base64');
    if (buf.length !== 32) {
      throw new Error(`PII_ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}`);
    }
    this.key = buf;
    this.hmacSecret = Buffer.from(hmacSecret, 'utf8');
  }

  /** Deterministic HMAC for indexed lookups. NEVER use for confidentiality. */
  hash(plaintext: string): Buffer {
    return crypto.createHmac('sha256', this.hmacSecret).update(plaintext).digest();
  }

  /** AES-256-GCM. Output layout: [ 12-byte IV | ciphertext | 16-byte tag ]. */
  encrypt(plaintext: string): Buffer {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, enc, tag]);
  }

  decrypt(blob: Buffer): string {
    if (blob.length < 28) throw new Error('Ciphertext too short');
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(blob.length - 16);
    const enc = blob.subarray(12, blob.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}
