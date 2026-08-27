import { BILLING_CREDIT_TYPES } from '../db.js';
import { getDefaultChatFreeQuota } from './billing-catalog.js';

function nonNegativeSafeInteger(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

function resolveAdminUserQuota(db, userId, defaultQuota) {
  const safeDefaultQuota = nonNegativeSafeInteger(defaultQuota);

  if (typeof db.getUserDailyQuota !== 'function') {
    return {
      dailyQuota: safeDefaultQuota,
      dailyQuotaOverride: null,
      usesGlobalQuota: true
    };
  }

  const resolved = db.getUserDailyQuota(userId, safeDefaultQuota) || {};
  const override = resolved.dailyQuotaOverride == null
    ? null
    : nonNegativeSafeInteger(resolved.dailyQuotaOverride);

  return {
    dailyQuota: nonNegativeSafeInteger(resolved.dailyQuota ?? override ?? safeDefaultQuota),
    dailyQuotaOverride: override,
    usesGlobalQuota: resolved.usesGlobalQuota !== false && override == null
  };
}

function readCreditBalances(db, userId) {
  const stored = typeof db.getUserCreditBalances === 'function'
    ? db.getUserCreditBalances(String(userId))
    : typeof db.getCreditBalances === 'function'
      ? db.getCreditBalances(String(userId))
      : {};
  const balances = stored?.balances || stored || {};

  return Object.fromEntries(BILLING_CREDIT_TYPES.map((creditType) => [
    creditType,
    nonNegativeSafeInteger(balances?.[creditType]?.balance ?? balances?.[creditType])
  ]));
}

export function serializeAdminUser(dbOrOptions, userArg, configArg = {}) {
  const optionsStyle = userArg == null
    && dbOrOptions
    && typeof dbOrOptions === 'object'
    && dbOrOptions.db
    && dbOrOptions.user;

  const db = optionsStyle ? dbOrOptions.db : dbOrOptions;
  const user = optionsStyle ? dbOrOptions.user : userArg;
  const config = optionsStyle ? (dbOrOptions.config || {}) : configArg;

  if (!db || !user) {
    throw new TypeError('serializeAdminUser requires db and user.');
  }

  const aiSettings = typeof db.getUserAISettings === 'function'
    ? db.getUserAISettings(user.id) || {}
    : {};
  const defaultQuota = getDefaultChatFreeQuota(config);
  const quota = resolveAdminUserQuota(db, user.id, defaultQuota);
  const creditBalances = readCreditBalances(db, user.id);
  const globalAISettings = typeof db.getGlobalAISettings === 'function' ? db.getGlobalAISettings() : {};
  const runtime = typeof db.getUserRuntimeSummary === 'function'
    ? db.getUserRuntimeSummary(user.id)
    : {
        messagesHandled: Number(user.totalMessages || 0),
        aiCalls: Number(user.aiCalls || 0),
        trackedProviderCalls: 0,
        providerCostUsd: 0,
        billedCredits: 0,
        totalTokens: 0,
        agentTasks: 0,
        activeAgentTasks: 0
      };
  const storedProviderId = String(aiSettings.providerId || '');
  const usesAutomaticModel = (!storedProviderId || storedProviderId === 'auto') && !aiSettings.modelId;
  const effectiveAIProvider = usesAutomaticModel
    ? globalAISettings.providerId || config.defaultAIProvider || config.aiProvider || 'auto'
    : storedProviderId;

  return {
    id: String(user.id),
    username: user.username || '',
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    isAdmin: Boolean(user.isAdmin),
    isBlocked: Boolean(user.isBlocked),
    isAllowed: Boolean(user.isAllowed),
    preferredLanguage: user.preferredLanguage || 'auto',
    persona: user.persona || 'default',
    dailyUsageDate: user.dailyUsageDate || '',
    dailyUsageCount: Number(user.dailyUsageCount || 0),
    dailyQuota: quota.dailyQuota,
    dailyQuotaOverride: quota.dailyQuotaOverride,
    usesGlobalQuota: quota.usesGlobalQuota,
    totalMessages: Number(user.totalMessages || 0),
    lastSeenAt: user.lastSeenAt || '',
    aiProvider: aiSettings.providerId || 'auto',
    aiModel: aiSettings.modelId || '',
    effectiveAIProvider,
    effectiveAIModel: aiSettings.modelId || globalAISettings.modelId || config.defaultModel || '',
    usesAutomaticModel,
    runtime,
    creditBalances
  };
}

export const adminUserSerializerInternals = {
  nonNegativeSafeInteger,
  resolveAdminUserQuota,
  readCreditBalances
};
