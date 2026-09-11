// A provider cooldown affects generation, not browser reads, receipts or recovery.
export function availableDecision(
  decide,
  { cooldown, onDeferred = (_state: any) => {} },
) {
  const skipped = (state) => ({
    action: "skip",
    message: "",
    reason: "模型冷却；待恢复后重新生成",
    retryable: true,
    modelDeferredUntil: state?.until,
  });
  async function run(task, fallback) {
    const state = cooldown();
    if (state) {
      onDeferred(state);
      return fallback(state);
    }
    try {
      return await task();
    } catch (error) {
      if (error.code !== "MODEL_COOLDOWN") throw error;
      onDeferred(error);
      return fallback(error);
    }
  }
  const wrapped = (...args) => run(() => decide(...args), skipped);
  wrapped.batch = (items) =>
    run(
      () => decide.batch(items),
      (state) => items.map(() => skipped(state)),
    );
  return wrapped;
}
