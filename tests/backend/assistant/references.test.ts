import assert from "node:assert/strict";
import { it } from "vitest";
import { AssistantReferenceError, createAssistantReferenceTable, createAssistantReferences, maskOperatorText } from "../../../src/backend/assistant/references.js";

const owner = { profileId: "11111111-1111-4111-8111-111111111111", epoch: 1 };

it("issues one idempotent token per record and substitutes only this generation's issued tokens", () => {
  const table = createAssistantReferenceTable(4);
  const person = table.issue("P", "Avery Synthetic", "Avery Synthetic");
  assert.equal(person, "[[P1.g4]]");
  assert.equal(table.issue("P", "Avery Synthetic", "Avery Synthetic"), person);
  assert.equal(table.issue("P", "Blake Synthetic", "Blake Synthetic"), "[[P2.g4]]");
  assert.equal(table.issue("R", "run-a", "Person Lookup run, 2026-11-06", "run-a"), "[[R1.g4]]");
  assert.equal(table.display("[[P1.g4]] and [[P2.g4]] ran [[R1.g4]]; [[P1.g3]] [[P9.g4]] [[X1.g4]]"),
    "Avery Synthetic and Blake Synthetic ran Person Lookup run, 2026-11-06; [[P1.g3]] [[P9.g4]] [[X1.g4]]");
  assert.equal(table.expand("[[R1.g4]]"), "run-a");
  assert.equal(table.resolve(" [[P1.g4]] ", ["P"]).target, "Avery Synthetic");
});

it("refuses unknown, expired and wrong-kind references and bounds the table", () => {
  const table = createAssistantReferenceTable(2);
  table.issue("E", "10812345", "10812345");
  assert.throws(() => table.resolve("[[E1.g1]]", ["E"]), (error: unknown) => error instanceof AssistantReferenceError && error.reason === "reference-expired");
  assert.throws(() => table.resolve("[[E2.g2]]", ["E"]), (error: unknown) => error instanceof AssistantReferenceError && error.reason === "reference-unknown");
  assert.throws(() => table.resolve("10812345", ["E"]), (error: unknown) => error instanceof AssistantReferenceError && error.reason === "reference-unknown");
  assert.throws(() => table.resolve("[[E1.g2]]", ["P"]), (error: unknown) => error instanceof AssistantReferenceError && error.reason === "reference-kind");
  for (let index = 1; index < 500; index++) table.issue("R", `run-${String(index)}`, "run");
  assert.throws(() => table.issue("R", "one-more", "run"), (error: unknown) => error instanceof AssistantReferenceError && error.reason === "reference-limit");
});

it("never resolves an old token to a record issued after a restart or owner change", () => {
  const before = createAssistantReferences().table("chat", owner, 3);
  const old = before.issue("P", "Person A", "Person A");
  // A new process (or owner) starts a strictly later generation for the same conversation.
  const restarted = createAssistantReferences(), after = restarted.table("chat", owner, 7);
  assert.equal(after.issue("P", "Person B", "Person B"), "[[P1.g7]]");
  assert.throws(() => after.resolve(old, ["P"]), (error: unknown) => error instanceof AssistantReferenceError && error.reason === "reference-expired");
  assert.equal(after.display(`about ${old}`), `about ${old}`);
  assert.equal(restarted.table("chat", owner, 8), after);
  const switched = restarted.table("chat", { ...owner, epoch: 2 }, 9);
  assert.notEqual(switched, after);
  assert.equal(switched.generation, 9);
  restarted.clear("chat");
  assert.notEqual(restarted.table("chat", { ...owner, epoch: 2 }, 10), switched);
});

it("masks EIDs as references and other identifiers as fixed markers", () => {
  const table = createAssistantReferenceTable(5);
  const cases: readonly (readonly [string, string])[] = [
    ["EID 10812345 twice 10812345", "EID [[E1.g5]] twice [[E1.g5]]"],
    ["SSN 123-45-6789 or 123456789", "SSN [redacted SSN] or [redacted SSN]"],
    ["mail jane.doe+hr@ucsd.edu now", "mail [redacted email] now"],
    ["(858) 534-1234, 858-534-1234, 858.534.1234, +1 858 534 1234", "[redacted phone], [redacted phone], [redacted phone], [redacted phone]"],
    ["account 1234567890 and 123456789012345", "account [redacted number] and [redacted number]"],
    ["EID inside 108123456789 stays one number", "EID inside [redacted number] stays one number"],
    ["dates 2026-11-06 and 11/06/2026 at 10:30, doc 4502", "dates 2026-11-06 and 11/06/2026 at 10:30, doc 4502"],
    ["run 12345678-1234-4abc-8abc-123456789012 and run_12345678-1234-4abc-8abc-123456789012_3", "run 12345678-1234-4abc-8abc-123456789012 and run_12345678-1234-4abc-8abc-123456789012_3"],
    ["typed [[P1.g5]] token", "typed [ [P1.g5] ] token"],
    ["Jane Doe 7-digit 1234567", "Jane Doe 7-digit 1234567"],
  ];
  for (const [input, expected] of cases) assert.equal(maskOperatorText(input, table), expected, input);
  assert.equal(table.resolve("[[E1.g5]]", ["E"]).expand, "10812345");
  for (const marker of ["[redacted SSN]", "[redacted email]", "[redacted phone]", "[redacted number]"]) {
    assert.throws(() => table.resolve(marker, ["E", "P", "R", "N", "S", "A"]), AssistantReferenceError);
    assert.equal(table.expand(marker), marker);
  }
  assert.equal(table.display("[ [P1.g5] ]"), "[ [P1.g5] ]");
});
