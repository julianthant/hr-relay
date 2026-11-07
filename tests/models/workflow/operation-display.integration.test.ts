import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { renderOperationTemplate } from "../../../src/models/workflow/operation-display.js";
import { fictionalSeparationDocument,reconcileFictionalSeparation,separationCommentTemplate } from "../../support/fixtures/plan1-separation-operation.js";

describe("fictional separation run through production authority", () => {
  it("uses one exact template for computed comments and applies its optional holiday clause", () => {
    const fields = reconcileFictionalSeparation(fictionalSeparationDocument);
    assert.equal(fields.effectiveDate, "09/26/2026");
    assert.equal(fields.comments, fields.managerComments);
    assert.equal(fields.comments, renderOperationTemplate(separationCommentTemplate, { effective: fields.effectiveDate, "last-day": fields.lastDayWorked, holiday: fields.holidayPay, document: fields.documentNumber }));
    assert.ok(fields.comments.includes("Holiday Pay on 09/25/2026."));
    assert.ok(!reconcileFictionalSeparation({ ...fictionalSeparationDocument, holidayPay: "" }).comments.includes("Holiday Pay"));
  });
});
