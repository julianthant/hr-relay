import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ActionDescriptorWireSchema } from "../../../../../src/models/dashboard/actions.js";
import { parkedWriteDecision } from "../../../../../src/backend/runs/queries/run-detail/gate-park.js";
import { parkedWriteRecordId } from "../../../../../src/backend/runs/decisions/decision-catalog.js";

const writeTarget = { writeIntentId: "11111111-1111-4111-8111-111111111111", intentGeneration: 1, writeAttemptId: "22222222-2222-4222-8222-222222222222",
  bindingProofDigest: "a".repeat(64), occurrenceKeyDigest: "b".repeat(64) };
const confirmOf = (key: string) => ({ title: `${key} title`, confirmLabel: key, tone: "neutral" as const });
const action = (key: string, command: string) => ActionDescriptorWireSchema.parse({ key, label: key, intent: "neutral", placement: ["footer"], kind: "command", command, expectedVersion: 3, writeTarget, confirm: confirmOf(key) });
const RECHECK = action("recheck-write", "recheck-write"), ABSENT = action("resolve-write-absent", "resolve-write-absent");
const HELD = { ...RECHECK, key: "check-parked-write", command: "check-parked-write" as const, confirm: confirmOf("check-parked-write") };
const TERMINATION = { taskId: "ucpath/create-termination", parkedCode: "ambiguous", readBack: false, acceptsTransactionId: true };
const KUALI = { taskId: "kuali/save-separation-finalization", parkedCode: "unknown", readBack: false, acceptsTransactionId: false };

