# Decisions — UI-1 demo-uncovered elements — 2026-08-27

**Run:** UI-1, the demo-fidelity audit (unit U1b, the ratified pass). **Source:** `docs/plans/2026-08-27-ui-fidelity-audit.md` §"Summary C" at commit `1257bda0`, cross-checked against each row's full entry in its surface table (§1 Shell, §2d System hosts, §2e Workflow capabilities).

**The ruling this sheet exists to implement** (`docs/handoffs/2026-08-27-run-ui-1-fidelity.md` §"Task summary"): *"the demo is the design authority for everything it covers … Anything the current build has that the demo does not cover is neither built further nor removed — it becomes a numbered question for the operator ('where do you want this?') in a decision sheet."* These five rows are exactly that set — the audit's `new-in-current` class, one row per element the demo never renders.

_Answer positionally: `1 A, 2 C + "note"`, or "all recommended". Anything unanswered stays open._

---

## 1 · `Workflow explorer` toolbar button

**Situation.** `app/dashboard-app.tsx:1613` — a 129px secondary button in the queue toolbar's left group, between `Import spreadsheet` and `UI catalog` (`x=246 w=129`, no `title`, no icon-only variant). It opens the same Explorer takeover the top bar's `Explorer` segment already opens, so the surface has two doors to one place. The demo has one door only (the segment). Screenshot: `docs/plans/ui-fidelity-audit/shell-1440-current.png` vs `docs/plans/ui-fidelity-audit/shell-1440-demo.png`.

**Not actually undecided.** `docs/rebuild/reference/dashboard-surfaces.md` §"D275 — standing conventions" item 1 (ratified 2026-08-26, one day before this audit) reads: *"Restore the two documented catalog toolbar entries and retain deep links; B hides navigation, C deletes it. This supersedes the prior corrective statement that no buttons exist."* §9.5.3's own history confirms the referent: it originally documented "two `ghost` buttons in the panel's action bar beside `Import spreadsheet`" for the Explorer and the UI catalog together, was corrected 2026-08-21 to say no such buttons exist (`top-bar.tsx:1121-1125`), and D275 item 1 explicitly supersedes that correction. This button is that restoration, already built. The audit's `new-in-current` class appears to be an oversight — it did not cross-reference D275 item 1.

