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
import { describe, it } from "vitest";
import { ArchiveEntryWireSchema } from "../../../src/domain/dashboard/archive.js";
import {
  archiveIdentityKey,
  archiveSweepFacts,
  archiveSweepName,
  archiveWorkflowCodes,
} from "../../../src/dashboard/surfaces/archive/archive-model.js";
import { FIXTURE_ARCHIVE_INDEX } from "../../parity/helpers/fixture-archive.js";

const SWEEP = FIXTURE_ARCHIVE_INDEX.sweeps[0];
const ENTRY = FIXTURE_ARCHIVE_INDEX.entries[0];

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

  it("carries the FULL identities the head's short codes stand in for (unit F10d finding 1)", () => {
    // Until this fix the only route to the unabbreviated identity was the
    // head's `title` — reachable by pointer and by nobody else. The row's
    // own ⓘ popover is built from this list, so the fact now has a route
    // that does not depend on a mouse.
    const facts = archiveSweepFacts(SWEEP);
    assert.equal(facts.includes("person-lookup v2"), true);
    // The exact same string `archiveSweepName`'s title carries — one source,
    // read twice, never two independent spellings of the same fact.
    const codes = archiveWorkflowCodes(FIXTURE_ARCHIVE_INDEX);
    assert.equal(archiveSweepName(SWEEP, codes).title.includes("person-lookup v2"), true);
  });
});
