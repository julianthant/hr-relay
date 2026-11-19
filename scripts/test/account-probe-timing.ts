import { writeSync } from "node:fs";
import { afterEach, beforeEach } from "vitest";

function mark(phase: string, name: string): void {
  writeSync(1, `[case ${phase}] ${Date.now()} pid=${process.pid} rssKiB=${Math.round(process.memoryUsage.rss() / 1024)} ${name}\n`);
}

beforeEach(({ task }) => { mark("start", task.name); });
afterEach(({ task }) => { mark("end", task.name); });
