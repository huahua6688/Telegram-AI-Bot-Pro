import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultPluginsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../plugins');

export class PluginManager {
  constructor({ config, logger, pluginsDir = defaultPluginsDir }) {
    this.config = config;
    this.logger = logger;
    this.pluginsDir = pluginsDir;
    this.plugins = [];
    this.commands = new Map();
    this.naturalActions = new Map();
  }

  async init() {
    let files = [];
    try {
      files = await fs.readdir(this.pluginsDir);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    for (const file of files.filter((item) => item.endsWith('-plugin.js')).sort()) {
      const moduleUrl = pathToFileURL(path.join(this.pluginsDir, file)).href;
      const imported = await import(moduleUrl);
      const plugin = typeof imported.default === 'function' ? await imported.default({ config: this.config, logger: this.logger }) : imported.default;
      if (plugin) {
        this.register(plugin);
      }
    }
  }

  register(plugin) {
    if (!plugin?.id) {
      throw new Error('Plugin requires an id.');
    }

    this.plugins.push(plugin);
    for (const command of plugin.commands || []) {
      if (!command?.name || typeof command.handler !== 'function') {
        throw new Error(`Plugin ${plugin.id} has an invalid command definition.`);
      }
      this.commands.set(command.name, { plugin, command });
      for (const actionType of command.naturalActionTypes || []) {
        this.naturalActions.set(actionType, { plugin, command });
      }
    }
  }

  getCommands() {
    return [...this.commands.values()].map(({ command }) => ({
      name: command.name,
      description: command.description || ''
    }));
  }

  hasCommand(name) {
    return this.commands.has(name);
  }

  async runCommand(name, context) {
    const entry = this.commands.get(name);
    if (!entry) return false;
    await entry.command.handler({ ...context, commandName: name });
    return true;
  }

  async runNaturalAction(action, context) {
    const entry = this.naturalActions.get(action?.type);
    if (!entry) return false;
    await entry.command.handler({ ...context, action });
    return true;
  }
}
