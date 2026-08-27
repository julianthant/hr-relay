/**
 * Track F's archive facts are presentation over frozen wire values. These
 * tests pin every union arm and enum fold in the plain sibling model so the
 * React surface cannot recover a raw transport word or an invented fallback.
 */
import { describe, expect, it } from "vitest";
import { ArchivedRunDetailWireSchema } from "../../../src/domain/dashboard/archive.js";
import { RunWarningsWireSchema } from "../../../src/domain/dashboard/projection.js";
import {
  ARCHIVED_CAPTURE_VIEWER_NOTE,
  BUMP_KIND_LABEL,
  archiveBumpKind,
  archivedCaptureFacts,
  archivePriorityTone,
  archiveStatusLabel,
  archiveSweepVersionRange,
  archiveWarningChip,
  archivedRelaunchCautions,
  archivedRelaunchHeadline,
  archivedRunHeading,
  blockerStatusOf,
} from "../../../src/dashboard/surfaces/archive-model.js";
import {
  FIXTURE_ARCHIVED_RUN,
  FIXTURE_ARCHIVE_INDEX,
} from "../../parity/helpers/fixture-archive.js";

describe("archive index facts", () => {
  it("keeps warning presence and absence distinct", () => {
    expect(archiveWarningChip(RunWarningsWireSchema.parse({
      state: "present",
      count: 3,
      first: "CRM returned a stale session on attempt 1",
    }))).toEqual({
      state: "present",
      count: 3,
      title: "CRM returned a stale session on attempt 1",
    });
    expect(archiveWarningChip(RunWarningsWireSchema.parse({
      state: "absent",
      reason: "this run's evidence receipt records no warning",
    }))).toEqual({
      state: "absent",
      reason: "this run's evidence receipt records no warning",
    });
  });

  it("labels every queue status through the design-system vocabulary", () => {
    expect({
      queued: archiveStatusLabel("queued"),
      running: archiveStatusLabel("running"),
      blocked: archiveStatusLabel("blocked"),
      "awaiting-approval": archiveStatusLabel("awaiting-approval"),
      done: archiveStatusLabel("done"),
      failed: archiveStatusLabel("failed"),
      cancelled: archiveStatusLabel("cancelled"),
      partial: archiveStatusLabel("partial"),
    }).toEqual({
      queued: "Queued",
      running: "Running",
      blocked: "Write parked",
      "awaiting-approval": "Review",
      done: "Done",
      failed: "Failed",
      cancelled: "Cancelled",
      partial: "Done with warnings",
    });
  });

  it("keeps the done and partial filter labels visibly distinct", () => {
    expect([
      archiveStatusLabel("done"),
      archiveStatusLabel("partial"),
    ]).toEqual(["Done", "Done with warnings"]);
  });
});

describe("archived detail identity and relaunch facts", () => {
  it("uses a served display name and subtitle, with only the title's verified fallback", () => {
    const renamed = {
      ...FIXTURE_ARCHIVED_RUN.row,
      displayName: { state: "present", value: "Tomás Rivera" },
      subtitle: { state: "present", value: "EMPL 7 · Employee" },
    } as const;
    expect(archivedRunHeading(renamed)).toEqual({
      title: "Tomás Rivera",
      subtitle: { state: "present", value: "EMPL 7 · Employee" },
    });
    expect(archivedRunHeading(FIXTURE_ARCHIVED_RUN.row)).toEqual({
      title: "EID 10873698",
      subtitle: { state: "absent", reason: "the start plan proposed no subtitle" },
    });
  });

  it("folds both priorities without a default", () => {
    expect(archivePriorityTone("interactive")).toBe("info");
    expect(archivePriorityTone("bulk")).toBe("neutral");
  });

  it("derives only the relaunch cautions the frozen row proves", () => {
    expect(archivedRelaunchCautions(FIXTURE_ARCHIVED_RUN.row)).toEqual([]);
    expect(archivedRelaunchCautions({
      dryRun: true,
      resolvedInstances: [
        { system: "ucpath", instance: "test" },
        { system: "crm", instance: "prod" },
      ],
    })).toEqual([
      "The archived run was a DRY RUN. The fresh run is not — it will write for real.",
      "The archived run targeted the TEST instance of ucpath. The fresh run resolves its instances again; it does not reuse that target.",
    ]);
  });

  it("names an applied relaunch from the available arm and refuses the impossible arm", () => {
    expect(archivedRelaunchHeadline(FIXTURE_ARCHIVED_RUN)).toBe(
      "New Person Lookup run enqueued on v2",
    );
    const unavailable = ArchivedRunDetailWireSchema.parse({
      ...FIXTURE_ARCHIVED_RUN,
      relaunch: { state: "unavailable", reason: "the workflow is no longer registered" },
    });
    expect(() => archivedRelaunchHeadline(unavailable)).toThrow(
      /cannot show an applied relaunch banner.*workflow is no longer registered/u,
    );
  });
});

