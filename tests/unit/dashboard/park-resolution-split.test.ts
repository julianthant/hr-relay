/**
 * One `banner` placement, TWO renderers — and no descriptor may reach both
 * (R8 finding 1).
 *
 * The two write resolutions ride the same placement as every other decision
 * pill, so before this split they were being drawn as bare `intentPill`s and
 * the server's `detail` sentence — the thing that separates "record it as
 * present" from "record it as absent", each of which settles a real HR write —
 * was dropped on the floor. `ParkResolutions` draws them as the demo's tinted
 * cards; `BannerActions` draws the rest.
 *
 * The property that matters is a PARTITION, not two independent filters: every
 * banner descriptor lands in exactly one of the two lists. A descriptor drawn
 * twice would offer the operator the same irreversible answer in two shapes,
 * and one drawn in neither would be a served exit with no control.
 *
 * These are pure functions over PARSED descriptors, so the fixture cannot drift
 * from what the server may serve.
 */
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { ActionDescriptorWireSchema } from "../../../src/domain/dashboard/actions.js";
import { bannerPills, parkResolutions } from "../../../src/dashboard/surfaces/actions-model.js";

/**
 * A parked run's banner as the `parked-write` section projects it: the two
 * resolutions, a non-park command that shares the placement, and a navigation
 * descriptor — plus one park resolution placed somewhere ELSE, which must not
 * be picked up by a `banner` reader at all.
 */
const ACTIONS = z.array(ActionDescriptorWireSchema).parse([
  {
    key: "resolve-write-present",
    label: "I found the write",
    detail: "Records the transaction as present. The run settles on it and nothing is submitted again.",
    intent: "success",
    placement: ["banner"],
    kind: "command",
    command: "resolve-write-present",
    expectedVersion: 4,
    confirm: { title: "Record it as present", body: "Settles this write.", confirmLabel: "Record present", tone: "neutral" },
    writeTarget: { writeIntentId: "3f2a6c18-4b21-4d7e-9a55-1c0e8b7d4f30", intentGeneration: 2 },
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
    writeTarget: { writeIntentId: "3f2a6c18-4b21-4d7e-9a55-1c0e8b7d4f30", intentGeneration: 2 },
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
    writeTarget: { writeIntentId: "3f2a6c18-4b21-4d7e-9a55-1c0e8b7d4f30", intentGeneration: 2 },
  },
]);

describe("the banner's park-resolution split", () => {
  it("hands the two write resolutions to ParkResolutions and nothing else", () => {
    expect(parkResolutions(ACTIONS).map((a) => a.key)).toEqual([
      "resolve-write-present",
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
    // The `menu` copy of `resolve-write-absent` is a real descriptor the row
    // context menu may draw; a `banner` reader that matched on the command
    // alone would pull it into the resolution cards.
    expect(parkResolutions(ACTIONS).map((a) => a.key)).not.toContain("resolve-write-absent-menu");
  });

  it("carries the SERVED detail sentence through, which is why these are cards", () => {
    expect(parkResolutions(ACTIONS).map((a) => a.detail)).toEqual([
      "Records the transaction as present. The run settles on it and nothing is submitted again.",
      "Unlocks a REAL second submit, so it has to clear the fence before it counts.",
    ]);
  });
});
