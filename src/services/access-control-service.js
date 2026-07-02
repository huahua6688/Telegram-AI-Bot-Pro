const ADMIN_ROLE_NAMES = new Set(['super_admin', 'admin']);

export class AccessControlService {
  constructor({ config, db, logger }) {
    this.config = config;
    this.db = db;
    this.logger = logger;
  }

  getUserRoleNames(userId) {
    if (!userId) return [];
    return this.db.listUserRoleNames(userId);
  }

  isAdmin(userId) {
    const id = String(userId || '');
    if (!id) return false;
    if (this.config.adminUserIds.has(id)) return true;
    const user = this.db.findUser(id);
    if (user?.isAdmin) return true;
    const roleNames = this.getUserRoleNames(id);
    return roleNames.some((name) => ADMIN_ROLE_NAMES.has(name));
  }

  canAccessBot({ userId, chatId }) {
    const resolvedUserId = String(userId || '');
    const resolvedChatId = String(chatId || '');
    const user = this.db.findUser(resolvedUserId);
    const roleNames = this.getUserRoleNames(resolvedUserId);

    const blockedByPolicy = this.db.matchPolicyRule({
      effect: 'block',
      userId: resolvedUserId,
      chatId: resolvedChatId,
      roleNames
    });
    if (this.config.blockedUserIds.has(resolvedUserId) || user?.isBlocked || blockedByPolicy) {
      return {
        allowed: false,
        code: 'ACCESS_BLOCKED',
        reason: 'Blocked by policy.'
      };
    }

    const allowedByPolicy = this.db.matchPolicyRule({
      effect: 'allow',
      userId: resolvedUserId,
      chatId: resolvedChatId,
      roleNames
    });

    if (this.config.allowedChatIds.size > 0 && !this.config.allowedChatIds.has(resolvedChatId)) {
      return {
        allowed: false,
        code: 'CHAT_NOT_ALLOWED',
        reason: 'Chat is not in allow list.'
      };
    }

    if (this.config.allowedUserIds.size > 0) {
      const allowed =
        this.config.allowedUserIds.has(resolvedUserId) ||
        Boolean(user?.isAllowed) ||
        this.isAdmin(resolvedUserId) ||
        allowedByPolicy;
      return {
        allowed,
        code: allowed ? 'OK' : 'USER_NOT_ALLOWED',
        reason: allowed ? 'Allowed.' : 'User is not in allow list.'
      };
    }

    if (user?.isAllowed || allowedByPolicy || this.isAdmin(resolvedUserId)) {
      return { allowed: true, code: 'OK', reason: 'Allowed by explicit policy or admin role.' };
    }

    return { allowed: true, code: 'OK', reason: 'Allowed by default.' };
  }

  hasPermission(userId, permission) {
    if (!permission) return true;
    const id = String(userId || '');
    if (this.isAdmin(id)) return true;
    const permissions = this.db.listUserPermissions(id);
    return permissions.includes(permission);
  }

  isFeatureEnabled(flagKey, context = {}) {
    return this.db.resolveFeatureFlag(flagKey, context);
  }
}

