import { RunIdSchema, FingerprintSchema } from "../../../src/domain/ids.js";
// @vitest-environment jsdom
/**
 * D308's ARCHIVE DELETE, PRESSED.
 *
 * The kernel's arm is proved against real authority in `archive-model.test.ts`;
 * this file proves the only half a kernel test cannot see — that an operator
 * can reach it, that they cannot reach it by accident, that the envelope
 * carries the digest the page actually read, and that the answer they get is
 * the answer the kernel gave.
 *
 * It mounts the real `ArchiveWorkspace` against a stub client and presses real
 * controls, for the reason `archive-bump-round-trip-press.test.ts` gives: the
 * standing rule that behaviour belongs to the parity lane is about PIXELS, and
 * "does the confirm gate the send" is not a pixel.
 *
 * Each case was run against a mutation of the line it pins; the mutation is
 * named in the case.
 */
import assert from "node:assert/strict";
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { ToastProvider } from "../../../src/dashboard/ds/ui.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { ArchiveWorkspace } from "../../../src/dashboard/surfaces/archive.js";
import { archivedDeleteConfirm, type ArchiveView } from "../../../src/dashboard/surfaces/archive-model.js";
import {
  SavedArchiveDetailWireSchema,
  SavedArchiveIndexWireSchema,
  type SavedArchiveDetailWire,
  SavedArchiveReportWireSchema,
  type SavedArchiveIndexWire,
  type SavedArchiveReportWire,
} from "../../../src/domain/dashboard/archive.js";
import { CommandResultSchema, type CommandResult } from "../../../src/domain/commands.js";
import {H_REPORT} from "../../parity/helpers/fixture-archive-report.js";
const FIXTURE_ARCHIVED_RUN=H_REPORT;
const FIXTURE_ARCHIVED_RUN_ID=H_REPORT.runId;
const FIXTURE_ARCHIVE_INDEX=SavedArchiveIndexWireSchema.parse({items:[H_REPORT],next:null});
const DELETED_DETAIL = SavedArchiveDetailWireSchema.parse({
  state: "deleted",
  runId: FIXTURE_ARCHIVED_RUN_ID,
  reason: "This run was explicitly deleted.",
  deletion: {
    state: "deleted",
    runId: FIXTURE_ARCHIVED_RUN_ID,
    deletedAt: "2026-09-10T00:00:00.000Z",
    removed: [{ table: "workflow_runs", rows: 1 }],
    cleanup: { state: "complete", fileCount: 0 },
    command: { state: "complete", commandId: "00000000-0000-4000-8000-000000009801", completedAt: "2026-09-10T00:00:01.000Z" },
  },
});

/* ── the two browser APIs jsdom does not implement, stubbed for MEASUREMENT
      only: nothing here asserts a position. ───────────────────────────────── */

class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class ZeroDOMRect {
  readonly x = 0;
  readonly y = 0;
  readonly width = 0;
  readonly height = 0;
  readonly top = 0;
  readonly left = 0;
  readonly right = 0;
  readonly bottom = 0;
  static fromRect(): ZeroDOMRect {
    return new ZeroDOMRect();
  }
  toJSON(): Readonly<Record<string, number>> {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
}

Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "DOMRect", ZeroDOMRect);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const ACTOR_ID = "local-operator";
const COMMAND_ID = "aa11bb22-0308-4000-8000-aa11bb220308";

/** The archived record's own digest — what the delete has to cite back. */
const SERVED_DIGEST = FIXTURE_ARCHIVED_RUN.archiveFingerprint;

const APPLIED: CommandResult = CommandResultSchema.parse({
  state: "applied",
  commandId: COMMAND_ID,
  affectedTargets: [{ family: "run", runId: FIXTURE_ARCHIVED_RUN_ID }],
});

/**
 * The kernel's own `schema-mismatch` sentence, shortened exactly as
 * `executeArchivedRunDelete` shortens it. It is the refusal both Archive doors
 * are built to produce: the record moved under the page that read it.
 */
const MISMATCH_MESSAGE =
  `archived run ${FIXTURE_ARCHIVED_RUN_ID} holds content digest ${SERVED_DIGEST.slice(0, 12)}…, `
  + "not the aaaaaaaaaaaa… this delete cited";

const MISMATCH: CommandResult = CommandResultSchema.parse({
  state: "rejected",
  commandId: COMMAND_ID,
  code: "schema-mismatch",
  message: MISMATCH_MESSAGE,
});

/** The ledger after the delete lands: the record this case removed is gone. */
const INDEX_AFTER_DELETE: SavedArchiveIndexWire = SavedArchiveIndexWireSchema.parse({
  ...FIXTURE_ARCHIVE_INDEX,
  items: FIXTURE_ARCHIVE_INDEX.items.filter((entry) => entry.runId !== FIXTURE_ARCHIVED_RUN_ID),
});

