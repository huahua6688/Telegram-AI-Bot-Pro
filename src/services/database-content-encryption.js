import crypto from 'node:crypto';

const ENCRYPTION_PREFIX = 'enc:v1:';
const KEY_FINGERPRINT_META = 'chatEncryptionKeyFingerprint';
const KEY_SALT_META = 'chatEncryptionKeySalt';
const ENCRYPTION_VERSION_META = 'chatEncryptionVersion';
const ENCRYPTION_MIGRATED_AT_META = 'chatEncryptionMigratedAt';
const RAW_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

function now() {
  return new Date().toISOString();
}

function toBoolean(value) {
  return Boolean(value);
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTION_PREFIX);
}

function decodeBase64Key(value) {
  const raw = String(value || '').trim().replace(/^base64:/i, '');
  if (!raw) return null;

  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length !== RAW_KEY_BYTES) return null;

    // Reject strings that merely decode permissively but are not a canonical
    // representation of the same 32 bytes.
    const canonical = decoded.toString('base64').replace(/=+$/, '');
    const supplied = raw.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    return canonical === supplied ? decoded : null;
  } catch {
    return null;
  }
}

function deriveEncryptionKey(secret, saltBase64) {
  const directKey = decodeBase64Key(secret);
  if (directKey) return directKey;

  const passphrase = String(secret || '');
  if (passphrase.length < 32) {
    throw new Error('CHAT_ENCRYPTION_KEY must be a 32-byte Base64 key or a secret with at least 32 characters.');
  }

  const salt = Buffer.from(String(saltBase64 || ''), 'base64');
  if (salt.length < 16) {
    throw new Error('CHAT_ENCRYPTION_KEY salt is invalid.');
  }

  return crypto.scryptSync(passphrase, salt, RAW_KEY_BYTES, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
}

function fingerprintKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function encodePart(value) {
  return Buffer.from(value).toString('base64url');
}

function decodePart(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function encryptText(plaintext, key, aad) {
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: GCM_TAG_BYTES
  });
  cipher.setAAD(Buffer.from(String(aad || ''), 'utf8'));

  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext ?? ''), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX.slice(0, -1),
    encodePart(iv),
    encodePart(tag),
    encodePart(ciphertext)
  ].join(':');
}

function decryptText(payload, key, aad) {
  const value = String(payload || '');
  if (!isEncrypted(value)) return value;

  const parts = value.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('CHAT_ENCRYPTION_PAYLOAD_INVALID');
  }

  const iv = decodePart(parts[2]);
  const tag = decodePart(parts[3]);
  const ciphertext = decodePart(parts[4]);

  if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES) {
    throw new Error('CHAT_ENCRYPTION_PAYLOAD_INVALID');
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: GCM_TAG_BYTES
    });
    decipher.setAAD(Buffer.from(String(aad || ''), 'utf8'));
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    const wrapped = new Error('CHAT_ENCRYPTION_DECRYPT_FAILED');
    wrapped.cause = error;
    throw wrapped;
  }
}

function parseContentJson(rawValue, key, aad) {
  const plaintext = decryptText(rawValue, key, aad);
  try {
    return JSON.parse(plaintext);
  } catch {
    return '';
  }
}

function messageAad(messageVersionId) {
  return `message_versions:${String(messageVersionId)}:content_json`;
}

function conversationAad(sessionId) {
  return `conversations:${String(sessionId)}:messages_json`;
}

function assertCanDecryptExisting(database, key) {
  const message = database
    .prepare("SELECT id, content_json FROM message_versions WHERE content_json LIKE 'enc:v1:%' LIMIT 1")
    .get();
  if (message) {
    decryptText(message.content_json, key, messageAad(message.id));
    return;
  }

  const conversation = database
    .prepare("SELECT session_id, messages_json FROM conversations WHERE messages_json LIKE 'enc:v1:%' LIMIT 1")
    .get();
  if (conversation) {
    decryptText(conversation.messages_json, key, conversationAad(conversation.session_id));
  }
}

