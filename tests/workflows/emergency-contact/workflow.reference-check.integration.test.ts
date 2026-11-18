import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { parseRunWorkbookReference } from "../../../src/models/dashboard/workbooks.js";
import { REFERENCE_CHECK_REVIEW_GATE } from "../../../src/models/processing/workbooks/reference-check-stop.js";
import { REFERENCE_CHECK } from "../../../src/models/processing/workbooks/verify-person.js";
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
      assert.deepEqual(f.nodeSpans(member, "reference-check"), [["skipped", "condition-false"]]);
      assert.deepEqual(f.nodeSpans(member, "reference-check-review"), [["skipped", "condition-false"]]);
      assert.equal(f.saves(emplId), 1);
    }
  });

  it("emergency-contact-member/reference-check — saves each member without asking when the extra spreadsheet holds them", async () => {
    const f = await world.fixture({ checks: [BOTH] });
    const parent = await f.execute();
    assert.ok(parent?.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done", JSON.stringify(parent?.lifecycle));
    for (const [emplId, row] of [[AVERY, 2], [BLAKE, 3]] as const) {
      const member = f.member(emplId);
      assert.deepEqual((member.input.workbookReferences ?? []).map(bound => parseRunWorkbookReference(bound).request.typeId), [REFERENCE_CHECK.id],
        "a member gets the extra pick, never the required roster");
      assert.deepEqual(f.checkLines(member), [`Fall roster · Hires: found in row ${String(row)}`]);
      assert.equal(f.saves(emplId), 1);
    }
  });

  it("stops only the missing member before its Save; the other saves, and Continue anyway saves the stopped one once", async () => {
    const f = await world.fixture({ checks: [AVERY_ONLY] });
    await f.execute();
    const blake = f.member(BLAKE);
    assert.ok(blake.lifecycle.state === "parked-gate" && String(blake.lifecycle.gateId) === REFERENCE_CHECK_REVIEW_GATE, JSON.stringify(blake.lifecycle));
    assert.deepEqual(f.checkLines(blake), ["Badge list · Issued: not found"]);
    assert.equal(f.saves(BLAKE), 0);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(blake.envelope.runId), []);
    const avery = f.member(AVERY);
    assert.ok(avery.lifecycle.state === "terminal" && avery.lifecycle.outcome === "done", JSON.stringify(avery.lifecycle));
    assert.deepEqual(f.checkLines(avery), ["Badge list · Issued: found in row 2"]);
    assert.equal(f.saves(AVERY), 1);
    const decision = f.card(blake);
    assert.equal(decision.type, "review-before-write");
    assert.deepEqual(decision.options.map(option => [option.id, option.label, option.send.via]), [["continue", "Continue anyway", "gate-arm"], ["cancel-run", "Cancel run", "row-action"]]);
    assert.equal(decision.context, "Badge list · Issued: not found · Compared: Employee ID, and name where the sheet has one.");

    assert.equal(f.continueAnyway(blake).state, "applied");
    const parent = await f.execute();
    assert.ok(parent?.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done", JSON.stringify(parent?.lifecycle));
    assert.equal(f.saves(BLAKE), 1);
    assert.equal(f.saves(AVERY), 1);
  });

  it("stops the member whose name differs without recording the row's name, and Cancel run saves nothing for them", async () => {
    const f = await world.fixture({ checks: [BLAKE_RENAMED] });
    await f.execute();
    const blake = f.member(BLAKE);
    assert.equal(blake.lifecycle.state, "parked-gate");
    assert.equal(f.card(blake).context, "Fall roster · Hires: name differs in row 3 · Compared: Employee ID, and name where the sheet has one.");
    assert.equal(JSON.stringify([f.events(blake), f.card(blake)]).includes(ROW_ONLY_NAME), false);
    assert.equal(f.saves(AVERY), 1);

    assert.equal(f.cancel(blake).state, "applied");
    const cancelled = f.member(BLAKE);
    assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled", JSON.stringify(cancelled.lifecycle));
    assert.equal(f.saves(BLAKE), 0);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(blake.envelope.runId), []);
  });

  it("never stops a dry run for the check, and still records each member's line", async () => {
    const f = await world.fixture({ dryRun: true, checks: [AVERY_ONLY] });
    const parent = await f.execute();
    assert.ok(parent?.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done", JSON.stringify(parent?.lifecycle));
    assert.deepEqual(f.checkLines(f.member(AVERY)), ["Badge list · Issued: found in row 2"]);
    assert.deepEqual(f.checkLines(f.member(BLAKE)), ["Badge list · Issued: not found"]);
    assert.deepEqual(f.nodeSpans(f.member(BLAKE), "reference-check-review"), [["skipped", "condition-false"]]);
    assert.equal(f.saves(AVERY) + f.saves(BLAKE), 0);
  });
});
