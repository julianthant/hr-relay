import type { ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { deepFreeze } from "../validation/immutability.js";

/** The startup steps that can hold one person; a machine-wide failure stops startup instead and is never a person's standing. */
export const STARTUP_STEPS = deepFreeze([
  "repair", "upgrade-inspection", "upgrade", "upgrade-readback", "settings-upgrade", "duo-reenrol", "crash-recovery",
] as const);
export type StartupStep = (typeof STARTUP_STEPS)[number];

export type HeldStartupStanding = {
  readonly standing: "held";
  readonly step: StartupStep;
  /** The sign-in refusal code, chosen where the hold is written. */
  readonly code: ErrorCatalogCode;
  readonly cause: unknown;
};
/** One person's startup standing for one runtime lifetime. Nothing is stored. */
export type PersonStartupStanding =
  | { readonly standing: "unchecked" }
  | { readonly standing: "open" }
  | HeldStartupStanding;
export const PERSON_STARTUP_STANDINGS = deepFreeze(["unchecked", "open", "held"] as const satisfies readonly PersonStartupStanding["standing"][]);
export const UNCHECKED_STARTUP_STANDING: PersonStartupStanding = deepFreeze({ standing: "unchecked" } as const);
export const OPEN_STARTUP_STANDING: PersonStartupStanding = deepFreeze({ standing: "open" } as const);

export type PersonStartupEvent =
  | { readonly type: "inspected" }
  /** The automatic restore, or the projection rebuild and its re-inspection, succeeded. */
  | { readonly type: "repaired" }
  /** The readback after an upgrade proved the current schema. */
  | { readonly type: "upgrade-read-back" }
  | { readonly type: "settings-upgraded" }
  | { readonly type: "step-failed"; readonly step: StartupStep; readonly code: ErrorCatalogCode; readonly cause: unknown };
export type PersonStartupEventKey = Exclude<PersonStartupEvent["type"], "step-failed"> | `failed:${StartupStep}`;
export const PERSON_STARTUP_EVENT_KEYS = deepFreeze([
  "inspected", "repaired", "upgrade-read-back", "settings-upgraded",
  ...STARTUP_STEPS.map(step => `failed:${step}` as const),
] as const satisfies readonly PersonStartupEventKey[]);

export type PersonStartupRefusal = "already-held";
export type PersonStartupTransition = { readonly state: PersonStartupStanding } | { readonly refused: PersonStartupRefusal };

/** `hold` writes the failed step and its code; `keep` leaves the earlier hold in place. */
type Outcome = "open" | "hold" | "keep" | PersonStartupRefusal;
type Row = Record<Exclude<PersonStartupEvent["type"], "step-failed">, "open" | PersonStartupRefusal>
  & Record<`failed:${StartupStep}`, "hold" | "keep" | PersonStartupRefusal>;
const NOT_HELD_ROW = {
  inspected: "open", repaired: "open", "upgrade-read-back": "open", "settings-upgraded": "open",
  "failed:repair": "hold", "failed:upgrade-inspection": "hold", "failed:upgrade": "hold", "failed:upgrade-readback": "hold",
  "failed:settings-upgrade": "hold", "failed:duo-reenrol": "hold", "failed:crash-recovery": "hold",
} as const satisfies Row;

/**
 * Startup inspects every registered person again on each run in a lifetime, so a passing inspection, repair or upgrade
 * readback reopens a held person (F1). An upgrade step keeps the first hold; a repair refusal or an unproved Duo
 * re-enrolment replaces it. The settings upgrade and crash recovery skip held people, so a hold there is refused.
 */
export const PERSON_STARTUP_TRANSITIONS = deepFreeze({
  unchecked: NOT_HELD_ROW,
  open: NOT_HELD_ROW,
  held: {
    inspected: "open", repaired: "open", "upgrade-read-back": "open", "settings-upgraded": "already-held",
    "failed:repair": "hold", "failed:upgrade-inspection": "keep", "failed:upgrade": "keep", "failed:upgrade-readback": "keep",
    "failed:settings-upgrade": "already-held", "failed:duo-reenrol": "hold", "failed:crash-recovery": "already-held",
  },
} as const satisfies Record<PersonStartupStanding["standing"], Row & Record<PersonStartupEventKey, Outcome>>);

const OPEN_TRANSITION = deepFreeze({ state: OPEN_STARTUP_STANDING });

export function personStartupTransition(standing: PersonStartupStanding, event: PersonStartupEvent): PersonStartupTransition {
  const row = PERSON_STARTUP_TRANSITIONS[standing.standing];
  if (event.type !== "step-failed") {
    const outcome = row[event.type];
    return outcome === "open" ? OPEN_TRANSITION : { refused: outcome };
  }
  const outcome = row[`failed:${event.step}`];
  if (outcome === "keep") return { state: standing };
  if (outcome !== "hold") return { refused: outcome };
  // Shallow freeze: the cause is the step's own error, which is thrown and logged later.
  return { state: Object.freeze({ standing: "held" as const, step: event.step, code: event.code, cause: event.cause }) };
}

export class PersonStartupStandingRefusedError extends Error {
  constructor(readonly refused: PersonStartupRefusal, readonly standing: PersonStartupStanding["standing"], readonly event: PersonStartupEvent["type"]) {
    super(`person-startup-standing-${refused}: ${standing} + ${event}`);
    this.name = "PersonStartupStandingRefusedError";
  }
}
