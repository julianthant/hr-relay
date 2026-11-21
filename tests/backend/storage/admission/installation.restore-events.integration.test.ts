import assert from "node:assert/strict";
import { it } from "vitest";
import { AUTHORITY_RESTORE_EVENTS } from "../../../../src/backend/storage/admission/installation.js";

it("refuses writes to authority restore events", () => {
  assert.throws(() => Object.assign(AUTHORITY_RESTORE_EVENTS, { 0: AUTHORITY_RESTORE_EVENTS[0] }), TypeError);
});
