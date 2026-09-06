# Phase 2.4 · Operator services and read models

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

## 2.4 · Operator services and read models
<!-- roadmap: p2-2i -->

### Task 1 · Build trust and Edit Data surfaces
<!-- roadmap: p2d-operator-services -->

### Task 2 · Build Settings and storage doctor
<!-- roadmap: p2d-settings-doctor -->

### Task 3 · Build intake and historical Capture surfaces
<!-- roadmap: p2d-intake-surfaces -->

### Task 4 · Build Explorer, UI catalog, and advisories
<!-- roadmap: p2d-explorer -->

### Task 5 · Build archive, version, and Activity surfaces
<!-- roadmap: p2d-archive-activity -->

The historical status block below records the combined A–G delivery. Mobile Capture Mode is retained
only as history because D294 retired it; diagnostic captures and archive evidence remain.

<!-- roadmap-status: p2-2i -->
- [x] **2i-A/B, the trust surfaces + the bell** — the receipt and the failure record render from authority (`trust.tsx` over `queries/run-detail.ts`, D140/D142), and the durable inbox has a bell (D138; `ref frontend-backend-integration` §5.1.6)
- [x] **2i-C, the Edit Data rail** — the `context-data` wire carries the policy, `authority.version` is the generation token, drafts re-parse into the recorded scalar's type, and all five save arms plus the three consume arms are pinned (D168; `edit-data-field-policy` active)
- [x] **2i-D, Settings + the storage doctor + the live backup cadence** (D169) — one backup at process start, a coalesced verified backup on each 15-minute tick only when the store is dirty, and a graceful-drain backup inside `stop()` (`ref dashboard-surfaces` §2.5)
- [x] **2i-E, the intake surface over schema v12** — the durable session, the upload route, all six command arms and the first real projection (D170–D173; `ref data-intake-and-edit-data` §2.7/§2.8/§5.2)
- [x] **2i-F historical Capture Mode** — retired by D294; diagnostic screenshots, Receipt Capture tiles, and Archive evidence remain supported
- [x] **2i-G, the read-only Workflow Explorer + the UI catalog** — the explorer is a projection of the ONE composition root, guarded in both directions over the REAL registry; source links RESOLVE against a real listing and a miss is `unresolved` carrying the path it tried; the catalog surface serves the COMMITTED artifact and refuses a stale one (D176/D177)
- [x] **AI advisories** — redaction, strict output, explicit provider exhaustion and zero authority edge, one fixture per arm plus `ai-advisory-no-authority` active (D178)
- [x] **the archive model + Activity report over schema v13** — UPDATE and DELETE aborted in SQL, the version bump, the ledger read-through, the CSV export (D179/D180/D223/D236/D240)
- [x] the rail's CAS-conflict arm — silently reported *saved* until D253 fixed it — is now exhaustive at the discriminant and guarded (`ref data-intake-and-edit-data` §6.4.1)
- [x] The bounded Settings editor, atomic `apply-settings`, persisted readback and preflight/rerun controls are active (DCC1–DCC3; `ref frontend-backend-integration` §3.4); broader legacy Settings capabilities remain explicitly deferred → `{#def-settings}`
- [ ] six of seven **worker / session controls** have kernel arms and no control (`ref frontend-backend-integration` §5); **unowned, reported**
- [ ] the Explorer's **live-run overlay** and **scenario-coverage claims** stay excluded BY DECISION, not for want of a wire — run facts belong to the run-detail timeline, claims belong to the executable corpus (`ref operator-trust` §5.7)
- [ ] the Explorer's **EDIT half** is reassigned out of Phase 2 (D186) → `{#def-explorer-edit}`, and §Left Phase 2 by explicit disposition below
> 2026-08-30 | DCC1 reconciliation | preserves DCC1–DCC3's active bounded Settings editor, apply/read/restart authority and preflight controls; the other Phase-2 residues retain their owning dispositions above

<!-- /roadmap-status -->

**What 2i was.** The rest of the operator surface: evidence, failure, notification and run-explain
views; storage health and backups; Edit Data, intake and capture UI; the generated UI catalog;
optional read-only AI advisories; and the **read-only Workflow Explorer** over tasks, delegation,
scenarios and source links.

**COMPLETE 2026-08-09 (D168–D180).** Its normative contracts are `ref operator-trust` §1.3, §5.7 and
§5.8; `ref data-intake-and-edit-data` §2.7, §5.1 and §5.2; and `ref dashboard-surfaces` §10.2–§13,
with the wire half in `ref frontend-backend-integration` §6.7 — each carries its own `p2-2i` status
block, and those blocks are the per-contract truth this section indexes.

**Two exclusions here are DECISIONS, and one is a deferral — a reader must not confuse them.** The
Explorer's live-run overlay and its scenario-coverage *claims* are excluded because run facts belong
to the run-detail timeline and claims belong to the executable corpus; nothing is waiting on a wire
and nothing will change them without a new decision. The Explorer's **EDIT half** is different: it is
a Phase-2 exit criterion **reassigned** by D186 with a named trigger, recorded in full below and
owned by `{#def-explorer-edit}`.

**The credential that had to survive a QR (D174).** The capture token reaches a phone through a
scanned link, which looks like it forces a secret into a URL and breaks `ref clock-config-secrets`'
"no secret-bearing URLs" rule. It does not: a URL fragment is never transmitted to any server, so
`/capture.html#t=<token>` puts the credential in the one part of a link no proxy, access log or
`Referer` header can see, and the phone then presents it in a header. Because the asset URL carries
no token, the ingress allowlist is a fixed path set with nothing interpolated. Every way a token can
fail to name a live session — unknown, malformed, expired, discarded — answers **identically**,
because a varying refusal is an existence oracle on a public origin; refusals AFTER the token
resolves are named in full, since by then the caller has proven it holds the secret.

**2i built the surface; 2j found that one of them could not be read.** The run-detail panel that
renders the receipt and the failure record was **two pixels wide** at every viewport from 1i-spine
until D187, and the accessibility tree reported every word of it. That is why this tail's completion
date and D82's acceptance date differ, and it is the reason the parity corpus exists in the form it
does — see §2j.
