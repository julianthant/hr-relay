# Retired phone-capture findings

**Status: CLOSED BY RETIREMENT 2026-08-31 (D294).** The mobile/phone document Capture Mode and its
desktop operator panel are removed. Every record below is historical provenance only; none remains
an active UI, wire, route, test, or planning obligation. Diagnostic screenshots, run Capture tiles,
Receipt evidence, and Archive evidence are separate authority and are unaffected.

Records where the demo's DESKTOP view of a phone-capture session
(`hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/dashboard/components/dev/rebuild-demo/DemoCapture.tsx`) has no counterpart on the operator's
side of this tree, verified 2026-08-21 against `src/dashboard/surfaces/capture-start.tsx`,
`src/dashboard/client/queries.ts` and `src/server/dashboard/routes/api.ts` against the source-pinned
2026-08-21 standing-surfaces fidelity ledger
(`9993ab39^:docs/plans/2026-08-21-03a-fidelity-3-standing-surfaces.md` §7, rows CP2, CP6–CP16,
CP21, CP45; removed with obsolete dashboard plans). D175 rules the PHONE side and built it; nothing ruled the operator side's absence
(`docs/rebuild/plans/phase-3/3.1-finish-the-dashboard.md` OPEN question 8). See `README.md` for the standing
rules; this file did not exist before this pass.

Owning doc for every record below: `docs/rebuild/reference/data-intake-and-edit-data.md` §5.1,
`docs/rebuild/reference/dashboard-surfaces.md` §9.7.2.

## No operator-scoped session LIST

**Recorded:** 2026-08-21 · **Status:** CLOSED 2026-08-26 (D274 item 7) — the producer landed first
(`GET /api/v1/capture/sessions` serves `CaptureOperatorSessionListWireSchema` summaries from
`captureSessions.listActive()`; a by-actor index was never needed in a single-operator product), and
the picker now consumes it: `client.activeCaptureSessions()` →
`useActiveCaptureSessions` → the `Select` in `surfaces/capture-session.tsx`, scoped to the intake
screen's workflow. Its option carries the id, the phase label and the page count, and it keeps the
LOADED session as an extra option when that session has left the active set — a capture that
finalizes leaves `listActive` at the moment the operator wants to read it ·
**Owning doc:** ref data-intake-and-edit-data §5.1

**Symptom.** The demo's multi-session picker (`Select`, one option per open session with its phase
and page count) has nothing to bind to — there is no endpoint that lists an operator's open capture
sessions, only a way to start one and a way to read the ONE just started by its id.

**Ledger row:** CP2.

**What closes it:** a `GET /api/v1/capture/sessions` list route plus a durable index of
sessions-by-actor; a small, separate producer from the single-session read below.

---

## The single-session READ exists on the server and is never called

**Recorded:** 2026-08-21 · **Status:** CLOSED 2026-08-26 (D274 item 7). The gap was the FRONTEND,
not the backend, and both halves have now landed ·
**Owning doc:** ref data-intake-and-edit-data §5.1

