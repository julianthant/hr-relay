import { describe, expect, it } from "vitest";
import {
  OPEN_STARTUP_STANDING,
  PERSON_STARTUP_EVENT_KEYS,
  PERSON_STARTUP_STANDINGS,
  PERSON_STARTUP_TRANSITIONS,
  personStartupTransition,
  STARTUP_STEPS,
  UNCHECKED_STARTUP_STANDING,
  type PersonStartupEvent,
  type PersonStartupEventKey,
  type PersonStartupStanding,
  type StartupStep,
} from "../../../src/rules/storage/person-startup-standing.js";

const cause = new Error("synthetic-startup-refusal");
const earlierCause = new Error("synthetic-earlier-refusal");
const HELD: PersonStartupStanding = { standing: "held", step: "upgrade", code: "STORAGE_PROFILE_UPGRADE_REFUSED", cause: earlierCause };
const standings: Record<PersonStartupStanding["standing"], PersonStartupStanding> = {
  unchecked: UNCHECKED_STARTUP_STANDING,
  open: OPEN_STARTUP_STANDING,
  held: HELD,
};

const CODES: Record<StartupStep, PersonStartupEvent & { type: "step-failed" }> = {
  repair: { type: "step-failed", step: "repair", code: "STORAGE_AUTOMATIC_REPAIR_REFUSED", cause },
  "upgrade-inspection": { type: "step-failed", step: "upgrade-inspection", code: "STORAGE_PROFILE_UPGRADE_REFUSED", cause },
  upgrade: { type: "step-failed", step: "upgrade", code: "STORAGE_PROFILE_UPGRADE_UNRESOLVED_WRITES", cause },
  "upgrade-readback": { type: "step-failed", step: "upgrade-readback", code: "STORAGE_PROFILE_UPGRADE_REFUSED", cause },
  "settings-upgrade": { type: "step-failed", step: "settings-upgrade", code: "PROFILE_STARTUP_CONVERSION_REFUSED", cause },
  "duo-reenrol": { type: "step-failed", step: "duo-reenrol", code: "PROFILE_DUO_REENROL_UNCERTAIN", cause },
  "crash-recovery": { type: "step-failed", step: "crash-recovery", code: "STARTUP_CRASH_RECOVERY_REFUSED", cause },
};
const events: Record<PersonStartupEventKey, PersonStartupEvent> = {
  inspected: { type: "inspected" },
  repaired: { type: "repaired" },
  "upgrade-read-back": { type: "upgrade-read-back" },
  "settings-upgraded": { type: "settings-upgraded" },
  "failed:repair": CODES.repair,
  "failed:upgrade-inspection": CODES["upgrade-inspection"],
  "failed:upgrade": CODES.upgrade,
  "failed:upgrade-readback": CODES["upgrade-readback"],
  "failed:settings-upgrade": CODES["settings-upgrade"],
  "failed:duo-reenrol": CODES["duo-reenrol"],
  "failed:crash-recovery": CODES["crash-recovery"],
};

/** Written by hand from the startup write sites in storage-compose.ts; it is the specification the table must reproduce. */
const OPEN = { state: OPEN_STARTUP_STANDING };
const ALREADY_HELD = { refused: "already-held" };
const heldAt = (step: StartupStep) => ({ state: { standing: "held", step, code: CODES[step].code, cause } });
const KEEP = { state: HELD };
const NOT_HELD_ROW = {
  inspected: OPEN, repaired: OPEN, "upgrade-read-back": OPEN, "settings-upgraded": OPEN,
  "failed:repair": heldAt("repair"), "failed:upgrade-inspection": heldAt("upgrade-inspection"), "failed:upgrade": heldAt("upgrade"),
  "failed:upgrade-readback": heldAt("upgrade-readback"), "failed:settings-upgrade": heldAt("settings-upgrade"),
  "failed:duo-reenrol": heldAt("duo-reenrol"), "failed:crash-recovery": heldAt("crash-recovery"),
};
const expected: Record<PersonStartupStanding["standing"], Record<PersonStartupEventKey, unknown>> = {
  unchecked: NOT_HELD_ROW,
  open: NOT_HELD_ROW,
  held: {
    // A later startup in the same lifetime inspects every registered person again and reopens one whose store now passes.
    inspected: OPEN, repaired: OPEN,
    // F1: the upgrade readback reopens a person held at any step.
    "upgrade-read-back": OPEN,
    "settings-upgraded": ALREADY_HELD,
    // A repair refusal and an unproved Duo re-enrolment replace the hold; an upgrade step keeps the first hold.
    "failed:repair": heldAt("repair"), "failed:duo-reenrol": heldAt("duo-reenrol"),
    "failed:upgrade-inspection": KEEP, "failed:upgrade": KEEP, "failed:upgrade-readback": KEEP,
    "failed:settings-upgrade": ALREADY_HELD, "failed:crash-recovery": ALREADY_HELD,
  },
};

describe("person startup standing", () => {
  it("declares every standing, step and event the table covers", () => {
    expect(PERSON_STARTUP_STANDINGS).toEqual(["unchecked", "open", "held"]);
    expect(STARTUP_STEPS).toEqual(["repair", "upgrade-inspection", "upgrade", "upgrade-readback", "settings-upgrade", "duo-reenrol", "crash-recovery"]);
    expect(PERSON_STARTUP_EVENT_KEYS).toEqual(Object.keys(events));
    expect(Object.keys(PERSON_STARTUP_TRANSITIONS)).toEqual(PERSON_STARTUP_STANDINGS);
    for (const standing of PERSON_STARTUP_STANDINGS) expect(Object.keys(PERSON_STARTUP_TRANSITIONS[standing])).toEqual(PERSON_STARTUP_EVENT_KEYS);
    expect(Object.isFrozen(PERSON_STARTUP_TRANSITIONS.held)).toBe(true);
  });

  for (const standing of PERSON_STARTUP_STANDINGS) for (const key of PERSON_STARTUP_EVENT_KEYS) {
    it(`${standing} + ${key}`, () => {
      expect(personStartupTransition(standings[standing], events[key])).toEqual(expected[standing][key]);
    });
  }

  it("keeps the first upgrade hold as the same standing, with its own code and cause", () => {
    const next = personStartupTransition(HELD, CODES["upgrade-readback"]);
    expect("state" in next && next.state).toBe(HELD);
  });

  it("returns frozen standings that carry the step's error as their cause", () => {
    const next = personStartupTransition(UNCHECKED_STARTUP_STANDING, CODES["crash-recovery"]);
    if (!("state" in next) || next.state.standing !== "held") throw new Error("expected a crash-recovery hold");
    expect(Object.isFrozen(next.state)).toBe(true);
    expect(next.state.cause).toBe(cause);
    expect(Object.isFrozen(cause)).toBe(false);
    expect(Object.isFrozen(OPEN_STARTUP_STANDING) && Object.isFrozen(UNCHECKED_STARTUP_STANDING)).toBe(true);
  });
});
