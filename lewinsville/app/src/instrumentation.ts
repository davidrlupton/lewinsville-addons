// Runs once when the server starts. The camera watch (lib/watch.ts) listens to Home Assistant from here; only
// inside the add-on (or with WATCH=1 on a dev PC), so a laptop running the app does not review cameras too.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.SUPERVISOR_TOKEN && process.env.WATCH !== "1") return;
  const { startWatch } = await import("./lib/watch");
  startWatch();
}
