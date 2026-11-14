import { deepFreeze } from "../validation/immutability.js";
import { WriteParkCodeSchema, type WriteParkCode } from "./write-safety-primitives.js";
import {
  ParkedWriteResolutionBindingSchema,
  type ParkedWriteResolutionBinding,
  type WriteAttemptRecord,
  type WriteIntentRecord,
} from "./write-safety.js";

type IntentStatus = WriteIntentRecord["status"];
type AttemptState = WriteAttemptRecord["outcome"]["state"];
type Pair<Intent extends IntentStatus, Attempt extends AttemptState> = `${Intent}/${Attempt}`;

/**
 * A write intent's status paired with its current attempt's outcome. The one allowed cross-state is a
 * resolved intent (committed or retryable) whose attempt stays parked: the operator's resolution settles
 * the intent and never rewrites the attempt that parked.
 */
export const WRITE_STATES = deepFreeze([
  "observed-present",
  "attempting/attempting",
  "committed/committed",
  "committed/parked",
  "retryable/safe-to-retry",
  "retryable/parked",
  "parked/parked",
] as const satisfies readonly ("observed-present" | Pair<IntentStatus, AttemptState>)[]);
export type WriteStateKey = (typeof WRITE_STATES)[number];

export type WriteEvent =
  | { type: "commit" }
  | { type: "settle-safe-to-retry" }
  | { type: "park"; code: WriteParkCode }
  | { type: "resolve-present"; resolution: ParkedWriteResolutionBinding & { decision: "present" } }
  | { type: "resolve-absent"; resolution: ParkedWriteResolutionBinding & { decision: "absent" } }
  /** A new generation and a new attempt; the previous attempt keeps its outcome. */
  | { type: "refence" };
export type WriteEventType = WriteEvent["type"];
export const WRITE_EVENT_TYPES = deepFreeze([
  "commit", "settle-safe-to-retry", "park", "resolve-present", "resolve-absent", "refence",
] as const satisfies readonly WriteEventType[]);

export type WriteRefusal =
  | "write-settled-present"
  | "operator-resolution-required"
  | "not-attempting"
  | "not-parked"
  | "not-retryable"
  | "resolution-binding-required"
  | "park-code-unknown";
export type WriteTransition = { readonly state: WriteStateKey } | { readonly refused: WriteRefusal };

const SETTLED = { refused: "write-settled-present" } as const;
const OPERATOR = { refused: "operator-resolution-required" } as const;
const NOT_ATTEMPTING = { refused: "not-attempting" } as const;
const NOT_PARKED = { refused: "not-parked" } as const;
const NOT_RETRYABLE = { refused: "not-retryable" } as const;
const BINDING_REQUIRED = deepFreeze({ refused: "resolution-binding-required" } as const);
const PARK_CODE_UNKNOWN = deepFreeze({ refused: "park-code-unknown" } as const);
const SETTLED_ROW = {
  commit: SETTLED, "settle-safe-to-retry": SETTLED, park: SETTLED, "resolve-present": SETTLED, "resolve-absent": SETTLED, refence: SETTLED,
} as const;
const RETRYABLE_ROW = {
  commit: NOT_ATTEMPTING, "settle-safe-to-retry": NOT_ATTEMPTING, park: NOT_ATTEMPTING,
  "resolve-present": NOT_PARKED, "resolve-absent": NOT_PARKED, refence: { state: "attempting/attempting" },
} as const;

/** A write with an unknown outcome (parked) leaves only through the operator's resolution. */
export const WRITE_TRANSITIONS = deepFreeze({
  "observed-present": SETTLED_ROW,
  "attempting/attempting": {
    commit: { state: "committed/committed" },
    "settle-safe-to-retry": { state: "retryable/safe-to-retry" },
    park: { state: "parked/parked" },
    "resolve-present": NOT_PARKED,
    "resolve-absent": NOT_PARKED,
    refence: NOT_RETRYABLE,
  },
  "committed/committed": SETTLED_ROW,
  "committed/parked": SETTLED_ROW,
  "retryable/safe-to-retry": RETRYABLE_ROW,
  "retryable/parked": RETRYABLE_ROW,
  "parked/parked": {
    commit: OPERATOR,
    "settle-safe-to-retry": OPERATOR,
    park: OPERATOR,
    "resolve-present": { state: "committed/parked" },
    "resolve-absent": { state: "retryable/parked" },
    refence: OPERATOR,
  },
} as const satisfies Record<WriteStateKey, Record<WriteEventType, WriteTransition>>);

export function transitionWrite(state: WriteStateKey, event: WriteEvent): WriteTransition {
  const transition: WriteTransition = WRITE_TRANSITIONS[state][event.type];
  if ("refused" in transition) return transition;
  if (event.type === "resolve-present" || event.type === "resolve-absent") {
    const binding = ParkedWriteResolutionBindingSchema.safeParse(event.resolution);
    if (!binding.success || binding.data.decision !== (event.type === "resolve-present" ? "present" : "absent")) {
      return BINDING_REQUIRED;
    }
  }
  if (event.type === "park" && !WriteParkCodeSchema.safeParse(event.code).success) return PARK_CODE_UNKNOWN;
  return transition;
}
