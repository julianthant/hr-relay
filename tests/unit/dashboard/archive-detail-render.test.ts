/**
 * Two archived-run detail rows (unit F10c, ledger 3 AR150 and AR163) that only
 * the drawn tree can hold.
 *
 * AR150 is a REMOVAL, which is the hardest kind of row to pin: three counts
 * about the run — attempts, data facts, evidence facts — sat under a card
 * headed `Decision`, and each of them has an owner elsewhere on the same page
 * that derives its number from the FROZEN sections. Two sources for one fact
 * is the thing this bundle bans, and where a section was never frozen its
 * owner prints the REASON, which is a better answer than a number the archive
 * cannot corroborate. Nothing but an assertion about their absence can keep
 * them out.
 *
 * AR163 is the log line's shape: fixed clock and level columns so every
 * message starts on one x, and the level as a WORD so nothing is carried by
 * colour alone.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { ToastProvider } from "../../../src/dashboard/ds/ui.js";
import { NoteWireSchema } from "../../../src/domain/dashboard/run-detail.js";
import { ArchivedRunDetail, FrozenLogLine } from "../../../src/dashboard/surfaces/archive.js";
import {
  ARCHIVED_NOT_RUN_NOTE,
  archivedNotRunNote,
} from "../../../src/dashboard/surfaces/archive-model.js";
import {
  ArchivedRunDetailWireSchema,
  type ArchivedRunDetailWire,
} from "../../../src/domain/dashboard/archive.js";
import { FIXTURE_ARCHIVED_RUN, FIXTURE_ARCHIVE_INDEX } from "../../parity/helpers/fixture-archive.js";

const noop = (): void => undefined;
const unreadCapture = async () => ({
  runId: FIXTURE_ARCHIVED_RUN.runId,
  artifactId: FIXTURE_ARCHIVED_RUN.evidence.artifactIds[0],
  resource: { state: "missing" as const, reason: "test fixture has no bytes" },
});

function markup(): string {
  return renderToStaticMarkup(createElement(ToastProvider, {
    children: createElement(ArchivedRunDetail, {
      detail: FIXTURE_ARCHIVED_RUN,
      sweep: FIXTURE_ARCHIVE_INDEX.sweeps[0],
      codes: new Map<string, string>([["person-lookup@2", "pl"]]),
      busy: false,
      relaunched: false,
      refusal: undefined,
      onRelaunch: noop,
      onDelete: noop,
      onDismiss: noop,
      onReadCapture: unreadCapture,
    }),
  }));
}

describe("the Decision card (AR150)", () => {
  it("is still drawn, with the gate it is about", () => {
    assert.equal(markup().includes("Decision"), true);
  });

  it("borrows none of the run-wide counts its neighbours own", () => {
    const html = markup();
    for (const borrowed of ["data fact", "evidence fact"]) {
      assert.equal(html.includes(borrowed), false, `the Decision card still prints "${borrowed}"`);
    }
    // `attempt` survives as the Attempts card's own heading, so the negative
    // control has to be the COUNT sentence, not the word.
    assert.equal(/\d+ attempts?<\/span>/u.test(html), false);
  });

  it("still gives the Attempts card its own section", () => {
    assert.equal(markup().includes("Attempts"), true);
  });
});

describe("the sweep record card's name (unit F10d finding 1)", () => {
  it("pairs the full identity onto the accessible name, not just the pointer-only title", () => {
    // `archiveSweepName(sweep, codes)` for this fixture pair is
    // "pl v2 → 0.1.0" (text) / "Single workflow — person-lookup v2 → 0.1.0"
    // (title). Before this fix the full identity lived ONLY on `title`,
    // reachable by pointer and by nobody else — the third such row in this
    // directory. `aria-label` now carries the same string.
    const html = markup();
    const match = /<p class="[^"]*" title="([^"]*)" aria-label="([^"]*)">pl v2 → 0\.1\.0<\/p>/u.exec(html);
    assert.notEqual(match, null, `the sweep name <p> was not found as expected in:\n${html}`);
    const [, title, ariaLabel] = match ?? [];
    assert.equal(title, ariaLabel);
    assert.equal(title?.includes("person-lookup v2"), true);
  });
});

/*
 * D307 — the frozen timeline drew a note for a skipped step ONLY when its span
 * recorded a closed reason, and dropped the `absent` arm's served sentence. A
 * step that did not run then looked exactly like a step that ran: no note under
 * either. Both arms draw now, and this is the arm nobody would have written a
 * test for, because its absence is a blank rather than a wrong word.
 */