**Producer upgraded 2026-08-26 (D274 item 7):** `GET /api/v1/capture/sessions/:sessionId` serves the
OPERATOR projection (`CaptureOperatorSessionWireSchema`, `src/domain/capture-operator.ts`) — the
durable state plus a schema-pinned `phase` (CP7's vocabulary), the expiry, and one entry per page
with its recorded size, media type, artifact id and image fact.

**Consumer landed 2026-08-26 (D274 item 7, unit F13):** `client.captureSession()` →
`useCaptureSession` (a poll, because a capture session is not a run and no SSE envelope moves when a
page lands; it stops at a terminal phase and keeps saying so when a read fails) →
`surfaces/capture-session.tsx`, mounted beside `CaptureStart` in the intake workspace. All seven
rows are drawn: the state `Well` (CP6), the phase `Badge` over the eight-arm vocabulary (CP7), the
session `MetaLine` minus every unserved fact (CP8), the unreadable and unavailable banners as TWO
regions (CP9), the `What was recorded` list (CP10), the count (CP11), the contact sheet (CP12–CP15),
the two-arm empty sheet (CP16), the divider TRACK (CP17), the capped scrolling `Well` (CP18) and the
waiting-for-phone state (CP21). CP3/CP4's ⓘ is built with copy about THIS tree rather than the
demo's fixture, and CP5's no-session `EmptyState` is the panel's absent arm.

**Symptom.** The demo renders the session's state Well, its phase Badge, its MetaLine, its
pages-received count, its contact sheet and its no-page empty state — none of which exist on the
operator side here, because nothing on the client ever fetches the session it just started.

**Ledger rows:** CP6 (state Well), CP7 (phase Badge), CP8 (session MetaLine), CP11 (pages-received
CountBadge), CP12 (contact sheet grid), CP16 (no-page empty state), CP21 (the "waiting for phone"
state generally).

**What closes it:** a `readCaptureSession` client query wrapping the existing GET route, a poll or
SSE tick to keep it live (the demo's session updates as pages arrive), and the five components
above built against it. No new backend route is needed for this group — only for the list (previous
record).

---

## `CapturePhotoWireSchema` carries no unreadable/focus signal

**Recorded:** 2026-08-21 · **Status:** UNREADABLE half PRODUCER CLOSED 2026-08-26 (D274 item 7) —
the OPERATOR wire's per-page `image` fact (`src/domain/capture-operator.ts`) serves
`{state: "unreadable", reason}` whenever the finalize bundler's own parse (`embedCaptureImage`)
refuses the recorded bytes, so the desktop Banner has a served fact and can never disagree with the
bundle. `focusScore` remains OPEN with no producer — nothing scores a raw phone photo, and the fact
is deliberately NOT invented (D276); the phone-side `CapturePhotoWireSchema` is unchanged ·
**Owning doc:** ref data-intake-and-edit-data §5.1

**Symptom.** The demo's unreadable-page Banner and its per-tile warning edge treatment both read a
per-photo `unreadable`/`focusScore` fact that this wire does not carry.

**Ledger rows:** CP9 (the Banner), CP15 (the tile's edge-not-fill warning treatment, same producer).

**What closes it:** the OCR/normalization store that would score a captured photo's readability
publishing `unreadable`/`focusScore` onto `CapturePhotoWireSchema` — currently no producer computes
either fact for a raw phone photo.

---

## `CapturePhotoWireSchema` carries no display metadata

**Recorded:** 2026-08-21 · **Status:** DIMENSIONS half PRODUCER CLOSED 2026-08-26 (D274 item 7) —
the OPERATOR wire serves `pixelWidth`/`pixelHeight` per readable page, parsed from the recorded
artifact bytes by the bundler's own `embedCaptureImage` (no new stamp at upload was needed: the
bytes ARE the record). Filename and arrival instant remain OPEN — the phone upload carries no
filename and nothing records an arrival instant, so both are deliberately ABSENT from the operator
wire rather than optional (D276: an unserved fact is not a schema field) ·
**Owning doc:** ref data-intake-and-edit-data §5.1

**Symptom.** The demo's "What was recorded" KeyValueList and the contact-sheet tile both print a
filename, pixel width × height and an arrival clock that this wire does not serve.

**Ledger rows:** CP10 (the KeyValueList), CP13 (the tile's third line), CP14 (the tile's accessible
name, same three facts).

**What closes it:** the upload handler (`POST /api/v1/capture/phone/photos`) stamping arrival time
and reading image dimensions at receipt, plus a filename field on the multipart upload — none of
which the current route captures today.

---

## `replacePhoto` has a server route and no client method

**Recorded:** 2026-08-21 · **Status:** OPEN — the route exists, the client does not
(`PUT /api/v1/capture/phone/photos/:photoId` is real,
`src/server/dashboard/commands/capture-service.ts:115,406`; no `CapturePhoneClient.replacePhoto`
or equivalent exists in `src/dashboard/**`) · **Owning doc:** ref data-intake-and-edit-data §5.1

**Symptom.** The demo's unreadable-page banner offers "Retake it on the phone", which is the
PHONE re-taking and re-uploading over the same `photoId` — the server-side primitive for that
already exists and is unused by any client.

**Ledger row:** CP45.

**What closes it:** wiring the phone bundle's photo-review step to call the existing PUT route on
retake, and — for the operator's own Banner (bundled with the "unreadable" group above once that
lands) — a way to ask the phone to retake a specific page.

---

## The intake column gives its whole height to the dropzone, so a LIVE capture opens below the fold

**Recorded:** 2026-08-26 (unit F13) · **Status:** RULED 2026-08-27 (D278 — the live capture panel takes the column; the dropzone yields to a strip), implementation carried to Phase 4 (D279) · was: OPEN — a layout proportion, not a missing fact ·
**Owning doc:** ref data-intake-and-edit-data §5.1

**Symptom.** `surfaces/intake.tsx`'s empty/refused arm gives the `Dropzone` `flex-1` under a comment
that reads *"the zone GROWS to fill the surface. It is the only act available on this screen"*. That
sentence stopped being true when the capture panel landed beside it. Measured at 1440x900 with the
fixture's three-page session: the panel's top is at y=620 and its bottom at y=1080, so roughly half
of a live capture — including the second failure banner — sits under the fold. It is REACHABLE (the
intake body is a real scroller, 969/727), so this is not a hidden fact; it is an operator watching a
phone fill up having to scroll past an empty 430px drop target to see it.

**Why it was not fixed in F13.** Whether the dropzone or the live capture owns the column's height
is a genuine trade-off with an operator-visible cost on both sides — a small dropzone is a worse
drop target — and D274 item 7 ruled the PANEL in, not the intake column's proportions. Deciding it
inside a one-seam unit would be exactly the kind of unilateral call the ratification rule exists to
stop.

**What closes it.** A ruling on the intake column: either the dropzone yields its `flex-1` while a
capture session is open (the panel would have to tell it, which is a prop), or the capture panel
moves above the dropzone, or the column stays as it is and the decision is recorded as one. The
stale comment at `intake.tsx`'s Dropzone should be corrected in the same change either way.
