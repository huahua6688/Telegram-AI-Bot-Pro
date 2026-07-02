import { ToolRegistry } from '../../services/tool-registry.js';

export function createToolRegistry(config, logger) {
  return new ToolRegistry(config, logger);
}
