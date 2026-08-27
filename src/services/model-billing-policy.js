function normalize(value = '') {
  return String(value || '').trim().toLowerCase();
}

function matches(value, patterns = []) {
  const target = normalize(value);
  return (patterns || []).some((pattern) => {
    const needle = normalize(pattern);
    return needle && (target === needle || target.includes(needle));
  });
}

export function classifyModelBilling({ providerId = '', model = '', catalogEntry = null, config = {} } = {}) {
  const normalizedProvider = normalize(providerId);
  const qualified = `${normalizedProvider}/${normalize(model)}`;
  // An operator can make an entire paid gateway ineligible for daily free
  // quota, regardless of the model name exposed by that gateway.
  if (matches(normalizedProvider, config.paidProviderPatterns)) return 'paid';
  if (matches(qualified, config.paidModelPatterns)) return 'paid';
  // Explicit catalog pricing overrides a broadly free provider. This keeps a
  // paid OpenRouter (or similar) model from becoming free by accident.
  if (catalogEntry?.pricingTier === 'paid') return 'paid';
  if (matches(qualified, config.freeModelPatterns)) return 'free';
  if (matches(normalizedProvider, config.freeProviderPatterns)) return 'free';
  if (catalogEntry?.pricingTier === 'free') return 'free';
  // Unknown pricing is never treated as free. This is the fail-closed rule
  // that prevents a newly discovered premium model from consuming free quota.
  return 'paid';
}

export function usdToCredits(usd, config = {}, creditType = 'chat') {
  const dollars = Number(usd);
  const configuredValues = config.billingUsdPerCredit || {};
  const dollarsPerCredit = Number(configuredValues[creditType] ?? config.billingUsdPerChatCredit);
  const markup = Math.max(1, Number(config.billingCostMarkup) || 1);
  if (!Number.isFinite(dollars) || dollars < 0 || !Number.isFinite(dollarsPerCredit) || dollarsPerCredit <= 0) {
    return null;
  }
  return Math.max(1, Math.ceil((dollars * markup) / dollarsPerCredit));
}

export function getPremiumReservationUnits(config = {}, creditType = 'chat', maximumUsd = config.billingMaxRequestUsd) {
  return usdToCredits(maximumUsd, config, creditType);
}

export function extractProviderCost(response, headers = null) {
  const headerValue = headers?.get?.('x-litellm-response-cost');
  const candidates = [
    headerValue,
    response?.usage?.cost,
    response?.usage?.total_cost,
    response?.cost
  ];
  const cost = candidates
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(Number)
    .find((value) => Number.isFinite(value) && value >= 0);
  const usage = response?.usage || {};
  return {
    costUsd: cost ?? null,
    promptTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0,
    completionTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0,
    totalTokens: Number(usage.total_tokens ?? 0) || 0,
    providerRequestId: String(response?.id || headers?.get?.('x-request-id') || '')
  };
}

export function appendBillingCall(calls = [], response, headers = null) {
  const call = extractProviderCost(response, headers);
  calls.push(call);
  return call;
}

export function summarizeBillingCalls(calls = []) {
  const knownCosts = calls.filter((call) => Number.isFinite(call.costUsd));
  return {
    calls: [...calls],
    costKnown: calls.length > 0 && knownCosts.length === calls.length,
    actualCostUsd: calls.length > 0 && knownCosts.length === calls.length
      ? knownCosts.reduce((sum, call) => sum + call.costUsd, 0)
      : null,
    promptTokens: calls.reduce((sum, call) => sum + Number(call.promptTokens || 0), 0),
    completionTokens: calls.reduce((sum, call) => sum + Number(call.completionTokens || 0), 0),
    totalTokens: calls.reduce((sum, call) => sum + Number(call.totalTokens || 0), 0)
  };
}
