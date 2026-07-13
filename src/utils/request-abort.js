export function createRequestAbort({ signal, timeoutMs, fallbackTimeoutMs = 120000 } = {}) {
  const configured = Number(fallbackTimeoutMs);
  const requested = Number(timeoutMs);
  const durationMs = Math.max(
    50,
    Math.floor(Number.isFinite(requested) && requested > 0
      ? Math.min(requested, Number.isFinite(configured) && configured > 0 ? configured : requested)
      : Number.isFinite(configured) && configured > 0 ? configured : 120000)
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), durationMs);

  return {
    signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    dispose() {
      clearTimeout(timer);
    }
  };
}
