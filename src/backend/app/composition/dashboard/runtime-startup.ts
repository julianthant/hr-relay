import { RuntimeCustodyUncertainError } from "../storage-compose.js";
import { type DashboardComposeInput,type DashboardRuntime,type StartupCleanup,type StartupCustody } from "./runtime-contracts.js";


import { composeDashboardRuntimeStartup } from "./dashboard-wiring.js";

async function unwindDashboardStartup(
  cleanups: readonly StartupCleanup[],
  primary: unknown,
): Promise<never> {
  const failures: unknown[] = [];
  for (const cleanup of [...cleanups].reverse()) {
    try {
      await cleanup();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length === 0) throw primary;
  if (primary instanceof RuntimeCustodyUncertainError || failures.some(error => error instanceof RuntimeCustodyUncertainError)) throw new RuntimeCustodyUncertainError([primary, ...failures]);
  throw new AggregateError(
    [primary, ...failures],
    "dashboard startup failed and cleanup observed additional failures",
    { cause: primary },
  );
}

export async function composeDashboardRuntime(input: DashboardComposeInput): Promise<DashboardRuntime> {
  input.lifetimeLock.assertHeld();
  const startupCleanups: StartupCleanup[] = [];
  const custody: StartupCustody = { failedClosures: [], transportClosed: true };
  try {
    const runtime = await composeDashboardRuntimeStartup(input, startupCleanups, custody);
    startupCleanups.length = 0;
    return runtime;
  } catch (primary: unknown) {
    try { custody.revoke?.(); } catch (error) { custody.failedClosures.push(error); }
    return unwindDashboardStartup(startupCleanups, custody.failedClosures.length === 0 ? primary : new RuntimeCustodyUncertainError([primary, ...custody.failedClosures]));
  }
}
