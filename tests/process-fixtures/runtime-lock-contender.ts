import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  acquireRuntimeProcessLock,
  observeRuntimeLockSnapshot,
} from "../../src/infra/sqlite/runtime-process-locks.js";

const [root, readyDirectory, startPath, releasePath, contenderId] = process.argv.slice(2);
if (root === undefined
  || readyDirectory === undefined
  || startPath === undefined
  || releasePath === undefined
  || contenderId === undefined) {
  throw new Error("runtime-lock contender requires root, ready directory, start, release, and id");
}

writeFileSync(join(readyDirectory, `${contenderId}.ready`), `${String(process.pid)}\n`, { flag: "wx" });
process.stdout.write(`READY ${contenderId}\n`);

const startPoll = setInterval(() => {
  if (!existsSync(startPath)) return;
  clearInterval(startPoll);
  try {
    const handle = acquireRuntimeProcessLock({
      processLockRoot: root,
      name: "server",
      pid: process.pid,
    });
    process.stdout.write(`ADMITTED ${contenderId} ${String(process.pid)} ${String(handle.generation)}\n`);
    const snapshot = observeRuntimeLockSnapshot({
      processLockRoot: root,
      sourceDatabaseIdentity: "a".repeat(64),
    });
    process.stdout.write(`SNAPSHOT ${snapshot.processLocks.server.state}\n`);
    const releasePoll = setInterval(() => {
      if (!existsSync(releasePath)) return;
      clearInterval(releasePoll);
      handle.release();
    }, 5);
  } catch (error) {
    process.stdout.write(`REFUSED ${contenderId} ${error instanceof Error ? error.message : String(error)}\n`);
  }
}, 5);
