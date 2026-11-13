import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// An older build left its process record in the fixed lock root; startup and maintenance refuse while it remains.
export function plantOldBuildArtifact(processLockRoot: string, name = "server"): void {
  mkdirSync(processLockRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(processLockRoot, `${name}.lock.json`), "{}", { mode: 0o600, flag: "wx" });
}
