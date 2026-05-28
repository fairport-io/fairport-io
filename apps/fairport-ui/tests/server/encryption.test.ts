import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

const SECRET_KEY = 'test-secret-key';

function encryptProviderKey(plaintext: string, userId: string): string {
  if (!plaintext) return '';
  const key = crypto.scryptSync(SECRET_KEY, userId, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptProviderKey(encrypted: string, userId: string): string {
  if (!encrypted) return '';
  const key = crypto.scryptSync(SECRET_KEY, userId, 32);
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

describe('encryptProviderKey', () => {
  it('encrypts a non-empty key', () => {
    const encrypted = encryptProviderKey('sk-actual-key', 'user-123');
    expect(encrypted).not.toBe('sk-actual-key');
    expect(encrypted).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);
  });

  it('returns empty string for empty input', () => {
    expect(encryptProviderKey('', 'user-123')).toBe('');
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const e1 = encryptProviderKey('sk-same', 'user-123');
    const e2 = encryptProviderKey('sk-same', 'user-123');
    expect(e1).not.toBe(e2);
  });

  it('produces different ciphertext for different users', () => {
    const e1 = encryptProviderKey('sk-same', 'user-1');
    const e2 = encryptProviderKey('sk-same', 'user-2');
    expect(e1).not.toBe(e2);
  });
});

describe('decryptProviderKey', () => {
  it('decrypts to original plaintext', () => {
    const original = 'sk-test-api-key-12345';
    const encrypted = encryptProviderKey(original, 'user-123');
    const decrypted = decryptProviderKey(encrypted, 'user-123');
    expect(decrypted).toBe(original);
  });

  it('returns empty string for empty input', () => {
    expect(decryptProviderKey('', 'user-123')).toBe('');
  });

  it('fails to decrypt with wrong userId', () => {
    const original = 'sk-secret';
    const encrypted = encryptProviderKey(original, 'user-123');

    expect(() => decryptProviderKey(encrypted, 'user-456')).toThrow();
  });

  it('fails to decrypt with wrong SECRET_KEY', () => {
    const original = 'sk-secret';
    const key = crypto.scryptSync(SECRET_KEY, 'user-123', 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(original, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    const blob = `${iv.toString('hex')}:${authTag}:${encrypted}`;

    // Decrypt with different SECRET_KEY
    const wrongKey = crypto.scryptSync('wrong-secret', 'user-123', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', wrongKey, iv);
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    expect(() => {
      decipher.update(encrypted, 'hex', 'utf8');
      decipher.final('utf8');
    }).toThrow();
  });
});

describe('encrypt/decrypt roundtrip', () => {
  it('works for various key formats', () => {
    const keys = [
      'sk-1234567890abcdef',
      'ghp_abcdefghijklmnopqrstuvwxyz',
      'xoxb-123-456-789',
      '',
    ];

    for (const key of keys) {
      if (key === '') {
        expect(encryptProviderKey(key, 'user')).toBe('');
        expect(decryptProviderKey('', 'user')).toBe('');
        continue;
      }
      const encrypted = encryptProviderKey(key, 'user');
      const decrypted = decryptProviderKey(encrypted, 'user');
      expect(decrypted).toBe(key);
    }
  });
});
