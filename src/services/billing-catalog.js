import { BILLING_CREDIT_TYPES } from '../db.js';

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeCredits(credits = {}) {
  return Object.fromEntries(
    BILLING_CREDIT_TYPES.map((type) => [type, nonNegativeInteger(credits?.[type], 0)])
  );
}

export function buildConfiguredFreeQuota(config = {}) {
  const freeQuota = normalizeCredits(config?.starsFreeQuota);
  if (config?.starsFreeQuota?.chat === undefined) {
    freeQuota.chat = nonNegativeInteger(config?.dailyQuota, 0);
  }
  return freeQuota;
}

export function getDefaultChatFreeQuota(config = {}) {
  return buildConfiguredFreeQuota(config).chat;
}

export function buildBillingCatalog(config = {}) {
  return {
    enabled: config.starsPaymentsEnabled !== false,
    videoEnabled: Boolean(config.enableVideo),
    freeQuota: buildConfiguredFreeQuota(config),
    products: (Array.isArray(config.starsProducts) ? config.starsProducts : []).map((product) => ({
      id: String(product?.id || ''),
      title: String(product?.title || ''),
      titleEn: String(product?.titleEn || product?.title || ''),
      description: String(product?.description || ''),
      descriptionEn: String(product?.descriptionEn || product?.description || ''),
      price: nonNegativeInteger(product?.price, 0),
      credits: normalizeCredits(product?.credits)
    }))
  };
}

export function resolveUserFreeQuota({ db, config, userId, creditType }) {
  const type = BILLING_CREDIT_TYPES.includes(creditType) ? creditType : 'chat';
  let dailyFreeQuota = buildConfiguredFreeQuota(config)[type];
  let unlimited = false;

  if (type === 'chat' && typeof db?.getUserDailyQuota === 'function') {
    const quota = db.getUserDailyQuota(userId, dailyFreeQuota) || {};
    dailyFreeQuota = nonNegativeInteger(quota.dailyQuota, dailyFreeQuota);
    unlimited = quota.dailyQuotaOverride === 0 || (
      quota.usesGlobalQuota !== false && Boolean(config?.starsFreeChatZeroMeansUnlimited)
    );
  }

  return { dailyFreeQuota, unlimited };
}

export function buildUserBillingSnapshot({ db, config, userId, isAdmin = false }) {
  const normalizedUserId = String(userId || '');
  const catalog = buildBillingCatalog(config);
  const stored = typeof db?.getUserCreditBalances === 'function'
    ? db.getUserCreditBalances(normalizedUserId)
    : typeof db?.getCreditBalances === 'function'
      ? db.getCreditBalances(normalizedUserId)
      : {};
  const balances = stored?.balances || stored || {};

  const credits = Object.fromEntries(BILLING_CREDIT_TYPES.map((type) => {
    const free = resolveUserFreeQuota({ db, config, userId: normalizedUserId, creditType: type });
    const daily = typeof db?.getDailyCreditUsage === 'function'
      ? db.getDailyCreditUsage(normalizedUserId, type)
      : null;
    const freeUsed = nonNegativeInteger(daily?.used ?? daily?.units ?? daily, 0);
    const purchased = nonNegativeInteger(balances?.[type]?.balance ?? balances?.[type], 0);
    const unlimited = Boolean(isAdmin || free.unlimited);

    return [type, {
      type,
      enabled: type !== 'video' || catalog.videoEnabled,
      unlimited,
      freeDaily: free.dailyFreeQuota,
      freeUsed,
      freeRemaining: unlimited ? null : Math.max(0, free.dailyFreeQuota - freeUsed),
      purchased
    }];
  }));

  return {
    admin: Boolean(isAdmin),
    catalog,
    credits
  };
}

export { BILLING_CREDIT_TYPES };
