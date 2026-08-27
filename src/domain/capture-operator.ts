/**
 * The OPERATOR half of phone capture — the desktop's wire contract (D274 item 7,
 * ref dashboard-surfaces §10, ref data-intake-and-edit-data §5.1, ledger 3 §7 CP2–CP21).
 *
 * `src/domain/capture.ts` owns what capture durably records and
 * `src/domain/capture-surface.ts` owns what the PHONE may see. This module owns
 * what the DESKTOP is served about a phone session: the phase, the expiry, every
 * page that has landed, and whether each page can actually become a PDF page.
 * Everything here is a projection of recorded authority — the durable session
 * row plus the content-addressed photo bytes read through the SAME parse the
 * finalize bundler uses (`embedCaptureImage`) — so no field can claim a fact
 * the capture services never recorded:
 *
 * - There is NO focus score, NO filename and NO per-page arrival instant,
 *   because the durable record carries none of them (D276: served facts only —
 *   an unserved fact is absent from the schema, never an optional lie).
 * - The unreadable-page fact is the bundler's own refusal, surfaced BEFORE
 *   finalize instead of during it: a page is `readable` exactly when the
 *   production embed parse yields its pixel geometry, `unreadable` when that
 *   parse refuses the recorded bytes (the reason is the parser's own sentence),
 *   and `unavailable` when the artifact could not be read back or failed its
 *   integrity check — an ERROR arm kept distinguishable from `unreadable`, so
 *   "the check failed" can never impersonate "the page is bad".
 * - `phase` is DERIVED from the durable state machine and pinned to it by the
 *   schema itself: a wire whose phase disagrees with its own facts refuses to
 *   parse. `ready` is deliberately neutral (CP7) — it reports a durable
 *   enqueue, not a page verdict.
 *
 * Like every operator/phone wire, this one never carries the token or its
 * digest (`capture-durability-and-scope.test.ts` pins the shape).
 */
import { z } from "zod";
import {
  ArtifactIdSchema,
  CapturePhotoIdSchema,
  CaptureSessionIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  WorkflowIdSchema,
} from "./ids.js";
import { CaptureSessionStateSchema, type CaptureSessionState } from "./capture.js";
import { CaptureHandoffWireSchema, CaptureUploadMediaTypeSchema } from "./capture-surface.js";

/* ── the phase ───────────────────────────────────────────────────────────── */

/**
 * CP7's operator vocabulary over the durable state machine, plus the three
 * truthful arms the demo never had because it had no durable session
 * (`finalizing`, `discarded`, `expired` — D276's async/refusal exception).
 */
export const CaptureOperatorPhaseSchema = z.enum([
  "awaiting-phone",
  "awaiting-pages",
  "receiving",
  "finalizing",
  "ready",
  "blocked",
  "discarded",
  "expired",
]);
export type CaptureOperatorPhase = z.infer<typeof CaptureOperatorPhaseSchema>;

export interface CaptureOperatorPhaseFacts {
  readonly state: CaptureSessionState;
  /** Whether the durable row records a `connectedAt` — the phone's first touch. */
  readonly connected: boolean;
  readonly pageCount: number;
}

/**
 * The one fold from recorded facts to the operator phase. Total over the state
 * machine; the single impossible combination — pages recorded on a session no
 * phone ever touched — throws by name, because every photo write goes through
 * the token resolution that stamps `connectedAt` first, so a row shaped that
 * way is corrupt and must not be narrated as a plausible phase.
 */
export function deriveCaptureOperatorPhase(facts: CaptureOperatorPhaseFacts): CaptureOperatorPhase {
  switch (facts.state) {
    case "open": {
      if (!facts.connected) {
        if (facts.pageCount > 0) {
          throw new Error(
            `a capture session records ${String(facts.pageCount)} pages but no connectedAt; `
            + "every upload passes through the connect stamp, so this row is corrupt",
          );
        }
        return "awaiting-phone";
      }
      return facts.pageCount > 0 ? "receiving" : "awaiting-pages";
    }
    case "finalizing": return "finalizing";
    case "finalized": return "ready";
    case "failed": return "blocked";
    case "discarded": return "discarded";
    case "expired": return "expired";
  }
}

/* ── the per-page image fact ─────────────────────────────────────────────── */

/**
 * What the recorded bytes turned out to be, through the finalize bundler's own
 * parse. `readable` carries the page's real pixel geometry (the contact sheet
 * draws each tile at its OWN aspect ratio, CP13); `unreadable` is the parse's
 * refusal verbatim; `unavailable` is a read-back or integrity failure — an
 * error the operator must see, never a silently missing page.
 */
