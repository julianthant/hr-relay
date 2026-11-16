import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { recordBrowserAction, withBrowserActionNotes } from "../../../../src/backend/systems/browser-shared/action-notes.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);
const AT = "2026-10-02T12:00:00.000Z";
const authority = { envelope: { runId: RUN, workflow: "onboarding", traceId: "fpo-120000-0002",
  contractFingerprint: HASH, attempt: 1 },
  createdAt: AT, updatedAt: AT, lifecycle: { state: "running" } } as unknown as RunRecord;

describe("browser action value admission", () => {
  const privateValue = "synthetic-private-action-proof";
  async function capture(target: string) {
    const lines: string[] = [];
    const clock = manualClock(new Date(AT));
    const writer = createNoteTimelineWriter({ clock, pid: 1,
      repository: { append: input => { lines.push(JSON.stringify(input)); return {} as never; } } });
    let note: ReturnType<typeof writer.emitRunAction> | undefined;
    await withBrowserActionNotes(clock, async () => { recordBrowserAction("typed", target, privateValue); },
      actions => { for (const action of actions) note = writer.emitRunAction({ workflow: authority.envelope.workflow,
        address: { runId: RUN, attempt: 1, traceId: authority.envelope.traceId, spanPath: "first" }, action }, authority); });
    assert.ok(note);
    return { note, lines };
  }

  for (const target of ["ucpath.smart-hr.details-eid-input", "unregistered.private", "ucpath.person-org.eid-input", "kuali.action-list.search-input"]) {
    it(`never writes the raw typed value for ${target}`, async () => {
      const h = await capture(target);
      assert.equal(h.lines.join("").includes(privateValue), false);
      assert.equal(h.note.action?.value, undefined);
      assert.equal(h.note.action?.targetId, target);
    });
  }
});
