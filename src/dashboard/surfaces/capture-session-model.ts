/**
 * The DESKTOP's reading of a phone capture — every decision the panel makes,
 * as a pure fold (D274 item 7, ledger 3 CP2/CP5–CP18/CP21).
 *
 * `src/domain/capture-operator.ts` owns what the desktop is SERVED. This module
 * owns what those served facts mean on screen, and the split is load-bearing in
 * one direction: **nothing here may compose a fact the wire does not carry.**
 * The demo this ports from (`DemoCapture.tsx`, legacy
 * `1bffbd658db34ce84a08e69484db3a40b3658d6e`) drew four facts that no producer
 * in this tree records, and each is ABSENT rather than optional (D276):
 *
 * | demo fact                | why it is not here                                       |
 * |--------------------------|----------------------------------------------------------|
 * | device label / pairing code | pairing is a scanned 32-byte token, not a typed code (D174), and the durable row records no device |
 * | a page's arrival instant | nothing stamps one at upload, so "last page 14:02" would be invented |
 * | a page's filename        | the phone's multipart upload carries none                 |
 * | a focus score            | nothing scores a raw phone photograph                     |
 *
 * The one place the rebuild says MORE than the demo is the per-page verdict.
 * The demo had a single `unreadable` flag; this wire has two arms that must
 * never merge on screen — `unreadable` is the finalize bundler refusing the
 * recorded bytes (a page to retake) and `unavailable` is the artifact failing
 * read-back or its integrity check (a fault to report). Folding them would let
 * "the check failed" impersonate "the page is bad", which is this repo's
 * fail-loud rule inverted into display.
 */
import type { ComponentType, SVGProps } from "react";
import {
  ArrowDownToLine,
  CircleAlert,
  FileStack,
  Hourglass,
  Inbox,
  Smartphone,
  TimerOff,
  Trash2,
} from "lucide-react";
import type {
  CaptureOperatorPageWire,
  CaptureOperatorPhase,
  CaptureOperatorSessionSummaryWire,
  CaptureOperatorSessionWire,
} from "../../domain/capture-operator.js";
import { fmtClock, plural } from "./format.js";

/* ── the phase ───────────────────────────────────────────────────────────── */

export interface CapturePhaseSpec {
  readonly label: string;
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** `warning` on the ONE phase an operator has to act on. Never `success`. */
  readonly tone: "neutral" | "warning";
}

/**
 * CP7's badge, over the rebuild's eight-arm phase rather than the demo's five.
 *
 * Two labels deliberately do NOT port their demo wording, because the same word
 * means something else here. The demo's `ready` meant *ready to finalise* — a
 * stack of pages waiting for a press; here `ready` is the durable `finalized`
 * state, so the bundle is already made and enqueued and the label says so. The
 * demo's `blocked` meant *a page cannot be read*; here `blocked` is derived
 * from the durable `failed` state, which is the FINALIZATION failing, and an
 * unreadable page moves no phase at all (the schema pins `phase` to the state
 * machine and to nothing else). The unreadable page's only signal on this
 * surface is its own banner, which is the correct place for it: a page verdict
 * is not a session phase.
 *
 * **No arm is `success`, and none carries a check glyph** (CP59). Green in this
 * product means a write was read back out of a target system; a stack of
 * photographs nobody has read has earned none of that, and `ready` reports a
 * durable enqueue rather than a verdict on any page.
 */
export const CAPTURE_PHASE: Readonly<Record<CaptureOperatorPhase, CapturePhaseSpec>> = Object.freeze({
  "awaiting-phone": { label: "Waiting for the phone", Icon: Smartphone, tone: "neutral" },
  "awaiting-pages": { label: "Phone paired — no page yet", Icon: Hourglass, tone: "neutral" },
  receiving: { label: "Receiving pages", Icon: ArrowDownToLine, tone: "neutral" },
  finalizing: { label: "Bundling the pages", Icon: FileStack, tone: "neutral" },
  ready: { label: "Bundled and queued", Icon: Inbox, tone: "neutral" },
  blocked: { label: "The bundle could not be sent", Icon: CircleAlert, tone: "warning" },
  discarded: { label: "Discarded on the phone", Icon: Trash2, tone: "neutral" },
  expired: { label: "This capture expired", Icon: TimerOff, tone: "neutral" },
} as const);

/* ── sizes and sentences ─────────────────────────────────────────────────── */

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

/**
 * A recorded artifact's byte length, as the operator reads it.
 *
 * Bytes below a kilobyte print as bytes rather than `0.0 KB`: a photograph that
 * small is a defect worth seeing exactly, and rounding it to zero is the one
 * reading that hides it.
 */