export const CapturePageImageFactSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("readable"),
    pixelWidth: PositiveIntSchema,
    pixelHeight: PositiveIntSchema,
  }),
  z.strictObject({ state: z.literal("unreadable"), reason: z.string().min(1) }),
  z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
]);
export type CapturePageImageFact = z.infer<typeof CapturePageImageFactSchema>;

/* ── the pages ───────────────────────────────────────────────────────────── */

export const CaptureOperatorPageWireSchema = z.strictObject({
  photoId: CapturePhotoIdSchema,
  ordinal: PositiveIntSchema,
  mediaType: CaptureUploadMediaTypeSchema,
  /** The recorded artifact's byte length — the tile's size fact. */
  bytes: z.number().int().nonnegative(),
  artifactId: ArtifactIdSchema,
  image: CapturePageImageFactSchema,
});
export type CaptureOperatorPageWire = z.infer<typeof CaptureOperatorPageWireSchema>;

/* ── the session, as the desktop reads it ────────────────────────────────── */

export const CaptureOperatorSessionWireSchema = z.strictObject({
  wireVersion: z.literal(1),
  sessionId: CaptureSessionIdSchema,
  workflow: WorkflowIdSchema,
  formType: z.string().min(1).optional(),
  contextHint: z.string().min(1).optional(),
  /** The durable state machine's own word — the record. */
  state: CaptureSessionStateSchema,
  /** CP7's operator vocabulary — derived, and pinned to the facts below. */
  phase: CaptureOperatorPhaseSchema,
  /** The contact sheet: ordinal order IS page order, contiguous from 1. */
  pages: z.array(CaptureOperatorPageWireSchema),
  finalArtifact: z.strictObject({
    artifactId: ArtifactIdSchema,
    sha256: FingerprintSchema,
    bytes: z.number().int().nonnegative(),
  }).optional(),
  handoff: CaptureHandoffWireSchema,
  finalizationGeneration: z.number().int().nonnegative(),
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  connectedAt: IsoInstantSchema.optional(),
  expiresAt: IsoInstantSchema,
}).superRefine((wire, context) => {
  let derived: CaptureOperatorPhase;
  try {
    derived = deriveCaptureOperatorPhase({
      state: wire.state,
      connected: wire.connectedAt !== undefined,
      pageCount: wire.pages.length,
    });
  } catch (error) {
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (wire.phase !== derived) {
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: `phase ${wire.phase} disagrees with its own facts, which derive ${derived}`,
    });
  }
  for (const [index, page] of wire.pages.entries()) {
    if (page.ordinal !== index + 1) {
      context.addIssue({
        code: "custom",
        path: ["pages"],
        message: "pages must arrive in contiguous ordinal order from 1 — the contact sheet IS the order",
      });
      break;
    }
  }
});
export type CaptureOperatorSessionWire = z.infer<typeof CaptureOperatorSessionWireSchema>;

/* ── the session list (CP2's picker) ─────────────────────────────────────── */

export const CaptureOperatorSessionSummaryWireSchema = z.strictObject({
  sessionId: CaptureSessionIdSchema,
  workflow: WorkflowIdSchema,
  formType: z.string().min(1).optional(),
  state: CaptureSessionStateSchema,
  phase: CaptureOperatorPhaseSchema,
  pageCount: z.number().int().nonnegative(),
  createdAt: IsoInstantSchema,
  connectedAt: IsoInstantSchema.optional(),
  expiresAt: IsoInstantSchema,
  version: PositiveIntSchema,
}).superRefine((wire, context) => {
  let derived: CaptureOperatorPhase;
  try {
    derived = deriveCaptureOperatorPhase({
      state: wire.state,
      connected: wire.connectedAt !== undefined,
      pageCount: wire.pageCount,
    });
  } catch (error) {
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (wire.phase !== derived) {
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: `phase ${wire.phase} disagrees with its own facts, which derive ${derived}`,
    });
  }
});
export type CaptureOperatorSessionSummaryWire = z.infer<typeof CaptureOperatorSessionSummaryWireSchema>;

export const CaptureOperatorSessionListWireSchema = z.strictObject({
  wireVersion: z.literal(1),
  /** Active sessions only (`open`/`finalizing`/`failed`), oldest first. */
  sessions: z.array(CaptureOperatorSessionSummaryWireSchema),
});
export type CaptureOperatorSessionListWire = z.infer<typeof CaptureOperatorSessionListWireSchema>;