describe("a skipped step whose span recorded no reason (D307)", () => {
  const NO_REASON = "this step did not run; its span recorded no reason";

  function detailWithSkips(): ArchivedRunDetailWire {
    const timeline = FIXTURE_ARCHIVED_RUN.detail.timeline;
    return ArchivedRunDetailWireSchema.parse({
      ...FIXTURE_ARCHIVED_RUN,
      detail: {
        ...FIXTURE_ARCHIVED_RUN.detail,
        timeline: {
          ...timeline,
          events: [
            ...timeline.events,
            {
              noteId: "aa11bb22-0007-4000-8000-aa11bb220007",
              sequence: 2,
              at: FIXTURE_ARCHIVED_RUN.archivedAt,
              label: "Reconcile",
              state: "skipped",
              notRun: { state: "absent", reason: NO_REASON },
            },
            {
              noteId: "aa11bb22-0008-4000-8000-aa11bb220008",
              sequence: 3,
              at: FIXTURE_ARCHIVED_RUN.archivedAt,
              label: "Timecard",
              state: "skipped",
              notRun: { state: "present", reason: "step-omitted" },
            },
          ],
        },
      },
    });
  }

  function skipMarkup(): string {
    return renderToStaticMarkup(createElement(ToastProvider, {
      children: createElement(ArchivedRunDetail, {
        detail: detailWithSkips(),
        sweep: FIXTURE_ARCHIVE_INDEX.sweeps[0],
        codes: new Map<string, string>([["person-lookup@2", "pl"]]),
        busy: false,
        relaunched: false,
        refusal: undefined,
        onRelaunch: noop,
        onDelete: noop,
        onDismiss: noop,
        onReadCapture: unreadCapture,
      }),
    }));
  }

  it("draws the served absent reason beside the step that did not run", () => {
    assert.equal(
      skipMarkup().includes(NO_REASON),
      true,
      "the frozen page dropped the server's own sentence about why no reason is held",
    );
  });

  it("still draws the closed vocabulary when the span DID record a reason", () => {
    assert.equal(skipMarkup().includes(ARCHIVED_NOT_RUN_NOTE["step-omitted"]), true);
  });

  it("leaves a step that RAN with no note at all", () => {
    assert.equal(archivedNotRunNote(detailWithSkips().detail.timeline.events[0]), undefined);
  });
});

describe("the frozen log line (AR163)", () => {
  function line(level: "info" | "warning" | "error"): string {
    const note = NoteWireSchema.parse({
      noteId: "aa11bb22-0006-4000-8000-aa11bb220006",
      runId: FIXTURE_ARCHIVED_RUN.runId,
      sequence: 0,
      at: FIXTURE_ARCHIVED_RUN.archivedAt,
      level,
      message: "read the empl record beside the name",
    });
    return renderToStaticMarkup(createElement(FrozenLogLine, { note }));
  }

  it("sizes the level column for the LONGEST word this wire serves", () => {
    // The demo's 46px was sized for `warn`; this wire's enum says `warning`,
    // and the ported constant put the level on top of its own message. Nothing
    // but a screenshot saw it, so the width is pinned here.
    const longest = ["info", "warning", "error"].reduce((a, b) => (b.length > a.length ? b : a));
    assert.equal(longest, "warning");
    assert.equal(line("warning").includes("truncate"), false);
  });

  it("puts the clock and the level in fixed columns, so messages share one x", () => {
    const html = line("info");
    assert.equal(html.includes("w-[76px]"), true);
    assert.equal(html.includes("w-[72px]"), true);
  });

  it("draws the level column's SIZE from ds-text-caps alone (unit F10d finding 4)", () => {
    // `ds-text-meta` and `ds-text-caps` both set font-size and are unlayered
    // CSS classes (tokens.ts), so composing both let source order — not
    // intent — decide which size the column drew at. The class list may
    // carry only ONE of the two.
    const span = /<span class="([^"]*w-\[72px\][^"]*)">/u.exec(line("info"));
    assert.notEqual(span, null, "the level span was not found");
    const classes = (span?.[1] ?? "").split(/\s+/u);
    assert.equal(classes.includes("ds-text-caps"), true);
    assert.equal(classes.includes("ds-text-meta"), false, `the level column also carries ds-text-meta: ${span?.[1]}`);
  });

  it("prints the level as a WORD, so the tint is never its only carrier", () => {
    for (const level of ["info", "warning", "error"] as const) {
      assert.equal(line(level).includes(`>${level}<`), true);
    }
  });

  it("gives each level its own tint", () => {
    const tints = (["info", "warning", "error"] as const)
      .map((level) => /text-\[color:var\((--ds-[a-z-]+)\)\][^"]*">[a-z]+</u.exec(line(level))?.[1]);
    assert.equal(new Set(tints).size, 3, `two log levels resolved to one tint: ${tints.join(", ")}`);
  });
});

import { SavedArchiveReportWireSchema } from "../../../src/domain/dashboard/archive.js";
import { SavedArchiveReport } from "../../../src/dashboard/surfaces/archive-report.js";
import { FIXTURE_SAVED_REPORT } from "../../parity/helpers/fixture-archive.js";
it("renders every generic section without a current workflow and exposes no relaunch control", () => {
  const html = renderToStaticMarkup(createElement(SavedArchiveReport, { report: { ...FIXTURE_SAVED_REPORT, files: [] } }));
  for (const value of ["Saved facts", "Saved work", "Historical note", "No additional evidence was retained.", "Not recorded", "Synthetic person", "Verified", "Null"]) assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /Relaunch|Retry|Restart/);
  assert.doesNotMatch(markup(), /Relaunch on v/);
});

