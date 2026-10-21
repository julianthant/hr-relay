import assert from "node:assert/strict";
import { it } from "vitest";
import { createMockHubPreferencesPort } from "../../../../../src/dashboard/surfaces/settings/general/hub-preferences-model.js";

it("shares session-only mock preferences between controls and removes subscriptions", () => {
  const port = createMockHubPreferencesPort();
  let notices = 0;
  const unsubscribe = port.subscribe(() => { notices++; });
  port.change({ ...port.read(), width: "1920" });
  port.change({ ...port.read(), permission: "Ask before every action" });
  assert.deepEqual(port.read(), { permission: "Ask before every action", width: "1920", height: "1000" });
  assert.equal(port.source, "mock");
  assert.equal(notices, 2);
  unsubscribe(); port.change({ ...port.read(), height: "1080" });
  assert.equal(notices, 2);
  assert.equal(createMockHubPreferencesPort().read().width, "1440");
});
