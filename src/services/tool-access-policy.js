const NETWORK_TOOLS = new Set(['web_search', 'fetch_url']);

export class ToolAccessPolicy {
  constructor(config, logger, accessControl = null) {
    this.config = config;
    this.logger = logger;
    this.accessControl = accessControl;
    this.userHits = new Map();
  }

  trackUserRate(userId = '') {
    if (!userId) return true;
    const now = Date.now();
    const hits = (this.userHits.get(userId) || []).filter(
      (time) => now - time < this.config.toolUserWindowMs
    );
    if (hits.length >= this.config.toolUserMaxCalls) {
      this.userHits.set(userId, hits);
      return false;
    }
    hits.push(now);
    this.userHits.set(userId, hits);
    return true;
  }

  canUseNetworkTools(context = {}) {
    const scope = this.config.networkToolScope;
    if (scope === 'all') return true;
    if (scope === 'admin') return Boolean(context.isAdmin);
    if (scope === 'allowlist') {
      const userId = String(context.userId || '');
      const chatId = String(context.chatId || '');
      if (this.config.networkToolAllowedUserIds.has(userId)) return true;
      if (this.config.networkToolAllowedChatIds.has(chatId)) return true;
      return false;
    }
    return false;
  }

  authorize(toolName, context = {}) {
    const userId = String(context.userId || '');
    const chatId = String(context.chatId || '');

    if (this.accessControl) {
      const baseDecision = this.accessControl.canAccessBot({ userId, chatId });
      if (!baseDecision.allowed) {
        return {
          allowed: false,
          code: baseDecision.code || 'ACCESS_DENIED',
          message: baseDecision.reason || 'Access denied by policy.'
        };
      }
    }

    if (!this.config.enableToolCalls) {
      return { allowed: false, code: 'TOOL_CALLS_DISABLED', message: 'Tool calls are globally disabled.' };
    }

    if (this.config.toolAllowedNames.size > 0 && !this.config.toolAllowedNames.has(toolName)) {
      return { allowed: false, code: 'TOOL_NOT_WHITELISTED', message: `Tool ${toolName} is not in whitelist.` };
    }

    if (this.config.toolBlockedUserIds.has(userId)) {
      return { allowed: false, code: 'TOOL_USER_BLOCKED', message: `User ${userId} is blocked from tool calls.` };
    }

    if (this.config.toolAllowedUserIds.size > 0 && !this.config.toolAllowedUserIds.has(userId) && !context.isAdmin) {
      return { allowed: false, code: 'TOOL_USER_NOT_ALLOWED', message: `User ${userId} is not allowed to use tools.` };
    }

    if (this.config.toolAllowedChatIds.size > 0 && !this.config.toolAllowedChatIds.has(chatId) && !context.isAdmin) {
      return { allowed: false, code: 'TOOL_CHAT_NOT_ALLOWED', message: `Chat ${chatId} is not allowed to use tools.` };
    }

    if (this.config.toolAdminOnlyNames.has(toolName) && !context.isAdmin) {
      return { allowed: false, code: 'TOOL_ADMIN_ONLY', message: `Tool ${toolName} is admin-only.` };
    }

    if (NETWORK_TOOLS.has(toolName) && !this.canUseNetworkTools(context)) {
      return {
        allowed: false,
        code: 'NETWORK_TOOL_NOT_AUTHORIZED',
        message: `Network tool ${toolName} is not authorized for this user/chat.`
      };
    }

    if (!this.trackUserRate(userId)) {
      return {
        allowed: false,
        code: 'TOOL_RATE_LIMITED',
        message: 'Tool call rate limit exceeded for current user.'
      };
    }

    return { allowed: true };
  }

  audit(decision, toolName, context = {}) {
    const payload = {
      tool: toolName,
      userId: String(context.userId || ''),
      chatId: String(context.chatId || ''),
      isAdmin: Boolean(context.isAdmin),
      source: context.source || 'unknown',
      code: decision.code || 'OK'
    };
    if (decision.allowed) {
      this.logger.info('Tool policy allow', payload);
    } else {
      this.logger.warn('Tool policy deny', { ...payload, reason: decision.message });
      if (this.accessControl?.db?.logAudit) {
        this.accessControl.db.logAudit({
          actorId: String(context.userId || ''),
          actorType: 'telegram_user',
          action: 'tool.policy_deny',
          targetType: 'tool',
          targetId: String(toolName || ''),
          result: 'deny',
          details: { ...payload, reason: decision.message }
        });
      }
    }
  }
}
