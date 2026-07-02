import { ToolRegistry } from '../../services/tool-registry.js';

export function createToolRegistry(config, logger, accessControl) {
  return new ToolRegistry(config, logger, accessControl);
}
