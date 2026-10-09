import assert from "node:assert/strict";
import { z } from "zod";
import { describe, it } from "vitest";
import {
  defineCompletionProgram,
  definePredicate,
  revealCompletionProgram,
} from "../../../../../src/models/workflow/completion.js";
import type { ApproveContext, PreviewRecord } from "../../../../../src/models/workflow/completion.js";
import { EidSchema, ItemIdSchema, WorkflowIdSchema } from "../../../../../src/rules/identity/ids.js";
import type { ItemId } from "../../../../../src/rules/identity/ids.js";

const RECORD_ID = `${"c".repeat(64)}#oath-signature#1`;
const OTHER_RECORD_ID = `${"d".repeat(64)}#oath-signature#2`;
const UUID = (tag: string): string => `${tag.repeat(8)}-${tag.repeat(4)}-4${tag.repeat(3)}-8${tag.repeat(3)}-${tag.repeat(12)}`;

const signerWorkflow = Object.freeze({
  id: WorkflowIdSchema.parse("oath-signature"),
  input: z.strictObject({ emplId: EidSchema, recordId: z.string().min(1) }),
  result: z.strictObject({ signed: z.boolean() }),
});
const ticketWorkflow = Object.freeze({
  id: WorkflowIdSchema.parse("oath-ticket"),
  input: z.strictObject({ signerItemIds: z.array(z.string().min(1)) }),
  result: z.strictObject({ filed: z.boolean() }),
});
const memberWorkflow = Object.freeze({
  id: WorkflowIdSchema.parse("i9-check-member"),
  input: z.strictObject({ emplId: EidSchema }),
  result: z.strictObject({ checked: z.boolean() }),
});

const hasResolvedEid = definePredicate("has-resolved-eid", (record) =>
  record.fields.some((field) => field.key === "employee-id"
    && field.value.state === "present" && /^10\d{6}$/.test(field.value.text)));

function record(recordId: string, eid: string | undefined): PreviewRecord {
  return {
    recordId,
    sourceArtifactId: UUID("1"),
    page: 1,
    fields: [{
      key: "employee-id",
      value: eid === undefined ? { state: "absent" } : { state: "present", text: eid },
    }],
  } as PreviewRecord;
}

const CONTEXT: ApproveContext = {
  parentRunId: UUID("2"),
  parentItemId: UUID("3"),
  intakeSessionId: UUID("1"),
  sourceArtifactId: UUID("1"),
  approvedBy: "local-operator",
  approvedAt: "2026-08-01T17:00:00.000Z",
} as ApproveContext;

const DOCUMENT_SEED = {
  sourceArtifactId: UUID("1"),
  intakeSessionId: UUID("1"),
  context: CONTEXT,
};

const itemIdFromRecord = (input: PreviewRecord): ItemId =>
  ItemIdSchema.parse(`00000000-0000-4000-8000-0000000000${input.recordId.slice(0, 2)}`);

function stagedProgram(eligible: boolean) {
  return {
    mode: "staged-fanout" as const,
    gate: "approval" as const,
    stages: [
      {
        per: "record" as const,
        to: signerWorkflow,
        ...(eligible ? { eligible: hasResolvedEid } : {}),
        derive: (preview: PreviewRecord) => ({
          emplId: preview.fields[0]?.value.state === "present" ? preview.fields[0].value.text : "10800000",
          recordId: preview.recordId,
        }),
        deriveItemId: itemIdFromRecord,
      },
      {
        per: "document" as const,
        to: ticketWorkflow,
        derive: (document: { perRecordItemIds: readonly ItemId[] }) => ({
          signerItemIds: [...document.perRecordItemIds],
        }),
        deriveItemId: () => ItemIdSchema.parse(UUID("4")),
      },
    ] as const,
  };
}