export function captureSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error(`a capture page reports ${String(bytes)} bytes, which is not a byte length`);
  }
  if (bytes < BYTES_PER_KB) return `${String(bytes)} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

/**
 * End a SERVER-authored sentence before this surface's own words follow it.
 *
 * The parser's refusal and the artifact store's error are both somebody else's
 * prose, and neither is required to end in a stop — the failure this repo has
 * already met once, where a refusal message ran straight into the product's
 * next clause and rendered as one broken sentence. Nothing is added when the
 * sentence already closes itself.
 */
export function endSentence(sentence: string): string {
  const trimmed = sentence.trim();
  if (trimmed.length === 0) {
    throw new Error("a served capture reason is empty, so there is no sentence to draw");
  }
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/* ── one page ────────────────────────────────────────────────────────────── */

export type CapturePageFlag = "none" | "unreadable" | "unavailable";

export interface CapturePageTileFacts {
  readonly ordinal: number;
  readonly flag: CapturePageFlag;
  /** The first text line — `Page 3`. */
  readonly title: string;
  /**
   * The second, ALWAYS-DRAWN line: the recorded size, or the word that says why
   * there is nothing else to say about this page. Always drawn so every tile is
   * one height and the sheet keeps a single baseline whatever landed on it.
   */
  readonly stateLine: string;
  /** CP14 — composed from served facts only; there is no arrival clock here. */
  readonly accessibleName: string;
  /**
   * The frame's own shape, `"<w> / <h>"`, when the bundler parsed the page's
   * geometry. **Absent for both failure arms on purpose**: a page whose bytes
   * would not parse has no served shape, and letterboxing it to a plausible US
   * Letter would be this surface inventing the one thing it is looking at.
   */
  readonly aspectRatio?: string;
}

const PAGE_FLAG_WORD: Readonly<Record<Exclude<CapturePageFlag, "none">, string>> = Object.freeze({
  unreadable: "unreadable",
  unavailable: "unavailable",
});

const PAGE_FLAG_NAME: Readonly<Record<Exclude<CapturePageFlag, "none">, string>> = Object.freeze({
  unreadable: "flagged unreadable",
  unavailable: "could not be read back",
});

export function capturePageFlag(page: CaptureOperatorPageWire): CapturePageFlag {
  return page.image.state === "readable" ? "none" : page.image.state;
}

export function capturePageTileFacts(page: CaptureOperatorPageWire, total: number): CapturePageTileFacts {
  const flag = capturePageFlag(page);
  const size = captureSizeLabel(page.bytes);
  const where = `Page ${String(page.ordinal)} of ${String(total)}`;
  if (page.image.state === "readable") {
    const { pixelWidth, pixelHeight } = page.image;
    return {
      ordinal: page.ordinal,
      flag,
      title: `Page ${String(page.ordinal)}`,
      stateLine: size,
      accessibleName: `${where} — ${size}, ${String(pixelWidth)} by ${String(pixelHeight)}`,
      aspectRatio: `${String(pixelWidth)} / ${String(pixelHeight)}`,
    };
  }
  const named = page.image.state;
  return {
    ordinal: page.ordinal,
    flag,
    title: `Page ${String(page.ordinal)}`,
    stateLine: PAGE_FLAG_WORD[named],
    accessibleName: `${where} — ${size}, ${PAGE_FLAG_NAME[named]}`,
  };
}

export interface CaptureRecordedFact {
  readonly key: string;
  readonly value: string;
  readonly tone?: "warning" | "danger";
}

/**
 * CP10's "What was recorded", over the facts this tree actually has.
 *
 * `Arrived` and `File` are the demo's rows with no producer here and are simply
 * gone — an optional row that never fills is a permanent blank the eye reads as
 * a value nobody bothered to fetch. The `Read` row carries only the SHORT verdict
 * and never the served reason: the list's value cell truncates, and a parser's
 * sentence recovered on a tooltip is a fact reachable by pointer and by nobody
 * else. The reason lives in the banner, which wraps.
 */
export function captureRecordedFacts(page: CaptureOperatorPageWire, total: number): readonly CaptureRecordedFact[] {
  const facts: CaptureRecordedFact[] = [
    { key: "Page", value: `${String(page.ordinal)} of ${String(total)}` },
  ];
  if (page.image.state === "readable") {
    facts.push({
      key: "Pixels",
      value: `${String(page.image.pixelWidth)} × ${String(page.image.pixelHeight)}`,
    });
  }
  facts.push({ key: "Size", value: captureSizeLabel(page.bytes) });
  facts.push({ key: "Type", value: page.mediaType });
  if (page.image.state === "unreadable") {
    facts.push({ key: "Read", value: PAGE_FLAG_NAME.unreadable, tone: "warning" });
  }
  if (page.image.state === "unavailable") {
    facts.push({ key: "Read", value: PAGE_FLAG_NAME.unavailable, tone: "danger" });
  }
  return Object.freeze(facts);
}

/* ── the alerts ──────────────────────────────────────────────────────────── */

export interface CapturePageAlert {
  readonly kind: "unreadable" | "unavailable";
  readonly tone: "warning" | "danger";
  readonly title: string;
  /** One entry per affected page. A single entry is drawn as a sentence. */
  readonly reasons: readonly string[];
  /** What the operator does about it — different for the two arms, on purpose. */
  readonly instruction: string;
}

/**
 * The two banners (CP9), and why there are two.
 *
 * `unreadable` is a page: the bundler's own parse refused these bytes, so the
 * finalize that will run over them would refuse them too, and the fix is on the
 * phone. `unavailable` is the system: the artifact could not be read back or
 * failed its integrity check, so nothing is known about the page at all and
 * retaking it fixes nothing. Merging them would tell an operator to re-photograph
 * a form because a disk read failed — and, worse, would let a storage fault
 * arrive wearing the reassuring shape of a bad photograph.
 */
interface FlaggedPage {
  readonly ordinal: number;
  readonly reason: string;
}

/**
 * The pages on ONE failure arm, with the server's own sentence already closed.
 *
 * Written as a loop rather than `filter().map()` so the discriminant narrows
 * once: after the `readable` arm leaves, `image` is the two-arm union and its
 * `reason` is a required field on both, which is what makes the reason
 * unfabricatable here — there is no branch in which it is absent.
 */
function flaggedPages(
  pages: readonly CaptureOperatorPageWire[],
  arm: "unreadable" | "unavailable",
): readonly FlaggedPage[] {
  const flagged: FlaggedPage[] = [];
  for (const page of pages) {
    const image = page.image;
    if (image.state === "readable" || image.state !== arm) continue;
    flagged.push({ ordinal: page.ordinal, reason: endSentence(image.reason) });
  }
  return flagged;
}

function alertTitle(flagged: readonly FlaggedPage[], singular: string, many: string): string {
  const first = flagged[0];
  if (first === undefined) {
    throw new Error("a capture page alert was composed for zero pages, which has no title");
  }
  return flagged.length === 1
    ? `Page ${String(first.ordinal)} ${singular}`
    : `${plural(flagged.length, "page")} ${many}`;
}

export function capturePageAlerts(pages: readonly CaptureOperatorPageWire[]): readonly CapturePageAlert[] {
  const alerts: CapturePageAlert[] = [];
  const unreadable = flaggedPages(pages, "unreadable");
  const unavailable = flaggedPages(pages, "unavailable");

  if (unreadable.length > 0) {
    alerts.push({
      kind: "unreadable",
      tone: "warning",
      title: alertTitle(unreadable, "could not be read", "could not be read"),
      reasons: Object.freeze(unreadable.map((page) => `Page ${String(page.ordinal)} — ${page.reason}`)),
      instruction: unreadable.length === 1
        ? "Remove that page on the phone and photograph it again — the bundle refuses these bytes the same way when it is sent."
        : "Remove those pages on the phone and photograph them again — the bundle refuses these bytes the same way when it is sent.",
    });
  }

  if (unavailable.length > 0) {
    alerts.push({
      kind: "unavailable",
      tone: "danger",
      title: alertTitle(unavailable, "could not be read back", "could not be read back"),
      reasons: Object.freeze(unavailable.map((page) => `Page ${String(page.ordinal)} — ${page.reason}`)),
      instruction:
        "This is a storage fault rather than a bad photograph, so retaking the page will not clear it. Nothing is known about what these bytes hold.",
    });
  }

  return Object.freeze(alerts);
}

/* ── the session ─────────────────────────────────────────────────────────── */

/**
 * CP8's MetaLine, minus every fact with no producer.
 *
 * There is no device label and no pairing code because pairing here is a
 * scanned token and the durable row records no device (D174/CP19), and no
 * "last page" clock because nothing stamps a page's arrival. Four facts that
 * are all true beat six where two are guesses.
 */
export function captureSessionMetaItems(session: CaptureOperatorSessionWire): readonly string[] {
  return Object.freeze([
    session.sessionId,
    `opened ${fmtClock(session.createdAt)}`,
    ...(session.connectedAt === undefined ? [] : [`paired ${fmtClock(session.connectedAt)}`]),
    `expires ${fmtClock(session.expiresAt)}`,
  ]);
}

/**
 * CP16's two-arm empty sheet. `connectedAt` is the phone's first touch, so it
 * is exactly the fact that separates "the phone has it and has not shot a page"
 * from "the phone has never opened this".
 */
export function captureEmptySheetDescription(session: CaptureOperatorSessionWire): string {
  return session.connectedAt === undefined
    ? "The phone has not opened this capture yet. Scan the QR code with its camera to start."
    : "The phone has this capture open and nothing has been photographed. Take the first page on it.";
}

/* ── the picker (CP2) ────────────────────────────────────────────────────── */

export interface CaptureSessionOption {
  readonly sessionId: string;
  readonly label: string;
}

export function captureSessionOptionLabel(
  sessionId: string,
  phase: CaptureOperatorPhase,
  pageCount: number,
): string {
  return `${sessionId} · ${CAPTURE_PHASE[phase].label} · ${plural(pageCount, "page")}`;
}

/**
 * The picker's options: every ACTIVE session, plus the loaded one when it is no
 * longer active.
 *
 * That last clause is the whole point. `listActive` serves `open`/`finalizing`/
 * `failed`, so a capture that finalizes — the successful ending — leaves the
 * list at the exact moment the operator wants to read it. Dropping it from the
 * picker would strand the panel on a session its own control could not name.
 */
export function captureSessionOptions(
  active: readonly CaptureOperatorSessionSummaryWire[],
  loaded: CaptureOperatorSessionWire | undefined,
): readonly CaptureSessionOption[] {
  const options: CaptureSessionOption[] = active.map((summary) => ({
    sessionId: summary.sessionId,
    label: captureSessionOptionLabel(summary.sessionId, summary.phase, summary.pageCount),
  }));
  if (loaded !== undefined && !options.some((option) => option.sessionId === loaded.sessionId)) {
    options.push({
      sessionId: loaded.sessionId,
      label: captureSessionOptionLabel(loaded.sessionId, loaded.phase, loaded.pages.length),
    });
  }
  return Object.freeze(options);
}

/**
 * Which session the panel is about: the operator's own pick, or the newest
 * active one until they make one.
 *
 * The panel LATCHES the answer, and that is the decision worth writing down.
 * Recomputing "the newest active session" on every tick would jump the operator
 * off the capture they are reading the instant it finalizes and leaves the
 * active set — which is precisely the moment they are reading it. So the first
 * answer is adopted into state and only the picker moves it after that, and a
 * departed session is still read by id.
 */
export function captureSelectedSessionId(
  active: readonly CaptureOperatorSessionSummaryWire[],
  selected: string | undefined,
): string | undefined {
  if (selected !== undefined) return selected;
  return active.at(-1)?.sessionId;
}

/**
 * Which page the facts list is about: the operator's pick while it still
 * exists, otherwise the first page. Keyed to the SESSION, so switching sessions
 * cannot leave the left column describing a page of the one before it.
 */
export function capturePickedPage(
  pages: readonly CaptureOperatorPageWire[],
  picked: { readonly sessionId: string; readonly ordinal: number } | undefined,
  sessionId: string,
): CaptureOperatorPageWire | undefined {
  if (picked !== undefined && picked.sessionId === sessionId) {
    const match = pages.find((page) => page.ordinal === picked.ordinal);
    if (match !== undefined) return match;
  }
  return pages[0];
}

/* ── the disclosure (CP3/CP4) ────────────────────────────────────────────── */

export const CAPTURE_RULE_LABEL = "What the desktop is served about a capture";

/**
 * The standing rule behind this surface, stated once (CP4).
 *
 * The demo's four bullets were about a FIXTURE; these are about this tree, and
 * the last one exists because naming an absence out loud is what stops the next
 * reader treating a missing row as an oversight (D274 item 4's rule for a
 * served vocabulary that is narrower than the demo's).
 */
export const CAPTURE_RULE_ITEMS: readonly string[] = Object.freeze([
  "The desktop is served the session and what has landed on it. It never reaches the phone, so nothing here can make a page arrive, retake one, or end the capture.",
  "No page is drawn. This view is served each page's recorded size, its type and — where the bytes parse — its pixel geometry, never the bytes themselves, so every frame is that page's own shape and holds no image.",
  "A page reads unreadable when the finalize bundler's own parse refuses its recorded bytes, and unavailable when the artifact could not be read back at all. The first is a page to photograph again; the second is a fault to report.",
  "Nothing has read a page yet. Pages are numbered in the order the phone sent them, so a page is a page and never a person.",
  "There is no filename, no arrival time and no focus score anywhere on this surface, because the capture record carries none of them.",
]);
