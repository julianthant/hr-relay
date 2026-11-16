import assert from "node:assert/strict";
import { it } from "vitest";
import { observeProcessIdentity } from "../../../../src/backend/storage/admission/process-identity.js";

it("keeps one live process identity stable when the caller timezone changes", () => {
  const priorTimezone = process.env["TZ"];
  try {
    process.env["TZ"] = "America/Los_Angeles";
    const first = observeProcessIdentity(process.pid);
    process.env["TZ"] = "Pacific/Honolulu";
    const second = observeProcessIdentity(process.pid);
    assert.equal(second.state, "alive");
    assert.deepEqual(second, first);
    if (process.platform === "darwin" && second.state === "alive") assert.match(second.identity.startToken, /^\d+$/u);
  } finally {
    if (priorTimezone === undefined) delete process.env["TZ"];
    else process.env["TZ"] = priorTimezone;
  }
});