**Options.**
- **A. Keep as is.** Cost: none — this is the D275 item 1 restoration, already ratified and already shipped; leaving it stands on existing authority. The two-doors-to-one-place shape (toolbar button + top-bar segment) stays as built.
- **B. Move to — remove the toolbar button, top-bar `Explorer` segment becomes the one door** (the demo's shape exactly). Cost: re-opens D275 item 1, which named TWO toolbar entries by design; a future reader hits the contradiction and re-litigates it (a CA41-style re-open).
- **C. Remove entirely,** no toolbar door, segment only. Cost: same re-litigation as B, plus directly contradicts D275 item 1's explicit "restore" language — the strongest walk-back of the three.
- **D. Defer to Phase 4.** Cost: leaves a ratified-but-unflagged tension in the audit's own classification uncorrected for another phase; cheap only if nobody relies on the audit's `new-in-current` count in the meantime.

**Recommendation: A** — D275 item 1 already ratified restoring this exact button and explicitly superseded the "no buttons" correction; there is no live question here, only an audit-classification gap worth noting for the ledger.

**Notes:** _(operator's notes here)_

---

## 2 · `UI catalog` toolbar button

**Situation.** `app/dashboard-app.tsx:1621` — an 88px secondary button in the same toolbar group (`x=381 w=88`), opening `surfaces/ui-catalog.tsx` (the generated selector catalog, D177). **CA41** (`docs/plans/2026-08-21-03a-fidelity-3-standing-surfaces.md:721`) records the opposite state as of 2026-08-21: *"the catalog has NO control anywhere; it is reachable only by typing `?catalog=`"*, citing the operator's 2026-08-14 removal of the glyph (`8f55a168`, recorded at `top-bar.tsx:1128-1130`). A control has since reappeared. Screenshot: `docs/plans/ui-fidelity-audit/shell-1440-current.png` vs `docs/plans/ui-fidelity-audit/shell-1440-demo.png`.

**Same D275 item 1 finding as item 1 above applies here** — it is the SECOND of the "two documented catalog toolbar entries" D275 item 1 restores, superseding both the 2026-08-21 doc correction and, by extension, the reasoning behind the 08-14 removal it describes. The demo itself has no counterpart at all for this surface (the rebuild's selector catalog is a generated, rebuild-only artifact — CA40, `ruled: D177`), so there is no "move to the demo's location" option in the usual sense; the only live question is whether the 08-14 removal still stands against the later D275 item 1 restoration.

**Options.**
- **A. Keep as is.** Cost: none — matches D275 item 1's explicit restoration; the 08-14 removal (CA41) is superseded by the later, more specific ratification.
- **B. Move to — fold entry into the top bar's flask "Demo surfaces" icon cluster** or another existing chrome location, so it is not beside `Import spreadsheet`. Cost: contradicts D275 item 1's "beside `Import spreadsheet`" placement (`dashboard-surfaces.md` §9.5.3's original spec text); a new UI-catalog CSS/position ledger row.
- **C. Remove entirely,** `?catalog=` stays the only route (restores the 08-14 CA41 state). Cost: directly reverses D275 item 1, which is one day younger than the audit and explicitly named this exact restoration; reopens the CA41/D275 conflict a third time.
- **D. Defer to Phase 4.** Cost: same as item 1's D — leaves the D275/CA41 tension unflagged in the ledger for another phase.

**Recommendation: A** — D275 item 1 (2026-08-26) is the later and more specific ruling and it names this restoration explicitly; CA41's 08-14 removal is the one it superseded.

**Notes:** _(operator's notes here)_

---

## 3 · System-hosts banner's first sentence

**Situation.** `src/dashboard/surfaces/settings.tsx:517-525`. The current's `System hosts` banner reads: *"A run envelope carries the instance per system and defaults to production; a start that asks for **test** is refused outright unless a distinct test host is configured, never quietly sent to production. This page states the hosts and sets none — a standing override here would redirect every future run with no expiry and nothing on screen to say so."* The demo's banner (`DemoSettings.tsx`) carries only the second half, ported verbatim; the first sentence — the refusal claim — is this build's addition and has no demo counterpart, because the demo's runtime does not implement that refusal at all. Screenshot: `docs/plans/ui-fidelity-audit/settings-hosts-1440-current.png` vs `docs/plans/ui-fidelity-audit/settings-hosts-1440-demo.png`.

**Options.**
- **A. Keep as is** (both sentences). Cost: none — banner stays one sentence longer than the demo's.
- **B. Move to — trim to the demo's exact framing,** dropping the refusal sentence from this banner (it could live elsewhere, e.g. a tooltip on the Test column header). Cost: loses a load-bearing, true fact about this build's refusal behavior from the one place an operator reads before touching hosts; a real fact removed for parity's sake.
- **C. Remove** the refusal sentence outright, no relocation. Cost: same fact-loss as B, with no replacement location; an operator debugging a refused test run has one fewer place to learn why.
- **D. Defer to Phase 4** (leave as is until then). Cost: banner stays longer than the demo's in the meantime; low cost since the content is already correct, just unratified.

**Recommendation: A** — per the fail-loud/served-fact principle, this is a true statement about a real refusal this build has and the demo's runtime lacks; trimming it (B/C) deletes a fact an operator needs at exactly the point they'd act on it wrongly.

**Notes:** _(operator's notes here)_

---

## 4 · `provisioned identical to production — refused` host arm

**Situation.** `src/dashboard/surfaces/settings.tsx:546-557`. A danger-toned third arm in the System hosts table's TEST column, between the `provisioned` and `none provisioned` arms, rendered when a test host is configured but byte-identical to production — a case `resolveSystemEntryUrl` refuses at run time (recorded in the surrounding code comment as "unit F11b finding 2"). The demo's TEST column has only two arms (provisioned / none provisioned); this third arm is unreachable on the current estate today (all 9 configured systems read `none provisioned`). Screenshot: `docs/plans/ui-fidelity-audit/settings-hosts-1440-current.png` vs `docs/plans/ui-fidelity-audit/settings-hosts-1440-demo.png`.

**Options.**
- **A. Keep as is** (three arms). Cost: none — an unreachable-today code path stays visible and correctly labeled for the day it is reachable.
- **B. Move to — fold into the `none provisioned` arm's wording** (e.g. "no usable test host provisioned") rather than a distinct label. Cost: per the surrounding code's own comment, this reads as "nobody configured a sandbox" when the true fact is "a sandbox was configured wrong" — a real distinction lost, and the comment explaining why they're separate would need rewriting or removal.
- **C. Remove the arm,** treat a byte-identical test host as `provisioned` (drop the refusal display; the run-time refusal in `resolveSystemEntryUrl` stays but the table stops flagging it in advance). Cost: an operator configuring a test host wrong gets no advance warning on this page, only a refusal at run start — the whole point of a settings page (state facts before they bite) is undercut for this one case.
- **D. Defer to Phase 4.** Cost: low — the arm is unreachable today, so nothing regresses either way while parked; the classification stays `new-in-current` in the ledger until closed.

**Recommendation: A** — this is exactly the fail-loud/served-fact case the audit's own evidence names: a real runtime refusal (`resolveSystemEntryUrl`) with no demo counterpart because the demo's runtime doesn't have that refusal; hiding it (B/C) would make the page state something less true than it currently does.

**Notes:** _(operator's notes here)_

---

## 5 · Workflow-capabilities banner's trailing clause

**Situation.** `src/dashboard/surfaces/settings.tsx:656`. The demo's Workflow-capabilities banner ends at *"…gains it here on the same deploy."* The current adds one more sentence: *"These six are what a descriptor declares; a seventh appears when a descriptor grows one, never before."* — naming this build's current capability count (six) and stating that the count is descriptor-derived rather than authored. No demo counterpart. Screenshot: `docs/plans/ui-fidelity-audit/settings-capabilities-1440-current.png` vs `docs/plans/ui-fidelity-audit/settings-capabilities-1440-demo.png`.

**Options.**
- **A. Keep as is** (banner + trailing clause). Cost: none — banner stays one sentence longer than the demo's, restating a fact (`settings.tsx:624+`'s own capability-major shape) the page already demonstrates structurally.
- **B. Move to — trim to the demo's exact ending,** dropping the trailing clause; the "six now, seven later" fact would need a different home (e.g. the section's `meta` slot) or would go unstated. Cost: the clause is the only place on the page that states the capability set is descriptor-derived rather than a maintained list — losing it removes an explanation, not a fact already shown elsewhere.
- **C. Remove** the trailing clause outright, no relocation. Cost: same loss as B with no replacement; matches the demo exactly but drops the "never before" derivation guarantee from the reader's view.
- **D. Defer to Phase 4.** Cost: low — a one-sentence cosmetic difference with no functional stakes either way.

**Recommendation: A** — the clause states a true, load-bearing fact (the count is derived from descriptors, not authored) that the page's structure already implies but does not otherwise say in words; trimming it for parity removes an explanation without removing any underlying behavior.

**Notes:** _(operator's notes here)_

---

## Answers (fill and return)

`1 _ · 2 _ · 3 _ · 4 _ · 5 _`

**Where ratified answers land:** `docs/rebuild/reference/dashboard-surfaces.md` §10 ("D272–D276 — Phase 3a operator ratification"), as a new D-entry with a one-line pointer in `docs/rebuild/reference/decisions.md`. The next free D-number at time of writing is **D280** (the changelog's tail currently ends at D279, `docs/rebuild/reference/decisions.md`); the ratifying session mints it, this sheet does not.