/** The same record, having filed one real write — the case the confirm warns about. */
const RUN_THAT_FILED: SavedArchiveReportWire = SavedArchiveReportWireSchema.parse({
  ...FIXTURE_ARCHIVED_RUN,
  sections: [...FIXTURE_ARCHIVED_RUN.sections,{kind:"text",title:"Retained transaction",text:"A transaction was recorded."}],
});

function stubClient(served: Partial<DashboardClient>): DashboardClient {
  const handler: ProxyHandler<Partial<DashboardClient>> = {
    get(target, property): unknown {
      const impl: unknown = Reflect.get(target, property);
      if (impl === undefined) {
        throw new Error(`the Archive reached for client.${String(property)}, which this case does not serve`);
      }
      return impl;
    },
  };
  return new Proxy(served, handler) as DashboardClient;
}

let mounted: Root | undefined;

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

afterEach(async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act(async () => { root.unmount(); });
  }
  document.body.replaceChildren();
});

function buttons(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")];
}

/**
 * The route around the workspace, exactly as `dashboard-app.tsx` owns it: the
 * SELECTION is a prop the parent holds, so an applied delete's navigation back
 * to the ledger has somewhere real to land.
 */
function ArchiveRoute({ client }: { client: DashboardClient }): ReactElement {
  const [view, setView] = useState<ArchiveView>("runs");
  const [selection, setSelection] = useState<string>(FIXTURE_ARCHIVED_RUN_ID);
  return createElement(ToastProvider, {
    children: createElement(DashboardClientProvider, {
      client,
      children: createElement(ArchiveWorkspace, {
        selection,
        view,
        actorId: ACTOR_ID,
        onSelection: setSelection,
        onView: setView,
      }),
    }),
  });
}

interface MountedArchive {
  readonly commands: readonly unknown[];
  readonly press: (name: string) => Promise<void>;
  readonly text: () => string;
  readonly indexReads: () => number;
}

async function mountArchive(options: {
  readonly detail?: SavedArchiveReportWire;
  readonly result?: CommandResult;
  readonly indexes?: readonly SavedArchiveIndexWire[];
}): Promise<MountedArchive> {
  const detail = options.detail ?? FIXTURE_ARCHIVED_RUN;
  const queue = [...(options.indexes ?? [FIXTURE_ARCHIVE_INDEX, INDEX_AFTER_DELETE])];
  const commands: unknown[] = [];
  let indexReads = 0;
  let deleted = false;

  const client = stubClient({
    savedArchiveIndex: async (): Promise<SavedArchiveIndexWire> => {
      const next = queue.shift();
      if (next === undefined) {
        throw new Error(`the Archive read its index ${String(indexReads + 1)} times; this case serves fewer`);
      }
      indexReads += 1;
      return next;
    },
    savedArchiveReport: async (runId: string): Promise<SavedArchiveDetailWire> => {
      if (runId !== detail.runId) throw new Error(`the Archive asked for archived run ${runId}, which this case does not serve`);
      return deleted ? DELETED_DETAIL : detail;
    },
    savedArchiveFile: async (runId,digest) => ({runId:RunIdSchema.parse(runId),digest:FingerprintSchema.parse(digest),resource:{state:"missing",reason:"No file bytes in this UI fixture"}}),
    executeCommand: async (request: unknown): Promise<CommandResult> => {
      commands.push(request);
      const result = options.result ?? APPLIED;
      if (result.state === "applied") deleted = true;
      return result;
    },
  });

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => { root.render(createElement(ArchiveRoute, { client })); });
  await settle();

  const press = async (name: string): Promise<void> => {
    const matches = buttons().filter((button) => (button.textContent ?? "").trim() === name);
    const only = matches[0];
    if (matches.length !== 1 || only === undefined) {
      throw new Error(
        `expected exactly one control named "${name}", found ${String(matches.length)} among `
        + `[${buttons().map((button) => JSON.stringify((button.textContent ?? "").trim())).join(", ")}]`,
      );
    }
    await act(async () => { only.click(); });
    await settle();
  };

  return { commands, press, text: () => document.body.textContent ?? "", indexReads: () => indexReads };
}

/* ── the copy ────────────────────────────────────────────────────────────── */

