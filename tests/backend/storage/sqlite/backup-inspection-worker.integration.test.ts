import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { it } from "vitest";
import { testProcessImport } from "../../../support/compiled-process.js";

it.each(["admission/admission.ts", "sqlite/backup-inspection.ts", "sqlite/backup-service.ts", "sqlite/backup-inspection-worker.ts"])(
  "loads in a fresh process when %s is the first storage module imported", async entry => {
    const url = new URL(`../../../../src/backend/storage/${entry}`, import.meta.url);
    const script = `await import(${JSON.stringify(url.href)}); console.log("loaded");`;
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", testProcessImport(), "--input-type=module", "-e", script],
      { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL" });
    assert.equal(stdout.trim(), "loaded");
  },
);