// H: the served saved-document renderer never mounts the retired live detail actions.
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";
it("renders captured resolution as text without a relaunch or resolution control", () => {
  const html = renderToStaticMarkup(createElement(SavedArchiveReport, { report: { ...H_REPORT, files: [] } }));
  assert.match(html, /Captured approval/u);
  assert.doesNotMatch(html, /relaunch-archived-run|Restart|Retry|Resolve|Approve/u);
  assert.match(html, /aria-label="Workflow details"/u);
});


describe("lossless frozen report presentation", () => {
  it("retains every section kind, field, order and scalar for an unregistered workflow", () => {
    const report = SavedArchiveReportWireSchema.parse({ ...H_REPORT, files: [], sections: [
      { kind: "values", title: "Unrecognized values", values: [
        { label: "Credential supplied to the report", value: "synthetic-complete-credential" },
        { label: "Employee ID", value: "10000023" },
        { label: "False", value: false }, { label: "Zero", value: 0 }, { label: "Null", value: null },
        { label: "Empty string", value: "" }, { label: "Empty list", value: [] }, { label: "Empty record", value: {} },
        { label: "Nested values", value: { unknown: [false, 0, null, ""] } },
      ] },
      { kind: "table", title: "Unrecognized table", columns: ["Unrecognized column"], rows: [["Complete table value"]] },
      { kind: "text", title: "Unrecognized note", text: "Complete note <script>unsafe()</script>" },
      { kind: "unavailable", title: "Unrecognized absence", reason: "Original retained absence" },
    ] });
    const before = JSON.stringify(report);
    const html = renderToStaticMarkup(createElement(SavedArchiveReport, { report }));
    for (const value of ["synthetic-complete-credential", "10000023", "No", ">0<", "Null", "&quot;&quot;", "Empty list", "Empty record", "Nested values", "Unrecognized column", "Complete table value", "Original retained absence", "&lt;script&gt;unsafe()&lt;/script&gt;"]) assert.ok(html.includes(value), value);
    const positions = ["Unrecognized values", "Unrecognized table", "Unrecognized note", "Unrecognized absence"].map(value => html.indexOf(value));
    assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]));
    assert.doesNotMatch(html, /<script>/u);
    assert.equal(JSON.stringify(report), before, "presentation must not rewrite sealed report inputs");
  });

  it("renders retained logs through the Logs section without executing retained text", () => {
    const html = renderToStaticMarkup(createElement(SavedArchiveReport, { report: { ...H_REPORT, files: [] }, section: H_REPORT.sections.length + 8 }));
    assert.match(html, /Review recorded/u);
    assert.match(html, /No live resolution is available/u);
    assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/u);
    assert.doesNotMatch(html, /<script>/u);
  });

  it("preserves unknown input/settings rows and captured metadata alongside complete values", () => {
    const report = SavedArchiveReportWireSchema.parse({ ...H_REPORT, files: [], sections: [
      { kind: "values", title: "Inputs & settings", values: [
        { label: "Submitted input", value: { eid: "10000023" } },
        { label: "Unknown frozen field", value: "Complete unknown value" },
        { label: "Parsed input", value: { eid: "10000023", missing: null } },
        { label: "Captured settings", value: { config: { credential: "complete-synthetic-value" }, revision: 17, capture: "Original metadata" } },
      ] },
    ] });
    const html = renderToStaticMarkup(createElement(SavedArchiveReport, { report }));
    for (const value of ["Submitted input", "Unknown frozen field", "Complete unknown value", "Parsed input", "10000023", "Null", "complete-synthetic-value", "revision", ">17<", "Original metadata"]) assert.ok(html.includes(value), value);
  });

  it("keeps legacy frozen fields outside the submitted/parsed inputs and unavailable settings metadata", () => {
    const report = SavedArchiveReportWireSchema.parse({ ...H_REPORT, files: [], sections: [
      { kind: "values", title: "Run and frozen inputs", values: [
        { label: "input.raw.eid", value: "10000023" },
        { label: "input.parsed.value.eid", value: "10000023" },
        { label: "unknown.original.path", value: "Original retained value" },
      ] },
      { kind: "values", title: "Inputs & settings", values: [
        { label: "Captured settings", value: { state: "unavailable", reason: "Original settings absence", extra: "Retained metadata", config: { supplied: "Retained despite unavailable state" } } },
      ] },
      { kind: "values", title: "Inputs & settings", values: [] },
    ] });
    const html = renderToStaticMarkup(createElement(SavedArchiveReport, { report }));
    for (const value of ["10000023", "unknown.original.path", "Original retained value", "Original settings absence", "Retained metadata", "Retained despite unavailable state", "Inputs &amp; settings"]) assert.ok(html.includes(value), value);
  });

});