describe("version-bump labels", () => {
  const sweep = FIXTURE_ARCHIVE_INDEX.sweeps[0];

  it("folds both recorded kinds and the read-forward absence", () => {
    expect(archiveBumpKind(sweep.changeRecord)).toEqual({
      state: "present",
      kind: "major",
      label: BUMP_KIND_LABEL.major,
      tone: "warning",
    });
    expect(archiveBumpKind({
      state: "present",
      value: {
        kind: "minor",
        what: "the label changed",
        why: "the operator wording became clearer",
        commit: { state: "absent", reason: "no commit was named" },
      },
    })).toEqual({
      state: "present",
      kind: "minor",
      label: BUMP_KIND_LABEL.minor,
      tone: "neutral",
    });
    expect(archiveBumpKind({ state: "absent", reason: "this sweep predates change records" })).toEqual({
      state: "absent",
      reason: "this sweep predates change records",
    });
  });

  it("names frozen source versions and preserves the archived-nothing arm", () => {
    expect(archiveSweepVersionRange(sweep)).toEqual({ state: "present", text: "v1 → 0.1.0" });
    expect(archiveSweepVersionRange({ ...sweep, fromVersions: [] })).toEqual({
      state: "absent",
      target: "0.1.0",
      reason: "archived nothing, so no from-version",
    });
  });

  it("maps every non-terminal authority state and fails loud for terminal", () => {
    expect({
      queued: blockerStatusOf("queued"),
      claimed: blockerStatusOf("claimed"),
      validating: blockerStatusOf("validating"),
      running: blockerStatusOf("running"),
      "parked-gate": blockerStatusOf("parked-gate"),
      "parked-write": blockerStatusOf("parked-write"),
    }).toEqual({
      queued: "queued",
      claimed: "running",
      validating: "running",
      running: "running",
      "parked-gate": "waiting",
      "parked-write": "parked",
    });
    expect(() => blockerStatusOf("terminal")).toThrow(/terminal run is archivable/u);
  });
});

describe("the archived capture viewer (D274 item 10)", () => {
  const tile = (() => {
    const sections = FIXTURE_ARCHIVED_RUN.sections;
    if (sections.state !== "present" || sections.value.captures.state !== "present") {
      throw new Error("the archived fixture must freeze at least one capture tile");
    }
    return sections.value.captures.value[0];
  })();

  it("prints every fact the frozen tile holds, in reading order", () => {
    expect(archivedCaptureFacts(tile).map((fact) => fact.label)).toEqual([
      "Kind",
      "Media type",
      "Size",
      "Pixel size",
      "Step",
      "System",
      "Why it was captured",
      "Sensitivity",
      "Digest",
      "Artifact",
      "Bundle",
    ]);
    expect(archivedCaptureFacts(tile).filter((fact) => fact.state === "present").map((fact) => fact.value))
      .toEqual([
        "screenshot",
        "image/png",
        "180 KB (184320 bytes)",
        "1440 × 900",
        "cross-verify",
        "crm",
        "failure",
        "redacted",
        tile.digest,
        tile.artifactId,
        tile.bundleId,
      ]);
  });

  it("keeps an absent step, system and pixel size as three DIFFERENT reasons", () => {
    const facts = archivedCaptureFacts({
      ...tile,
      dimensions: undefined,
      kind: "network-summary",
      mediaType: "application/json",
      step: { state: "absent", reason: "the bundle's origin failure names no node" },
      system: { state: "absent", reason: "the origin failure names no step, so no store declares a system" },
    });
    const absent = facts.filter((fact) => fact.state === "absent");
    expect(absent.map((fact) => [fact.label, fact.reason])).toEqual([
      ["Pixel size", "this capture is not an image, so it has no pixel size"],
      ["Step", "the bundle's origin failure names no node"],
      ["System", "the origin failure names no step, so no store declares a system"],
    ]);
    // never a dash and never an empty string standing in for two facts
    expect(absent.every((fact) => fact.reason.trim().length > 0)).toBe(true);
  });

  it("never claims the bytes are still there, or gone", () => {
    const words = [
      ARCHIVED_CAPTURE_VIEWER_NOTE,
      ...archivedCaptureFacts(tile).map((fact) => (fact.state === "present" ? fact.value : fact.reason)),
    ].join(" ").toLowerCase();
    expect(words).not.toContain("purged");
    expect(ARCHIVED_CAPTURE_VIEWER_NOTE).toContain("POINTER");
  });
});
