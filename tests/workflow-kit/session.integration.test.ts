import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createDeterministicSessionProvider } from "../../src/workflow-kit/session.js";

describe("task, store, session, provider, and artifact seams", () => {

  it("records deterministic session calls without manufacturing fallback results", async () => {
    const harness = createDeterministicSessionProvider(
      "onbase",
      ["already-authenticated", "logged-in"],
      { exclusive: true },
    );
    assert.equal(await harness.provider.login(undefined, { instance: "test" }), "already-authenticated");
    assert.equal(await harness.provider.login(undefined, {}), "logged-in");
    assert.equal(harness.calls().length, 2);
    await assert.rejects(harness.provider.login(undefined, {}), /no queued login result/);
  })
});
