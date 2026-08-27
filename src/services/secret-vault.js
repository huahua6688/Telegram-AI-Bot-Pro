import crypto from 'node:crypto';

const PREFIX = 'vault:v1:';

export class SecretVault {
  constructor(secret = '') {
    const value = String(secret || '');
    if (value.length < 32) throw new Error('Secret vault key must contain at least 32 characters.');
    this.key = crypto.createHash('sha256').update(value).digest();
  }

  encrypt(plaintext, aad = '') {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(String(aad)));
    const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return `${PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
  }

  decrypt(payload, aad = '') {
    const parts = String(payload || '').split(':');
    if (parts.length !== 5 || `${parts[0]}:${parts[1]}:` !== PREFIX) throw new Error('Invalid encrypted secret.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(parts[2], 'base64url'));
    decipher.setAAD(Buffer.from(String(aad)));
    decipher.setAuthTag(Buffer.from(parts[3], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64url')), decipher.final()]).toString('utf8');
  }
}
