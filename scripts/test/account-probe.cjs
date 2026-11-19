// Capture V8's running --heap-prof sample even if the test thread is stuck formatting an assertion.
const { isMainThread, Worker } = require("node:worker_threads");

if (isMainThread) {
  new Worker(__filename, { execArgv: [] }).unref();
} else {
  const { Session } = require("node:inspector/promises");
  const { writeFileSync, writeSync } = require("node:fs");
  const { join } = require("node:path");

  let collecting = false;
  setInterval(async () => {
    const rss = process.memoryUsage.rss();
    if (collecting || rss < 4 * 1024 ** 3) return;
    collecting = true;
    const session = new Session();
    session.connectToMainThread();
    const { profile } = await session.post("HeapProfiler.getSamplingProfile");
    writeFileSync(join(process.env.ACCOUNT_PROFILES, `threshold-${process.pid}.heapprofile`), JSON.stringify(profile));
    writeSync(2, `[allocation threshold] ${Date.now()} pid=${process.pid} rss=${rss} saved profile\n`);
    process.kill(process.pid, "SIGTERM");
  }, 500);
}
