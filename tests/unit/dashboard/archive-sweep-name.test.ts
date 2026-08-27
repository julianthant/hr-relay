/**
 * The sweep head's NAME and the codes it joins against (unit F10c, ledger 3
 * AR80/AR82/AR84/AR90).
 *
 * The head printed `person-lookup v2 → 0.1.0` where the demo prints `pl v2 →
 * 0.1.0`, and its `title` repeated that same string — a tooltip equal to its
 * own cell is a no-op. Neither is a rename: `ArchiveSweepWire.appliedIdentities`
 * carries no code at all, so the codes are a JOIN, and the interesting part is
 * that they come from two places with two different meanings. The negative
 * control that matters here is the one that would pass for the wrong reason —
 * a code carried across a version it was never true at — so the version half
 * of the key is asserted directly.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { ArchiveEntryWireSchema } from "../../../src/domain/dashboard/archive.js";
import { ArchiveTable } from "../../../src/dashboard/surfaces/archive.js";
import {
  archiveIdentityKey,
  archiveSweepFacts,
  archiveSweepName,
  archiveWorkflowCodes,
  type ArchiveSection,
} from "../../../src/dashboard/surfaces/archive-model.js";
import { FIXTURE_ARCHIVE_INDEX } from "../../parity/helpers/fixture-archive.js";

const SWEEP = FIXTURE_ARCHIVE_INDEX.sweeps[0];
const ENTRY = FIXTURE_ARCHIVE_INDEX.entries[0];
const noop = (): void => undefined;

describe("archiveWorkflowCodes", () => {
  it("answers the identity a sweep moved runs ONTO from the registry row", () => {
    const codes = archiveWorkflowCodes(FIXTURE_ARCHIVE_INDEX);
    const identity = SWEEP.appliedIdentities[0];
    assert.equal(codes.get(archiveIdentityKey(identity.workflowId, identity.descriptorVersion)), "pl");
  });

  it("answers the identity a run RAN from that run's frozen code", () => {
    const codes = archiveWorkflowCodes(FIXTURE_ARCHIVE_INDEX);
    assert.equal(
      codes.get(archiveIdentityKey(ENTRY.workflowId, ENTRY.archivedIdentity.descriptorVersion)),
      "pl",
    );
  });

  it("never carries a code across a version it was not true at", () => {
    // The fixture's registry is at v2 and its archived run at v1; nothing in
    // this index says anything about v7, and the fold may not invent it from
    // the workflow id alone. This is the arm a plain `workflowId → code` map
    // would fail, and it is the whole reason the key is a PAIR.
    const codes = archiveWorkflowCodes(FIXTURE_ARCHIVE_INDEX);
    assert.equal(codes.get(archiveIdentityKey("person-lookup", 7)), undefined);
  });

  it("lets the archive's frozen copy win over the registry at one identity", () => {
    const codes = archiveWorkflowCodes({
      versionState: [{ ...FIXTURE_ARCHIVE_INDEX.versionState[0], workflowCode: "zz" }],
      entries: [{
        ...ENTRY,
        archivedIdentity: ArchiveEntryWireSchema.parse({ ...ENTRY, archivedIdentity: { ...ENTRY.archivedIdentity, descriptorVersion: 2 } }).archivedIdentity,
        workflowCode: { state: "present", value: "pl" },
      }],
    });
    assert.equal(codes.get(archiveIdentityKey("person-lookup", 2)), "pl");
  });

  it("carries no entry whose code was never frozen", () => {
    const codes = archiveWorkflowCodes({
      versionState: [],
      entries: [{ ...ENTRY, workflowCode: { state: "absent", reason: "planned before D242" } }],
    });
    assert.equal(codes.size, 0);
  });
});

describe("archiveSweepName", () => {
  it("prints the short code, and degrades to the workflow ID when none was frozen", () => {
    const codes = archiveWorkflowCodes(FIXTURE_ARCHIVE_INDEX);
    assert.equal(archiveSweepName(SWEEP, codes).text, "pl v2 → 0.1.0");
    assert.equal(
      archiveSweepName(SWEEP, new Map<string, string>()).text,
      "person-lookup v2 → 0.1.0",
    );
  });

  it("carries a SECOND fact on the hover, never a copy of its own cell (AR82)", () => {
    const codes = archiveWorkflowCodes(FIXTURE_ARCHIVE_INDEX);
    const name = archiveSweepName(SWEEP, codes);
    assert.notEqual(name.title, name.text);
    // the scope sentence, then the ids the codes stand in for
    assert.equal(name.title, "Single workflow — person-lookup v2 → 0.1.0");
  });
});

describe("the sweep head draws the joined name", () => {
  function markup(codes: ReadonlyMap<string, string>): string {
    const section: ArchiveSection = {
      sweep: SWEEP,
      applicationId: SWEEP.applicationId,
      entries: [ENTRY],
    };
    return renderToStaticMarkup(createElement(ArchiveTable, {
      sections: [section],
      codes,
      query: { text: "", workflowId: "all", status: "all", instance: "all", sort: "when", dir: "desc" },
      onSort: noop,
      collapsed: new Set<string>(),
      onToggleSection: noop,
      selectedRunId: undefined,
      onSelect: noop,
    }));
  }

  it("puts the code in the cell and the scope on the title", () => {
    const html = markup(archiveWorkflowCodes(FIXTURE_ARCHIVE_INDEX));
    assert.equal(html.includes(">pl v2 → 0.1.0<"), true);
    assert.equal(html.includes('title="Single workflow — person-lookup v2 → 0.1.0"'), true);
  });

  it("truncates the sweep id in the trace column", () => {
    const html = markup(archiveWorkflowCodes(FIXTURE_ARCHIVE_INDEX));
    assert.equal(html.includes(SWEEP.applicationId.slice(0, 8)), true);
    // the whole id is NOT in the cell — that is what AR84's fold recovers
    assert.equal(html.includes(`>${SWEEP.applicationId}<`), false);
  });
});

describe("archiveSweepFacts", () => {
  it("states the WHOLE sweep id, so the trace cell's title is not its only route (AR84)", () => {
    const facts = archiveSweepFacts(SWEEP);
    assert.equal(facts.includes(`sweep ${SWEEP.applicationId}`), true);
  });

  it("names the archived-nothing case rather than printing an empty range", () => {
    const facts = archiveSweepFacts({ ...SWEEP, archivedCount: 0, fromVersions: [] });
    assert.equal(facts.includes("archived nothing, so no from-version"), true);
    assert.equal(facts.includes("0 runs archived"), true);
  });
});