describe("D308 — the archived delete's confirm copy", () => {
  it("names what leaves, what the released key costs, and that there is no undo", () => {
    const copy = archivedDeleteConfirm({ workflowLabel: "Person Lookup" });

    assert.equal(copy.title, "Delete this archived run");
    assert.equal(copy.confirmLabel, "Delete");
    assert.equal(
      copy.description,
      "It removes the archived record, the retained run, and every row it owns from the database, "
      + "including its write ledger.",
    );
    assert.deepEqual(copy.consequences, [
      "If this run wrote to Person Lookup's systems, the permanent idempotency key that stops "
      + "the same write from being submitted twice is released with it.",
      "This is final; there is no undo.",
    ]);
  });

  it("names the WORKFLOW the run wrote to, not a database noun", () => {
    // Mutation: hard-coding the workflow name in the sentence.
    const copy = archivedDeleteConfirm({ workflowLabel: "Separations" });
    assert.equal(copy.consequences[0]?.includes("Separations's systems"), true, copy.consequences[0]);
  });
});

/* ── the door ────────────────────────────────────────────────────────────── */

describe("D308 — the archived run's delete door", () => {
  it("gates the send behind the confirm: opening it posts nothing", async () => {
    // Mutation: wiring the footer's `onDelete` straight to `deleteArchivedRun`.
    const archive = await mountArchive({});

    await archive.press("Delete saved report");

    assert.deepEqual(archive.commands, []);
    assert.equal(archive.text().includes(`Delete ${FIXTURE_ARCHIVED_RUN.title}?`), true, "the confirm did not open");
    assert.equal(
      archive.text().includes("cannot be undone"),
      true,
      "the confirm opened without the sentence that makes it a decision",
    );
  });

  it("cancelling the confirm sends nothing and leaves the record selected", async () => {
    const archive = await mountArchive({});

    await archive.press("Delete saved report");
    await archive.press("Cancel");

    assert.deepEqual(archive.commands, []);
    assert.equal(archive.text().includes(`Delete ${FIXTURE_ARCHIVED_RUN.title}?`), false, "the confirm stayed open");
    assert.equal(archive.text().includes(FIXTURE_ARCHIVED_RUN.title), true);
  });

  it("composes `delete-archived-run` citing the digest the page was served", async () => {
    // Mutation: citing `detail.runId` twice, or any digest but the served one.
    const archive = await mountArchive({});

    await archive.press("Delete saved report");
    await archive.press("Delete this report");

    assert.equal(archive.commands.length, 1);
    const sent = archive.commands[0];
    assert.equal(typeof sent, "object");
    assert.notEqual(sent, null);
    const envelope = sent as Record<string, unknown>;
    assert.equal(envelope.family, "version-archive");
    assert.equal(envelope.type, "delete-archived-run");
    assert.equal(envelope.requestedBy, ACTOR_ID);
    assert.equal(envelope.source, "archive");
    assert.deepEqual(envelope.target, {
      archivedRunId: FIXTURE_ARCHIVED_RUN_ID,
      archiveFingerprint: SERVED_DIGEST,
    });
    // The digest is the RECORD's, not a constant this test and the surface
    // could both be wrong about.
    assert.equal(SERVED_DIGEST, FIXTURE_ARCHIVE_INDEX.items[0]?.archiveFingerprint);
  });

  it("re-reads canonical deletion status on `applied`, while the ledger no longer lists the run", async () => {
    const archive = await mountArchive({});

    await archive.press("Delete saved report");
    await archive.press("Delete this report");

    assert.equal(archive.indexReads(), 2, "the applied delete did not re-read the ledger");
    assert.equal(
      archive.text().includes("Saved report deleted"),
      true,
      "the selected route did not show its canonical deletion status",
    );
    assert.equal(
      archive.text().includes(FIXTURE_ARCHIVED_RUN.title),
      false,
      "the re-read ledger still lists the deleted run",
    );
  });

  it("draws the kernel's `schema-mismatch` refusal and stays on the record", async () => {
    // Mutation: treating any settled result as applied.
    const archive = await mountArchive({ result: MISMATCH });

    await archive.press("Delete saved report");
    await archive.press("Delete this report");

    const text = archive.text();
    assert.equal(text.includes("That command was refused"), true, text);
    assert.equal(text.includes("code schema-mismatch"), true, text);
    assert.equal(text.includes(MISMATCH_MESSAGE), true, "the kernel's own sentence was paraphrased away");
    assert.equal(text.includes("Nothing was changed."), false, "the UI invented a no-change assurance");
    // A refusal is not a landing: the ledger is not re-read and the record stays.
    assert.equal(archive.indexReads(), 1);
    assert.equal(text.includes(FIXTURE_ARCHIVED_RUN.title), true);
  });

  it("warns, before the press, that a run which filed keeps its key only until now", async () => {
    const archive = await mountArchive({ detail: RUN_THAT_FILED });

    await archive.press("Delete saved report");

    const text = archive.text();
    assert.equal(text.includes("permanent idempotency keys"), true, text);
    assert.equal(text.includes("could submit the same write again"), true, text);
  });
});
