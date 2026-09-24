// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { ToastProvider } from "../../../src/dashboard/ds/ui.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SavedArchiveWorkspace } from "../../../src/dashboard/surfaces/archive-report.js";
import { savedDateFilterSummary } from "../../../src/dashboard/surfaces/archive-report-model.js";
import {
  SavedArchiveDetailWireSchema,
  SavedArchiveIndexWireSchema,
  type SavedArchiveFileWire,
} from "../../../src/domain/dashboard/archive.js";
import { CommandResultSchema, type CommandResult } from "../../../src/domain/commands.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";

const REPORT = H_REPORT;
const DELETED_DETAIL = SavedArchiveDetailWireSchema.parse({
  state: "deleted",
  runId: REPORT.runId,
  reason: "This saved report was deleted.",
  deletion: {
    state: "deleted",
    runId: REPORT.runId,
    deletedAt: "2026-09-10T00:00:00.000Z",
    removed: [{ table: "workflow_runs", rows: 1 }],
    cleanup: { state: "complete", fileCount: 1 },
    command: { state: "complete", commandId: "00000000-0000-4000-8000-000000009801", completedAt: "2026-09-10T00:00:01.000Z" },
  },
});
const APPLIED = CommandResultSchema.parse({
  state: "applied",
  commandId: "00000000-0000-4000-8000-000000009802",
  affectedTargets: [{ family: "run", runId: REPORT.runId }],
});
const REFUSED = CommandResultSchema.parse({
  state: "rejected",
  commandId: "00000000-0000-4000-8000-000000009803",
  code: "schema-mismatch",
  message: "The saved report fingerprint changed. Refresh the report before deleting it.",
});

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
  static fromRect(): ZeroDOMRect { return new ZeroDOMRect(); }
  toJSON(): Readonly<Record<string, number>> { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
}

Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "DOMRect", ZeroDOMRect);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let mounted: Root | undefined;

function stubClient(served: Partial<DashboardClient>): DashboardClient {
  return new Proxy(served, {
    get(target, property): unknown {
      const implementation: unknown = Reflect.get(target, property);
      if (implementation === undefined) {
        throw new Error(`Saved Archive reached for client.${String(property)}, which this case does not serve`);
      }
      return implementation;
    },
  }) as DashboardClient;
}

function ArchiveRoute({ client }: { client: DashboardClient }): ReactElement {
  const [selection, setSelection] = useState<string>(REPORT.runId);
  return createElement(ToastProvider, {
    children: createElement(DashboardClientProvider, {
      client,
      children: createElement(SavedArchiveWorkspace, {
        selection,
        view: "runs",
        actorId: "local-operator",
        onSelection: setSelection,
        onView: () => undefined,
      }),
    }),
  });
}

interface MountedArchive {
  readonly commands: readonly unknown[];
  readonly text: () => string;
  readonly click: (name: string) => Promise<void>;
  readonly unmount: () => Promise<void>;
}

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

async function settleFocusReturn(): Promise<void> {
  await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
}

async function mountArchive(options: {
  readonly file?: (runId: string, digest: string) => unknown;
  readonly result?: CommandResult;
  readonly rejectCommand?: boolean;
} = {}): Promise<MountedArchive> {
  let deleted = false;
  const commands: unknown[] = [];
  const client = stubClient({
    savedArchiveIndex: async () => {
      return SavedArchiveIndexWireSchema.parse({ items: [REPORT], next: null });
    },
    savedArchiveReport: async () => deleted ? DELETED_DETAIL : REPORT,
    savedArchiveFile: async (runId, digest) => (options.file?.(runId, digest) ?? {
      runId,
      digest,
      resource: { state: "missing", reason: "No attachment bytes were retained." },
    }) as SavedArchiveFileWire,
    executeCommand: async (request: unknown) => {
      commands.push(request);
      if (options.rejectCommand) throw new Error("Connection closed before the response arrived.");
      const result = options.result ?? APPLIED;
      if (result.state === "applied" || result.state === "already-applied") deleted = true;
      return result;
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => { root.render(createElement(ArchiveRoute, { client })); });
  await settle();

  const click = async (name: string): Promise<void> => {
    const matches = [...document.body.querySelectorAll("button")]
      .filter(button => (button.textContent ?? "").trim() === name);
    const target = matches[0];
    assert.equal(matches.length, 1, `expected one button named ${JSON.stringify(name)}`);
    assert.ok(target instanceof HTMLButtonElement);
    target.focus();
    await act(async () => { target.click(); });
    await settle();
  };

  const unmount = async (): Promise<void> => {
    if (mounted === root) mounted = undefined;
    await act(async () => { root.unmount(); });
  };

  return {
    commands,
    text: () => document.body.textContent ?? "",
    click,
    unmount,
  };
}

afterEach(async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) await act(async () => { root.unmount(); });
  document.body.replaceChildren();
});

