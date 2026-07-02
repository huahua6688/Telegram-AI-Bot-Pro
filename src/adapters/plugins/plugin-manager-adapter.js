import { PluginManager } from '../../services/plugin-manager.js';

export async function createPluginManager(config, logger) {
  const manager = new PluginManager({ config, logger });
  await manager.init();
  return manager;
}
