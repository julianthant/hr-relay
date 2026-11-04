import assert from "node:assert/strict";
import fs from "node:fs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { createPreflightProfileFixtureSet } from "./profile-fixture.js";
import { runtimeFixture } from "./runtime-fixture.js";

it("restores pristine private files and revokes the preceding case admission", async () => {
  const profiles = await createPreflightProfileFixtureSet();
  const first = await runtimeFixture(["dashboard.serve"], profiles.create);
  const before = readFileSync(first.databasePath), marker = join(first.stateRoot, "case-only");
  let second: Awaited<ReturnType<typeof runtimeFixture>> | undefined;
  let firstOpen = true;
  try {
    writeFileSync(first.databasePath, "first-case-corruption");
    writeFileSync(marker, "first-case-only");
    firstOpen = false; await first.close();
    second = await runtimeFixture(["dashboard.serve"], profiles.create);
    assert.notEqual(second.admission, first.admission);
    assert.throws(() => first.admission.assertLive(), /released/u);
    assert.deepEqual(readFileSync(second.databasePath), before);
    assert.equal(existsSync(marker), false);
    second.admission.assertLive();
    assert.equal((await second.report()).results.every(result => result.status === "pass" || result.status === "warning"), true);
  } finally { if (firstOpen) await first.close(); await second?.close(); await profiles.close(); }
  assert.equal(existsSync(first.root), false);
});

it("refuses overlapping cases and cleanup while a case still owns its admission", async () => {
  const profiles = await createPreflightProfileFixtureSet();
  const first = await profiles.create();
  try {
    await assert.rejects(profiles.create(), /case-still-held/u);
    await assert.rejects(profiles.close(), /case-still-held/u);
    first.admission.assertLive();
  } finally { await first.close(); await profiles.close(); }
  assert.throws(() => first.admission.assertLive(), /released/u);
  assert.equal(existsSync(first.workspace), false);
});

it("propagates a failed template copy without publishing or retaining a case", async () => {
  const profiles = await createPreflightProfileFixtureSet();
  const write = vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => { throw new Error("fixture-copy-refused"); });
  syncBuiltinESMExports();
  try { await assert.rejects(profiles.create(), /fixture-copy-refused/u); }
  finally { write.mockRestore(); syncBuiltinESMExports(); }
  const next = await profiles.create();
  try { next.admission.assertLive(); }
  finally { await next.close(); await profiles.close(); }
  assert.equal(existsSync(next.workspace), false);
});
