import assert from "node:assert/strict";
import { it } from "vitest";
import { DECISION_CATALOG, IDENTITY_REVIEW_TEXT, PARKED_WRITE_RECORDS } from "../../../../src/backend/runs/decisions/decision-catalog.js";

it("refuses writes to a parked-write identifier declaration", () => {
  const id = PARKED_WRITE_RECORDS["ucpath/create-termination"]?.id;
  assert.ok(id);
  assert.throws(() => Object.assign(id, { segment: id.segment }), TypeError);
});

it("refuses writes to decision choices and how they are sent", () => {
  const { options, recommended } = DECISION_CATALOG["identity-mismatch"];
  const option = options[0];
  assert.ok(option);
  assert.throws(() => Object.assign(option.send, { via: option.send.via }), TypeError);
  assert.throws(() => Object.assign(options, { 0: option }), TypeError);
  assert.throws(() => Object.assign(recommended, { 0: recommended[0] }), TypeError);
});

it("refuses writes to identity review text entries", () => {
  const { reason } = IDENTITY_REVIEW_TEXT;
  assert.throws(() => Object.assign(reason, { agreed: reason.agreed }), TypeError);
});