describe("completion program", () => {
  it("proves the whole stage chain against one sample", () => {
    const sealed = defineCompletionProgram(stagedProgram(true), {
      mode: "staged-fanout",
      record: record(RECORD_ID, "10873698"),
      context: CONTEXT,
      document: DOCUMENT_SEED,
    });
    assert.equal(sealed.kind, "sealed-completion-program");
    assert.equal(sealed.mode, "staged-fanout");
    assert.equal(sealed.gate, "approval");
  });

  it("keeps the program structurally unreachable except through the one named seam", () => {
    const sealed = defineCompletionProgram(stagedProgram(true), {
      mode: "staged-fanout",
      record: record(RECORD_ID, "10873698"),
      context: CONTEXT,
      document: DOCUMENT_SEED,
    });
    // `sealed.stages` is a type error; the runtime shape agrees.
    assert.equal(Object.hasOwn(sealed, "stages"), false);
    assert.equal(revealCompletionProgram(sealed).stages.length, 2);
    assert.throws(
      // @ts-expect-error the reveal key is a module-private unique symbol
      () => sealed.reveal(Symbol("forged")),
      /readable only through revealCompletionProgram/,
    );
  });

  it("passes a later stage the ids the record stage ACTUALLY enqueued", () => {
    let seen: readonly string[] | undefined;
    const program = {
      mode: "staged-fanout" as const,
      gate: "approval" as const,
      stages: [
        {
          per: "record" as const,
          to: signerWorkflow,
          eligible: hasResolvedEid,
          derive: (preview: PreviewRecord) => ({ emplId: "10873698", recordId: preview.recordId }),
          deriveItemId: itemIdFromRecord,
        },
        {
          per: "document" as const,
          to: ticketWorkflow,
          derive: (document: { perRecordItemIds: readonly ItemId[] }) => {
            seen = document.perRecordItemIds;
            return { signerItemIds: [...document.perRecordItemIds] };
          },
          deriveItemId: () => ItemIdSchema.parse(UUID("4")),
        },
      ] as const,
    };

    defineCompletionProgram(program, {
      mode: "staged-fanout",
      record: record(RECORD_ID, "10873698"),
      context: CONTEXT,
      document: DOCUMENT_SEED,
    });
    assert.deepEqual(seen, [itemIdFromRecord(record(RECORD_ID, "10873698"))]);


    defineCompletionProgram(program, {
      mode: "staged-fanout",
      record: record(OTHER_RECORD_ID, undefined),
      context: CONTEXT,
      document: DOCUMENT_SEED,
    });
    assert.deepEqual(seen, []);
  });

  it("rejects an unstable item id, a foreign predicate, and a mismatched sample", () => {
    let counter = 0;
    assert.throws(() => defineCompletionProgram({
      ...stagedProgram(false),
      stages: [{
        per: "record" as const,
        to: signerWorkflow,
        derive: () => ({ emplId: "10873698", recordId: RECORD_ID }),
        deriveItemId: () => {
          counter += 1;
          return ItemIdSchema.parse(`00000000-0000-4000-8000-00000000000${String(counter)}`);
        },
      }] as const,
    }, {
      mode: "staged-fanout",
      record: record(RECORD_ID, "10873698"),
      context: CONTEXT,
      document: DOCUMENT_SEED,
    }), /deriveItemId is not stable/);

    assert.throws(() => defineCompletionProgram({
      ...stagedProgram(false),
      stages: [{
        per: "record" as const,
        to: signerWorkflow,
        eligible: { id: hasResolvedEid.id, test: () => true },
        derive: () => ({ emplId: "10873698", recordId: RECORD_ID }),
        deriveItemId: itemIdFromRecord,
      }] as const,
    }, {
      mode: "staged-fanout",
      record: record(RECORD_ID, "10873698"),
      context: CONTEXT,
      document: DOCUMENT_SEED,
    }), /must be the exact predicate returned by definePredicate/);

    assert.throws(() => defineCompletionProgram(stagedProgram(true), {
      mode: "complete-then-enqueue",
      plan: {
        recordId: RECORD_ID,
        itemId: UUID("5"),
        parentRunId: UUID("2"),
        delegatedRunId: UUID("3"),
        sourceArtifactId: UUID("1"),
        subject: { kind: "eid", emplId: "10873698" },
      },
    }), /sample is for complete-then-enqueue but the program is staged-fanout/);
  });

  it("rejects a derive whose output the target's own schema refuses", () => {
    assert.throws(() => defineCompletionProgram({
      mode: "staged-fanout" as const,
      gate: "approval" as const,
      stages: [{
        per: "record" as const,
        to: signerWorkflow,
        // "1234" is not an EID; the target's schema is what says so.
        derive: () => ({ emplId: "1234", recordId: RECORD_ID }),
        deriveItemId: itemIdFromRecord,
      }] as const,
    }, {
      mode: "staged-fanout",
      record: record(RECORD_ID, "10873698"),
      context: CONTEXT,
      document: DOCUMENT_SEED,
    }), /EID must be eight digits/);
  });

  it("proves the complete-then-enqueue arm and requires display-only failures", () => {
    const plan = {
      recordId: RECORD_ID,
      itemId: UUID("5"),
      parentRunId: UUID("2"),
      delegatedRunId: UUID("3"),
      sourceArtifactId: UUID("1"),
      subject: { kind: "eid" as const, emplId: "10873698" },
    };
    const sealed = defineCompletionProgram({
      mode: "complete-then-enqueue" as const,
      then: {
        per: "person" as const,
        to: memberWorkflow,
        derive: (entry: { subject: { kind: "eid"; emplId: string } | { kind: "name"; name: string } }) => ({
          emplId: entry.subject.kind === "eid" ? entry.subject.emplId : "10800000",
        }),
        displayFailures: true as const,
      },
    }, { mode: "complete-then-enqueue", plan });
    assert.equal(sealed.mode, "complete-then-enqueue");
    // No approval gate exists for this arm — there is nothing to approve.
    assert.equal(sealed.gate, "none");
    assert.equal(revealCompletionProgram(sealed).then.per, "person");
  });
});