function migrateExistingContent(db, key) {
  const database = db.db;
  let encryptedMessages = 0;
  let encryptedConversations = 0;

  database.exec('BEGIN IMMEDIATE');
  try {
    const messageRows = database
      .prepare('SELECT id, content_json FROM message_versions')
      .all();
    const updateMessage = database.prepare(
      'UPDATE message_versions SET content_json = ? WHERE id = ?'
    );

    for (const row of messageRows) {
      if (isEncrypted(row.content_json)) continue;
      updateMessage.run(
        encryptText(String(row.content_json || '""'), key, messageAad(row.id)),
        String(row.id)
      );
      encryptedMessages += 1;
    }

    const conversationRows = database
      .prepare('SELECT session_id, messages_json FROM conversations')
      .all();
    const updateConversation = database.prepare(
      'UPDATE conversations SET messages_json = ? WHERE session_id = ?'
    );

    for (const row of conversationRows) {
      if (isEncrypted(row.messages_json)) continue;
      updateConversation.run(
        encryptText(String(row.messages_json || '[]'), key, conversationAad(row.session_id)),
        String(row.session_id)
      );
      encryptedConversations += 1;
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return { encryptedMessages, encryptedConversations };
}

function installEncryptedConversationMethods(db, key) {
  db.getConversationEntries = function getConversationEntries(
    sessionId,
    { limit = 0, offset = 0, order = 'asc' } = {}
  ) {
    this.ensureSessionFromId(String(sessionId));
    const sortOrder = order === 'desc' ? 'DESC' : 'ASC';
    const limitClause = limit > 0 ? 'LIMIT ? OFFSET ?' : '';
    const params = [String(sessionId)];
    if (limit > 0) {
      params.push(Number(limit), Number(offset || 0));
    }

    const rows = this.db
      .prepare(
        `SELECT
           m.id AS message_id,
           m.role,
           m.sequence,
           m.active_version,
           mv.id AS message_version_id,
           mv.content_json,
           mv.model,
           mv.created_at AS version_created_at,
           m.created_at,
           m.updated_at
         FROM messages m
         JOIN message_versions mv
           ON mv.message_id = m.id
          AND mv.version = m.active_version
         WHERE m.session_id = ?
         ORDER BY m.sequence ${sortOrder}
         ${limitClause}`
      )
      .all(...params);

    return rows.map((row) => ({
      messageId: row.message_id,
      messageVersionId: row.message_version_id,
      role: row.role,
      content: parseContentJson(
        row.content_json,
        key,
        messageAad(row.message_version_id)
      ),
      version: row.active_version,
      model: row.model || '',
      sequence: row.sequence,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      versionCreatedAt: row.version_created_at
    }));
  };

  db.getConversation = function getConversation(sessionId) {
    const entries = this.getConversationEntries(sessionId, { order: 'asc' });
    if (entries.length > 0) {
      return entries.map((entry) => ({ role: entry.role, content: entry.content }));
    }

    const row = this.db
      .prepare('SELECT messages_json FROM conversations WHERE session_id = ?')
      .get(String(sessionId));
    if (!row?.messages_json) return [];

    try {
      const plaintext = decryptText(
        row.messages_json,
        key,
        conversationAad(sessionId)
      );
      const parsed = JSON.parse(plaintext);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (String(error?.message || '').startsWith('CHAT_ENCRYPTION_')) throw error;
      return [];
    }
  };

  db.getMessageVersionHistory = function getMessageVersionHistory(messageId) {
    const rows = this.db
      .prepare(
        `SELECT id, message_id, version, content_json, model, is_current, created_at
         FROM message_versions
         WHERE message_id = ?
         ORDER BY version DESC`
      )
      .all(String(messageId));

    return rows.map((row) => ({
      id: row.id,
      messageId: row.message_id,
      version: row.version,
      content: parseContentJson(row.content_json, key, messageAad(row.id)),
      model: row.model || '',
      isCurrent: toBoolean(row.is_current),
      createdAt: row.created_at
    }));
  };

  db.getLatestAssistantMessageReference = function getLatestAssistantMessageReference(sessionId) {
    const row = this.db
      .prepare(
        `SELECT
           m.id AS message_id,
           m.active_version,
           mv.id AS message_version_id,
           mv.content_json,
           mv.model
         FROM messages m
         JOIN message_versions mv
           ON mv.message_id = m.id
          AND mv.version = m.active_version
         WHERE m.session_id = ? AND m.role = 'assistant'
         ORDER BY m.sequence DESC
         LIMIT 1`
      )
      .get(String(sessionId));

    if (!row) return null;
    return {
      messageId: row.message_id,
      messageVersionId: row.message_version_id,
      version: row.active_version,
      content: parseContentJson(
        row.content_json,
        key,
        messageAad(row.message_version_id)
      ),
      model: row.model || ''
    };
  };

  db.syncConversationMessages = function syncConversationMessages(
    sessionId,
    messages,
    { source = 'chat', createdAt = '', updatedAt = '', touchMeta = true } = {}
  ) {
    const safeMessages = Array.isArray(messages) ? messages : [];
    const timestamp = updatedAt || now();
    const createdTimestamp = createdAt || timestamp;
    this.ensureSessionFromId(String(sessionId), createdTimestamp, timestamp);

    const existingRows = this.db
      .prepare(
        `SELECT
           m.id,
           m.role,
           m.sequence,
           m.active_version,
           m.created_at,
           mv.id AS message_version_id,
           mv.content_json
         FROM messages m
         LEFT JOIN message_versions mv
           ON mv.message_id = m.id
          AND mv.version = m.active_version
         WHERE m.session_id = ?
         ORDER BY m.sequence ASC`
      )
      .all(String(sessionId));
    const existingBySequence = new Map(
      existingRows.map((row) => [Number(row.sequence), row])
    );

    this.db.exec('BEGIN');
    try {
      for (let index = 0; index < safeMessages.length; index += 1) {
        const sequence = index + 1;
        const item = safeMessages[index] || {};
        const role = String(item.role || 'user');
        const plaintextJson = JSON.stringify(item.content ?? '');
        const model = String(item.model || '');
        const existing = existingBySequence.get(sequence);

        if (!existing || existing.role !== role) {
          if (existing && existing.role !== role) {
            this.db.prepare('DELETE FROM messages WHERE id = ?').run(existing.id);
          }

          const messageId = `msg:${sessionId}:${sequence}`;
          const versionId = `${messageId}:v1`;
          const encryptedJson = encryptText(
            plaintextJson,
            key,
            messageAad(versionId)
          );

          this.db
            .prepare(
              `INSERT INTO messages(
                id, session_id, role, sequence, parent_message_id, active_version, status, source, created_at, updated_at
              ) VALUES (?, ?, ?, ?, NULL, 1, 'active', ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                role = excluded.role,
                sequence = excluded.sequence,
                source = excluded.source,
                updated_at = excluded.updated_at`
            )
            .run(
              messageId,
              String(sessionId),
              role,
              sequence,
              source,
              createdTimestamp,
              timestamp
            );

          this.db
            .prepare(
              `INSERT INTO message_versions(
                id, message_id, version, content_json, model, prompt_snapshot_json, context_snapshot_json, is_current, created_at
              ) VALUES (?, ?, 1, ?, ?, '', '', 1, ?)
              ON CONFLICT(message_id, version) DO UPDATE SET
                content_json = excluded.content_json,
                model = excluded.model,
                is_current = 1`
            )
            .run(versionId, messageId, encryptedJson, model, timestamp);

          this.db
            .prepare('UPDATE message_versions SET is_current = 0 WHERE message_id = ? AND id != ?')
            .run(messageId, versionId);
          continue;
        }

        let existingPlaintextJson = null;
        if (existing.message_version_id && existing.content_json != null) {
          existingPlaintextJson = decryptText(
            existing.content_json,
            key,
            messageAad(existing.message_version_id)
          );
        }

        if (!existing.message_version_id || existingPlaintextJson !== plaintextJson) {
          const nextVersion = Number(existing.active_version || 0) + 1;
          const versionId = `${existing.id}:v${nextVersion}`;
          const encryptedJson = encryptText(
            plaintextJson,
            key,
            messageAad(versionId)
          );

          this.db
            .prepare('UPDATE message_versions SET is_current = 0 WHERE message_id = ?')
            .run(existing.id);
          this.db
            .prepare(
              `INSERT INTO message_versions(
                id, message_id, version, content_json, model, prompt_snapshot_json, context_snapshot_json, is_current, created_at
              ) VALUES (?, ?, ?, ?, ?, '', '', 1, ?)
              ON CONFLICT(message_id, version) DO UPDATE SET
                content_json = excluded.content_json,
                model = excluded.model,
                is_current = 1`
            )
            .run(
              versionId,
              existing.id,
              nextVersion,
              encryptedJson,
              model,
              timestamp
            );

          this.db
            .prepare('UPDATE messages SET active_version = ?, updated_at = ? WHERE id = ?')
            .run(nextVersion, timestamp, existing.id);
        } else {
          this.db
            .prepare('UPDATE messages SET updated_at = ? WHERE id = ?')
            .run(timestamp, existing.id);
        }
      }

      if (existingRows.length > safeMessages.length) {
        this.db
          .prepare('DELETE FROM messages WHERE session_id = ? AND sequence > ?')
          .run(String(sessionId), safeMessages.length);
      }

      this.db
        .prepare('UPDATE sessions SET last_accessed_at = ?, updated_at = ? WHERE id = ?')
        .run(timestamp, timestamp, String(sessionId));

      const encryptedConversation = encryptText(
        JSON.stringify(safeMessages),
        key,
        conversationAad(sessionId)
      );
      this.db
        .prepare(
          `INSERT OR REPLACE INTO conversations(session_id, messages_json, created_at, updated_at)
           VALUES (?, ?, COALESCE((SELECT created_at FROM conversations WHERE session_id = ?), ?), ?)`
        )
        .run(
          String(sessionId),
          encryptedConversation,
          String(sessionId),
          createdTimestamp,
          timestamp
        );

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    if (touchMeta) {
      this.setMeta('updatedAt', now());
    }
  };

  db.setConversation = async function setConversation(sessionId, messages) {
    this.syncConversationMessages(sessionId, messages, {
      source: 'chat',
      touchMeta: true
    });
    await this.write();
  };
}

export function installDatabaseContentEncryption(
  db,
  { secret = '', required = false } = {}
) {
  const normalizedSecret = String(secret || '');

  if (!normalizedSecret) {
    if (required) {
      throw new Error(
        'CHAT_ENCRYPTION_REQUIRED is enabled but CHAT_ENCRYPTION_KEY is missing.'
      );
    }

    db.chatEncryption = {
      enabled: false,
      version: '',
      fingerprint: '',
      migrated: { encryptedMessages: 0, encryptedConversations: 0 }
    };
    return db.chatEncryption;
  }

  if (!db?.db || typeof db.getMeta !== 'function' || typeof db.setMeta !== 'function') {
    throw new Error('CHAT_ENCRYPTION_DATABASE_UNAVAILABLE');
  }

  let saltBase64 = db.getMeta(KEY_SALT_META);
  if (!saltBase64) {
    saltBase64 = crypto.randomBytes(16).toString('base64');
    db.setMeta(KEY_SALT_META, saltBase64);
  }

  const key = deriveEncryptionKey(normalizedSecret, saltBase64);
  const fingerprint = fingerprintKey(key);
  const storedFingerprint = db.getMeta(KEY_FINGERPRINT_META);

  if (storedFingerprint && storedFingerprint !== fingerprint) {
    throw new Error(
      'CHAT_ENCRYPTION_KEY_MISMATCH: the configured key does not match the key used for existing chat records.'
    );
  }

  if (!storedFingerprint) {
    assertCanDecryptExisting(db.db, key);
  }

  const migrated = migrateExistingContent(db, key);
  installEncryptedConversationMethods(db, key);

  db.setMeta(KEY_FINGERPRINT_META, fingerprint);
  db.setMeta(ENCRYPTION_VERSION_META, 'v1:aes-256-gcm');
  db.setMeta(ENCRYPTION_MIGRATED_AT_META, now());

  db.chatEncryption = {
    enabled: true,
    version: 'v1:aes-256-gcm',
    fingerprint: fingerprint.slice(0, 12),
    migrated
  };

  return db.chatEncryption;
}
