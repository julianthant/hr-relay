
import { describe,expect,it } from "vitest";
import { z } from "zod";
import { bannerPills,parkResolutions } from "../../../../../src/dashboard/surfaces/shared/actions/actions-model.js";
import { ActionDescriptorWireSchema } from "../../../../../src/models/dashboard/actions.js";


const ACTIONS = z.array(ActionDescriptorWireSchema).parse([
  {
    key: "recheck-write",
    label: "I found the write",
    detail: "Records the transaction as present. The run settles on it and nothing is submitted again.",
    intent: "success",
    placement: ["banner"],
    kind: "command",
    command: "recheck-write",
    expectedVersion: 4,
    confirm: { title: "Record it as present", body: "Settles this write.", confirmLabel: "Record present", tone: "neutral" },
    writeTarget: { writeIntentId: "3f2a6c18-4b21-4d7e-9a55-1c0e8b7d4f30", intentGeneration: 2, writeAttemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bindingProofDigest: "a".repeat(64), occurrenceKeyDigest: "b".repeat(64) },
  },
  {
    key: "resolve-write-absent",
    label: "I found nothing",
    detail: "Unlocks a REAL second submit, so it has to clear the fence before it counts.",
    intent: "destructive",
    placement: ["banner"],
    kind: "command",
    command: "resolve-write-absent",
    expectedVersion: 4,
    confirm: { title: "Record it as absent", body: "Unlocks a second submit.", confirmLabel: "Record absent", tone: "destructive" },
    writeTarget: { writeIntentId: "3f2a6c18-4b21-4d7e-9a55-1c0e8b7d4f30", intentGeneration: 2, writeAttemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bindingProofDigest: "a".repeat(64), occurrenceKeyDigest: "b".repeat(64) },
  },
  {
    key: "cancel",
    label: "Cancel this run",
    intent: "destructive",
    placement: ["banner", "menu"],
    kind: "command",
    command: "cancel",
    expectedVersion: 4,
  },
  {
    key: "open-run",
    label: "Open the run",
    intent: "neutral",
    placement: ["banner"],
    kind: "navigation",
    navigate: { kind: "self" },
  },
  {
    key: "resolve-write-absent-menu",
    label: "I found nothing",
    intent: "destructive",
    placement: ["menu"],
    kind: "command",
    command: "resolve-write-absent",
    expectedVersion: 4,
    confirm: { title: "Record it as absent", body: "Unlocks a second submit.", confirmLabel: "Record absent", tone: "destructive" },
    writeTarget: { writeIntentId: "3f2a6c18-4b21-4d7e-9a55-1c0e8b7d4f30", intentGeneration: 2, writeAttemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bindingProofDigest: "a".repeat(64), occurrenceKeyDigest: "b".repeat(64) },
  },
]);

describe("the banner's park-resolution split", () => {
  it("hands the two write resolutions to ParkResolutions and nothing else", () => {
    expect(parkResolutions(ACTIONS).map((a) => a.key)).toEqual([
      "recheck-write",
      "resolve-write-absent",
    ]);
  });

  it("keeps the write resolutions OUT of the banner pills", () => {
    expect(bannerPills(ACTIONS).map((a) => a.key)).toEqual(["cancel", "open-run"]);
  });

  it("partitions the banner placement — every descriptor in exactly one list", () => {
    const pills = bannerPills(ACTIONS).map((a) => a.key);
    const resolutions = parkResolutions(ACTIONS).map((a) => a.key);
    const banner = ACTIONS.filter((a) => a.placement.includes("banner")).map((a) => a.key);
    expect([...pills, ...resolutions].sort()).toEqual([...banner].sort());
    expect(pills.filter((key) => resolutions.includes(key))).toEqual([]);
  });

  it("reads the PLACEMENT, not just the command — a park verb elsewhere is not a banner resolution", () => {

    expect(parkResolutions(ACTIONS).map((a) => a.key)).not.toContain("resolve-write-absent-menu");
  });

  it("carries the SERVED detail sentence through, which is why these are cards", () => {
    expect(parkResolutions(ACTIONS).map((a) => a.detail)).toEqual([
      "Records the transaction as present. The run settles on it and nothing is submitted again.",
      "Unlocks a REAL second submit, so it has to clear the fence before it counts.",
    ]);
  });
});
