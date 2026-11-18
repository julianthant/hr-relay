import { appendFileSync } from "node:fs";
import { relative } from "node:path";
import type { Reporter, TestModule } from "vitest/node";

function recordFile(event: "start" | "finish", module: TestModule): void {
  const output = process.env.RELAY_CI_UNIT_FILE_LOG;
  if (!output) throw new Error("RELAY_CI_UNIT_FILE_LOG is required for the unit resource sampler");
  const path = relative(process.cwd(), module.moduleId);
  const line = `[ci-unit-file] ${new Date().toISOString()} ${event} ${JSON.stringify(path)}\n`;
  appendFileSync(output, line);
  process.stdout.write(line);
}

export default class CiUnitFilesReporter implements Reporter {
  onTestModuleQueued(module: TestModule): void {
    recordFile("start", module);
  }

  onTestModuleEnd(module: TestModule): void {
    recordFile("finish", module);
  }
}