describe("Saved Archive records presentation", () => {
  it("keeps active date filters visible while their fields are collapsed", () => {
    assert.equal(savedDateFilterSummary({ limit: 50 }), "");
    assert.equal(savedDateFilterSummary({
      limit: 50,
      from: "2026-08-01T00:00:00.000Z",
      capturedTo: "2026-08-31T23:59:59.999Z",
    }), "Completed from 2026-08-01, Captured through 2026-08-31");
  });

  it("shows the selected report facts and keeps its raw identity in a closed disclosure", async () => {
    const archive = await mountArchive();
    const article = document.querySelector('article[aria-label="Saved archive report"]');
    assert.ok(article instanceof HTMLElement);
    assert.match(article.textContent ?? "", /Synthetic retained report/u);
    assert.match(article.textContent ?? "", /removed-workflow/u);
    assert.match(article.textContent ?? "", /Outcome/u);
    assert.match(article.textContent ?? "", /Superseded/u);
    assert.match(article.textContent ?? "", /Saved record · read-only/u);
    assert.ok(article.querySelector("dl"), "structured report values remain a definition list");
    assert.ok(article.querySelector('table[aria-label="Retained work"]'));
    const identity = article.querySelector("details");
    assert.ok(identity instanceof HTMLDetailsElement);
    assert.equal(identity.open, false);
    assert.equal(identity.querySelectorAll("p").length, 1, "the raw run id stays the only value inside its disclosure");
    assert.equal(document.querySelector(`tr[aria-selected="true"] button[aria-pressed="true"]`)?.textContent?.trim(), REPORT.title);
    assert.ok(article.querySelector('a[download="archive-00000000-0000-4000-8000-000000000081.json"]'));
    await archive.unmount();
  });

  it("names the report and consequences before deletion; Cancel and Escape restore trigger focus", async () => {
    const archive = await mountArchive();
    const trigger = [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === "Delete saved report");
    assert.ok(trigger instanceof HTMLButtonElement);
    trigger.focus();
    await archive.click("Delete saved report");
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog instanceof HTMLElement);
    assert.match(dialog.textContent ?? "", /Delete Synthetic retained report\?/u);
    assert.match(dialog.textContent ?? "", /removed-workflow/u);
    assert.match(dialog.textContent ?? "", /transaction evidence/u);
    assert.match(dialog.textContent ?? "", /permanent idempotency keys/u);
    assert.match(dialog.textContent ?? "", /submit the same write again/u);
    assert.equal(archive.commands.length, 0, "opening confirmation must not issue the command");
    await archive.click("Cancel");
    await settleFocusReturn();
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.ok(document.activeElement === trigger, "Cancel must restore focus to the DialogTrigger");

    trigger.focus();
    await archive.click("Delete saved report");
    const openDialog = document.querySelector('[role="dialog"]');
    assert.ok(openDialog instanceof HTMLElement);
    await act(async () => {
      openDialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await settle();
    await settleFocusReturn();
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.ok(document.activeElement === trigger, "Escape must restore focus to the DialogTrigger");
    assert.equal(archive.commands.length, 0, "dismissal must not issue the command");
    await archive.unmount();
  });

  it("keeps refusals and unconfirmed responses inside the open dialog", async () => {
    const refused = await mountArchive({ result: REFUSED });
    await refused.click("Delete saved report");
    await refused.click("Delete this report");
    const refusalDialog = document.querySelector('[role="dialog"]');
    assert.ok(refusalDialog instanceof HTMLElement);
    assert.match(refusalDialog.querySelector('[role="alert"]')?.textContent ?? "", /fingerprint changed/u);
    assert.equal(refusalDialog.querySelectorAll('[role="alert"]').length, 1);
    assert.equal(document.querySelectorAll('[role="alert"]').length, 1, "the refusal has no duplicate alert outside its dialog");
    assert.equal(refused.commands.length, 1, "a refusal must not be retried");
    await refused.unmount();

    const unknown = await mountArchive({ rejectCommand: true });
    await unknown.click("Delete saved report");
    await unknown.click("Delete this report");
    const unknownDialog = document.querySelector('[role="dialog"]');
    assert.ok(unknownDialog instanceof HTMLElement);
    assert.match(unknownDialog.querySelector('[role="alert"]')?.textContent ?? "", /could not be confirmed/u);
    assert.match(unknownDialog.querySelector('[role="alert"]')?.textContent ?? "", /status is available/u);
    assert.equal(unknown.text().includes("Saved report deleted"), false, "an unconfirmed command cannot announce success");
    assert.equal(unknown.commands.length, 1, "an unconfirmed command is not automatically retried");
    await unknown.unmount();
  });

  it("shows deletion only after an applied command settlement", async () => {
    const archive = await mountArchive({ result: APPLIED });
    await archive.click("Delete saved report");
    await archive.click("Delete this report");
    assert.equal(archive.commands.length, 1);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.match(archive.text(), /Saved report deleted/u);
    await archive.unmount();
  });

  it("distinguishes missing, failed, and identity-mismatched retained attachments", async () => {
    const missing = await mountArchive();
    assert.match(document.querySelector('[aria-label="Saved archive report"]')?.textContent ?? "", /No attachment bytes were retained/u);
    await missing.unmount();

    const failed = await mountArchive({
      file: (runId, digest) => ({ runId, digest, resource: { state: "error", message: "Retained bytes failed verification." } }),
    });
    assert.match(document.querySelector('[aria-label="Saved archive report"]')?.textContent ?? "", /Retained bytes failed verification/u);
    await failed.unmount();

    const mismatched = await mountArchive({
      file: (_runId, digest) => ({ runId: "00000000-0000-4000-8000-000000009999", digest, resource: { state: "missing", reason: "Wrong run" } }),
    });
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /identity mismatch/u);
    await mismatched.unmount();
  });
});
