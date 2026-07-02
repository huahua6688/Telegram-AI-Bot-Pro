import { BotDatabase } from '../../db.js';

export async function createDatabase(config) {
  const db = new BotDatabase(config.databaseFile, config.legacyDataFile);
  await db.init();
  return db;
}