describe("parkedWriteDecision", () => {
  it("asks whether the termination saved in UCPath: Saved re-reads the typed transaction, Not saved confirms absence", () => {
    const decision = parkedWriteDecision(TERMINATION, [RECHECK, ABSENT]);
    assert.equal(decision.type, "write-parked");
    assert.equal(decision.title, "Did the termination save in UCPath?");
    assert.equal(decision.context, "Submit did not confirm. Check Smart HR Transactions in UCPath.");
    assert.equal(decision.choiceLabel, "Answer");
    assert.deepEqual(decision.options.map(({ id, label, send, recommended }) => [id, label, send, recommended]), [
      ["saved", "Saved in UCPath", { via: "action", actionKey: "recheck-write" }, true],
      ["not-saved", "Not saved, file it again", { via: "action", actionKey: "resolve-write-absent" }, undefined],
    ]);
    assert.deepEqual(decision.options[0]?.input, { kind: "text", label: "Transaction number", placeholder: "T00000000", pattern: "^T\\d+$" });
    assert.equal(decision.options[1]?.input, undefined);
    assert.deepEqual(decision.options.map(({ hint }) => hint), ["Relay checks this number, then the run continues.", "Relay files the termination once more."]);
    assert.deepEqual(decision.options.map(({ confirm }) => confirm), [confirmOf("recheck-write"), confirmOf("resolve-write-absent")]);
  });

  it("asks a Kuali save without a number, and serves no Check again that would repeat Saved", () => {
    const decision = parkedWriteDecision(KUALI, [RECHECK, ABSENT]);
    assert.equal(decision.type, "write-unknown");
    assert.equal(decision.title, "Did the separation document save in Kuali?");
    assert.equal(decision.context, "Save did not confirm. Check the separation document in Kuali.");
    assert.deepEqual(decision.options.map(({ id, label, recommended }) => [id, label, recommended]), [
      ["saved", "Saved in Kuali", true], ["not-saved", "Not saved, save it again", undefined]]);
    assert.equal(decision.options[0]?.input, undefined, "Kuali issues no number; Relay re-reads the document");
    assert.equal(decision.options[0]?.hint, "Relay checks Kuali, then the run continues.");
  });

  it("offers Check again first only as the held UCPath check, which files nothing", () => {
    const decision = parkedWriteDecision(TERMINATION, [RECHECK, ABSENT, HELD]);
    assert.deepEqual(decision.options.map(({ id, recommended }) => [id, recommended]), [["check-again", undefined], ["saved", true], ["not-saved", undefined]]);
    assert.deepEqual(decision.options[0]?.send, { via: "action", actionKey: "check-parked-write" });
    assert.equal(decision.options[0]?.hint, "Reads Smart HR Transactions again; files nothing.");
    assert.deepEqual(decision.options[0]?.confirm, confirmOf("check-parked-write"));
  });

  it("names the record by its display-safe identifier, like the frames", () => {
    assert.equal(parkedWriteDecision({ ...TERMINATION, recordId: "10807012" }, [RECHECK, ABSENT]).context, "Submit did not confirm. Check Smart HR Transactions for 10807012.");
    assert.equal(parkedWriteDecision({ ...KUALI, recordId: "SIM-48216" }, [RECHECK, ABSENT]).context, "Save did not confirm. Check document SIM-48216 in Kuali.");
  });

  it("says the system accepted the write but its status could not be read when the saved-effect read failed", () => {
    const decision = parkedWriteDecision({ ...TERMINATION, readBack: true, recordId: "10807012" }, [RECHECK, ABSENT]);
    assert.equal(decision.title, "Termination saved, but the read-back failed");
    assert.equal(decision.context, "UCPath accepted the submit, but Relay could not read its status. Check Smart HR Transactions for 10807012.");
    assert.deepEqual(decision.options.map(({ id, recommended }) => [id, recommended]), [["saved", true], ["not-saved", undefined]], "the same answers; the copy changes, not the commands");
    assert.deepEqual(parkedWriteDecision({ ...TERMINATION, readBack: true }, [RECHECK, ABSENT, HELD]).options.map(({ id, recommended }) => [id, recommended]),
      [["check-again", true], ["saved", undefined], ["not-saved", undefined]], "where the held check is served, it is preselected");
  });

  it("reads the identifier only from the declared key segment, never a date, and refuses a declared key without it", () => {
    assert.equal(parkedWriteRecordId("ucpath/create-termination", "ucpath:termination|10807012|2031-04-25"), "10807012");
    assert.equal(parkedWriteRecordId("kuali/save-separation-finalization", "kuali:SIM-48216|finalization|T00042871"), "SIM-48216");
    assert.equal(parkedWriteRecordId("ucpath/save-emergency-contact", "ucpath:emergency-contact|" + "a".repeat(64)), undefined);
    assert.equal(parkedWriteRecordId("ucpath/terminate-person", "anything"), undefined);
    assert.throws(() => parkedWriteRecordId("kuali/save-separation-finalization", "other:SIM-48216|finalization"), /PARKED_WRITE_KEY_IDENTIFIER_MISSING/u);
  });

  it("never settles from the answer alone, marks a parked write failed, or retries it", () => {
    for (const declared of [TERMINATION, KUALI]) {
      const decision = parkedWriteDecision(declared, [RECHECK, ABSENT, HELD]);
      for (const option of decision.options) {
        assert.equal(option.send.via, "action", `${option.id} sends only a served write-resolution descriptor`);
        assert.ok(option.send.via === "action" && ["check-parked-write", "recheck-write", "resolve-write-absent"].includes(option.send.actionKey), option.id);
      }
      assert.ok(decision.options.every(({ id }) => !["retry", "mark-as-failed", "add-note"].includes(id)));
    }
  });

  it("omits an answer whose command is not served", () => {
    assert.deepEqual(parkedWriteDecision(TERMINATION, [ABSENT]).options.map(({ id }) => id), ["not-saved"]);
  });

  it("keeps a parked write of an unregistered task answerable in the catalog's general wording", () => {
    const decision = parkedWriteDecision({ ...TERMINATION, taskId: "ucpath/terminate-person", acceptsTransactionId: false }, [RECHECK, ABSENT]);
    assert.equal(decision.title, "Did the write save?");
    assert.equal(decision.context, undefined);
    assert.deepEqual(decision.options.map(({ id, label, hint }) => [id, label, hint]), [
      ["saved", "Saved", "Relay checks it, then the run continues."],
      ["not-saved", "Not saved, write it again", "Relay writes it once more."],
    ]);
  });
});
