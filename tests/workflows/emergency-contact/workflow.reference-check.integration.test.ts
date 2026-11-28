import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { parseRunWorkbookReference } from "../../../src/models/dashboard/workbooks.js";
import { REFERENCE_CHECK_ID } from "../../../src/models/processing/workbooks/reference-fields.js";
import { createEmergencyContactReferenceWorld } from "../../support/helpers/backend/emergency-contact-reference-world.js";

const world = createEmergencyContactReferenceWorld();
afterEach(world.cleanup);
const AVERY = "10800000", BLAKE = "10800001";
/** A name no fixture carries, so finding it anywhere in a run proves a row value leaked. */
const ROW_ONLY_NAME = "Zebedee Quillfeather";
const BOTH = { name: "Fall roster", sheet: "Hires", fields: ["eid", "fullName"], rows: [[AVERY, "Avery Example"], [BLAKE, "Blake Example"]] };
const AVERY_ONLY = { name: "Badge list", sheet: "Issued", fields: ["eid"], rows: [[AVERY]] };
const BLAKE_RENAMED = { name: "Fall roster", sheet: "Hires", fields: ["eid", "fullName"], rows: [[AVERY, "Avery Example"], [BLAKE, ROW_ONLY_NAME]] };

describe("Emergency Contact reference spreadsheet check", () => {
  it("skips the check in each member with only the required roster picked and saves both as before", async () => {
    const f = await world.fixture();
    const parent = await f.execute();
    assert.ok(parent?.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done", JSON.stringify(parent?.lifecycle));
    for (const emplId of [AVERY, BLAKE]) {
      const member = f.member(emplId);
      assert.equal(member.input.workbookReferences, undefined);
      assert.deepEqual(f.nodeSpans(member, "reference-fields-start"), [["skipped", "condition-false"]]);
      assert.deepEqual(f.nodeSpans(member, "reference-field-review-map-contact"), [["skipped", "condition-false"]]);
      assert.equal(f.saves(emplId), 1);
    }
  });

  it("emergency-contact-member/reference-check — saves each member without asking when the extra spreadsheet holds them", async () => {
    const f = await world.fixture({ checks: [BOTH] });
    const parent = await f.execute();
    assert.ok(parent?.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done", JSON.stringify(parent?.lifecycle));
    for (const [emplId, row] of [[AVERY, 2], [BLAKE, 3]] as const) {
      const member = f.member(emplId);
      assert.deepEqual((member.input.workbookReferences ?? []).map(bound => parseRunWorkbookReference(bound).request.typeId), [REFERENCE_CHECK_ID],
        "a member gets the extra pick, never the required roster");
      assert.deepEqual(f.checkLines(member), [`Hires, row ${String(row)}: Employee ID matches`, `Hires, row ${String(row)}: Legal name matches`]);
      assert.equal(f.saves(emplId), 1);
    }
  });

  it("logs the missing row for that member and saves each member once", async () => {
    const f = await world.fixture({ checks: [AVERY_ONLY] });
    const parent = await f.execute();
    assert.ok(parent?.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done", JSON.stringify(parent?.lifecycle));
    assert.deepEqual(f.checkLines(f.member(BLAKE)), ["Not in Issued"]);
    assert.deepEqual(f.checkLines(f.member(AVERY)), ["Issued, row 2: Employee ID matches"]);
    assert.equal(f.saves(BLAKE), 1);
    assert.equal(f.saves(AVERY), 1);
  });

  it("stops the member whose name differs and keeps the row value out of Logs, and Cancel run saves nothing for them", async () => {
    const f = await world.fixture({ checks: [BLAKE_RENAMED] });
    await f.execute();
    const blake = f.member(BLAKE);
    assert.equal(blake.lifecycle.state, "parked-gate");
    const decision = f.card(blake);
    assert.deepEqual(decision.options.map(option => [option.id, option.label, option.send.via]), [["continue", "Continue anyway", "gate-arm"], ["cancel-run", "Cancel run", "row-action"]]);
    assert.match(decision.context ?? "", /Hires, row 3 · Legal name: spreadsheet “Zebedee Quillfeather”, workflow “[^”]+”/u);
    assert.equal(JSON.stringify(f.events(blake)).includes(ROW_ONLY_NAME), false);
    assert.equal(f.saves(AVERY), 1);

    assert.equal(f.cancel(blake).state, "applied");
    const cancelled = f.member(BLAKE);
    assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled", JSON.stringify(cancelled.lifecycle));
    assert.equal(f.saves(BLAKE), 0);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(blake.envelope.runId), []);
  });

  it("continues a dry run with a missing row and records each member's line", async () => {
    const f = await world.fixture({ dryRun: true, checks: [AVERY_ONLY] });
    const parent = await f.execute();
    assert.ok(parent?.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done", JSON.stringify(parent?.lifecycle));
    assert.deepEqual(f.checkLines(f.member(AVERY)), ["Issued, row 2: Employee ID matches"]);
    assert.deepEqual(f.checkLines(f.member(BLAKE)), ["Not in Issued"]);
    assert.deepEqual(f.nodeSpans(f.member(BLAKE), "reference-field-review-map-contact"), [["skipped", "condition-false"]]);
    assert.equal(f.saves(AVERY) + f.saves(BLAKE), 0);
  });
});
