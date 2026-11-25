export function nextReleaseTag(today: string, existing: Iterable<string>): string {
  const base = `v${today.replaceAll("-", ".")}`;
  let latest = 0;
  for (const tag of existing) {
    if (tag === base) latest = Math.max(latest, 1);
    else if (tag.startsWith(`${base}.`)) {
      const suffix = tag.slice(base.length + 1);
      if (/^[1-9]\d*$/u.test(suffix)) {
        const sequence = Number(suffix);
        if (!Number.isSafeInteger(sequence) || sequence === Number.MAX_SAFE_INTEGER) {
          throw new Error("Release tag suffix exceeds the supported range.");
        }
        latest = Math.max(latest, sequence);
      }
    }
  }
  return latest === 0 ? base : `${base}.${latest + 1}`;
}

type Step = () => void | Promise<void>;

export interface ReleaseOperations {
  printPlan: Step;
  verifyPromotion: Step;
  stopIdleDashboard: Step;
  publish: Step;
  syncStaging: Step;
  deploy: Step;
  restartDashboard: Step;
}

export async function runRelease(dryRun: boolean, ops: ReleaseOperations): Promise<void> {
  await ops.printPlan();
  await ops.verifyPromotion();
  if (dryRun) return;
  await ops.stopIdleDashboard();
  await ops.publish();
  await ops.syncStaging();
  await ops.deploy();
  await ops.restartDashboard();
}

export async function waitForIdleDashboard<T extends { targets: readonly unknown[] }>(
  read: () => Promise<T>,
  wait: () => Promise<void>,
  report: (message: string) => void,
): Promise<T> {
  let current = await read();
  if (current.targets.length === 0) return current;
  report("Waiting for active dashboard runs to finish. Finish or resolve them in Relay before releasing.");
  do {
    await wait();
    current = await read();
  } while (current.targets.length > 0);
  return current;
}
