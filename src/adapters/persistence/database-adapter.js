import { BotDatabase } from '../../db.js';
import { installDatabaseContentEncryption } from '../../services/database-content-encryption.js';

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export async function createDatabase(config) {
  const db = new BotDatabase(config.databaseFile, config.legacyDataFile);
  await db.init();

  const encryption = installDatabaseContentEncryption(db, {
    secret: process.env.CHAT_ENCRYPTION_KEY || '',
    required: parseBoolean(process.env.CHAT_ENCRYPTION_REQUIRED, false)
  });

  if (encryption.enabled) {
    console.info('Chat content encryption enabled.', {
      version: encryption.version,
      migrated: encryption.migrated
    });
  } else {
    console.warn(
      'Chat content encryption is disabled. Set CHAT_ENCRYPTION_KEY and CHAT_ENCRYPTION_REQUIRED=true to enable it.'
    );
  }

  return db;
}
