/**
 * Next.js server startup hook.
 *
 * `register()` runs once per server instance, before any route handler. It is
 * the only place where log capture can be installed early enough to catch the
 * errors that happen during the first requests — which are exactly the ones
 * worth seeing, since misconfiguration surfaces on the first call to a
 * dependency, not the hundredth.
 *
 * The runtime check matters: `instrumentation.ts` is also evaluated for the
 * Edge runtime, where `console` patching and `process.uptime()` behave
 * differently and the buffer would be pointless anyway (no route in this
 * project runs on Edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { installLogCapture } = await import("@/lib/server/log-buffer");
  installLogCapture();
}
