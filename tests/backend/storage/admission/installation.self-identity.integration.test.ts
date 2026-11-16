import assert from "node:assert/strict";
import { it } from "vitest";

it("invalidates a genuine profile child when its parent is released", async () => {
  const { createBoundProfileFixture } = await import("../../../support/helpers/admission-fixture.js");
  const profile = await createBoundProfileFixture();
  try {
    profile.admission.assertProfileRuntime();
    profile.machine.release();
    assert.throws(() => profile.admission.assertLive(), /released/u);
  } finally { await profile.close(); }
});
