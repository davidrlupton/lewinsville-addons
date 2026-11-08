// Runs once when the Next.js server starts (Next 15+ instrumentation hook). The request-log copier and the ear
// watchdog used to start on the first page view, which meant an empty house had no watchdog (2026-11-08).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJarvisLog } = await import("@/lib/jarvis_log");
    startJarvisLog();
  }
}
