# Phone-capture findings — the OPERATOR half

Records where the demo's DESKTOP view of a phone-capture session
(`hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/dashboard/components/dev/rebuild-demo/DemoCapture.tsx`) has no counterpart on the operator's
side of this tree, verified 2026-08-21 against `src/dashboard/surfaces/capture-start.tsx`,
`src/dashboard/client/queries.ts` and `src/server/dashboard/routes/api.ts` per
`docs/plans/2026-08-21-03a-fidelity-3-standing-surfaces.md` §7 (ledger 3, rows CP2, CP6–CP16, CP21,
CP45). D175 rules the PHONE side and built it; nothing rules the operator side's absence
(`docs/rebuild/03a-finish-the-dashboard.md` OPEN question 8). See `README.md` for the standing
rules; this file did not exist before this pass.

Owning doc for every record below: `docs/rebuild/reference/data-intake-and-edit-data.md` §5.1,
`docs/rebuild/reference/dashboard-surfaces.md` §9.7.2.

## No operator-scoped session LIST

**Recorded:** 2026-08-21 · **Status:** PRODUCER CLOSED 2026-08-26 (D274 item 7) —
`GET /api/v1/capture/sessions` now serves `CaptureOperatorSessionListWireSchema` summaries
(sessionId · phase · pageCount · expiry) from `captureSessions.listActive()`; a by-actor index was
never needed in a single-operator product. The picker itself remains the operator-surface unit ·
**Owning doc:** ref data-intake-and-edit-data §5.1

**Symptom.** The demo's multi-session picker (`Select`, one option per open session with its phase
and page count) has nothing to bind to — there is no endpoint that lists an operator's open capture
sessions, only a way to start one and a way to read the ONE just started by its id.

**Ledger row:** CP2.

**What closes it:** a `GET /api/v1/capture/sessions` list route plus a durable index of
sessions-by-actor; a small, separate producer from the single-session read below.

---

## The single-session READ exists on the server and is never called

**Recorded:** 2026-08-21 · **Status:** OPEN — the true gap is the FRONTEND, not the backend
(corrects the ledger's "no operator-scoped session read — UNBOOKED": `GET
/api/v1/capture/sessions/:sessionId` → `deps.capture.readSession` is real,
`src/server/dashboard/routes/api.ts:264-265`; `src/dashboard/client/queries.ts` has no client
function that calls it, and `capture-start.tsx` never references a session read) ·
**Owning doc:** ref data-intake-and-edit-data §5.1

**Producer upgraded 2026-08-26 (D274 item 7):** the same route now serves the OPERATOR projection
(`CaptureOperatorSessionWireSchema`, `src/domain/capture-operator.ts`) — the durable state plus a
schema-pinned `phase` (CP7's vocabulary), the expiry, and one entry per page with its recorded size,
media type, artifact id and image fact. The frontend half (the client query, the poll, the five
components) still stands open.

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
