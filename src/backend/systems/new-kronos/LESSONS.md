# src/backend/systems/new-kronos lessons

Historical evidence moved from the instruction pair on 2026-09-04. Search by the affected
seam or decision and read matching entries before changing it. Current contracts and current
source win over historical status. Record requested lessons here; keep the entry point concise.

## Lessons learned

- **2026-08-27: `ControlOrMeta+a` select-all looked like a clear — it typed correctly on every
  field that was already empty, which is most of them — and it was ornamental (u21).**
  `setRangeField` pressed select-all then typed by real keystrokes, on the theory (recorded
  2026-08-12) that real keystrokes stick where `fill(value)` gets reverted. That is still true of
  the TYPED value. What was never separately verified is that the select-all actually selected
  anything: live it did not, so on a PRE-FILLED field the typed keystrokes were APPENDED onto the
  untouched prior value instead of replacing it — a requested `6/1/2026` read back `"11/20/2626"`
  against a field still holding `11/20/2026`. The fix does not add a retry or a bigger selector; it
  adds a CLEAR that is proven the same way the typed value already was — `fill("")`, then poll the
  field back to `""` before typing a single keystroke, and refuse by name (the label, the value that
  would not go away, the bound) if it never clears. The general rule: a step that "looks safe because
  the common case never needed it" (here, most fields start empty) is unverified for the case that
  DOES need it, and the fix is to prove the precondition, not to assume the workaround that always
  ran alongside it was doing anything. **u21-fix (same day): the clear poll itself repeated the
  exact defect it existed to catch** — it accepted the FIRST `""` read as proof, which is
  `fill("")`'s own synchronous DOM write and not the digest's answer, so a field whose clear the
  digest reverts (the same way it reverts `fill(VALUE)`) would have been declared cleared and then
  typed onto anyway; the clear now settles only when TWO CONSECUTIVE `inputValue()` samples,
  `POLL_INTERVAL_MS` apart, both read `""`, or it is refused by name.
- **2026-08-27: an element on sight is the FIRST digest of its render, not its answer — wait on the
  content you will read, and on the LAST stage of it (§9.20 item 7 → §9.28).** The search poll
  accepted `[role='menuitemradio']` the instant it counted above zero and read `""`, because WFD
  renders a slat in four digests (host → skeleton → tabular card with raw `{{…}}` bindings →
  interpolation). Cold profiles and loaded machines only widen the gap (30–108 ms cold and
  214–570 ms throttled, against 9–18 ms warm); the refusal reproduced on a WARM search under 20× CPU
  throttle. The first fix waited for the card
  ELEMENT and refused the same way — the card arrives before its text does. The rule has two halves:
  the completion signal must be the thing you read (non-empty, interpolated text), and it decides
  only WHEN to read — the identity parse still refuses a completed row that names nobody. And take
  the verdict out of the Playwright closure (`search-render.ts`) so the mid-render stages can be
  fixtures; only a throttled live session could otherwise have reached them.
- **2026-08-13: a loop that stops on the widget can be RIGHT about the widget and wrong about the
  answer (D205).** The grid read stopped when `scrollTop` refused to advance — which was true, and
  meaningless, because the position was being written to ui-grid's PINNED viewport, which is synced
  *from* the body container and drives no virtualization. Fourteen live attempts and six recurrences
  of one failure fingerprint came out of a loop whose termination condition was a property of the
  scrollbar instead of a property of the ANSWER. The rule: when a read gathers a set, terminate on
  what the set must CONTAIN and refuse when you cannot get there. The second half is testability —
  the loop lived inside a `page.evaluate` closure, so no fixture could reach it and only a real WFD
  session could ever have found the defect. It now sits behind a port in `driver/grid-scroll.ts`,
  where a fake virtualized grid executes the exact algorithm.
- **2026-08-13: "bind by header name" is only as good as the ELEMENT SET the names came from
  (D205).** The first grid read that ever reached the fold returned `payCode: "4.00"` with
  `amount: ""` and threw nothing. Headers were queried `document`-wide, so the pinned column's `Date`
  header survived the blank/`.` filter at index 0, while `cells` came from a body row that has no
  date cell — every resolved index one too high, `In` reading `Out` and `Pay code` reading `Amount`.
  The mapping was internally consistent and externally wrong, which is the worst shape a mapping can
  have: name-binding *felt* like the safe alternative to legacy's hardcoded indices and had quietly
  become a different hardcoded offset. Read the names from the same container as the cells, and
  compare the COUNTS — an invariant that catches the class rather than the instance.
- **2026-08-12: a virtualized grid makes "read the DOM" a partial read, and partial reads regress
  silently.** The defect is not a wrong selector — every legacy selector still resolves. It is that
  `document.querySelectorAll(".ui-grid-viewport [role=row]")` returns the RENDERED window, which for
  a separations-sized range (~3 months) is roughly the first 50 days. The last punch is then the last
  punch *in the first 50 days*, which is a plausible date, on the right person, on the right form —
  and wrong. The fix is not a bigger read: it is an INVARIANT the read must satisfy (WFD renders one
  row per calendar day, so a complete read holds every day in the applied window) and a refusal when
  it does not. Generalise it: whenever a page virtualizes, ask what the complete set *must* contain
  and assert that, rather than trusting the loop that gathered it.
- **2026-08-12: `fill()` failing is a fact about the framework, not about the field — re-test it
  before porting the workaround.** Legacy carries ~200 lines of moment-picker calendar navigation and
  four extra selectors because a programmatic `fill()` is wiped by Angular's digest. That is still
  true. What legacy never established is that REAL KEY EVENTS survive it, which they do — so the
  entire workaround, and the four selectors that only exist to serve it, do not port. D150's "live
  re-verification replaces legacy diffing" is usually framed as a way to catch drift; here it deleted
  a whole subsystem.
- **2026-08-12: the same page renders in two different contexts depending on how you arrived.** The
  Employee Search panel is inside `portal-frame-*` on a fresh load and top-level after a timecard
  navigation — and in the second case the page has no named frames at all, so a frame-scoped locator
  does not fail loudly, it just resolves to nothing. Probe the context, never assume it, and make
  "found in neither" a refusal that names both.
- **2026-08-12: the first live run refused a session that was authenticating, and the second refused a
  page that was still painting — WFD bootstraps AFTER the URL lands.** `kronosAuthToken` is issued by
  the APPLICATION, not by the SSO redirect, so a probe sampled at the instant `…/wfd/home` resolves
  sees `AUTHN_TOKEN`, `iPlanetDirectoryPro`, `authn_ssid` and `XSRF-TOKEN` but not the app's own
  cookie. One step later the navbar's `Employee Search` button resolved to ZERO nodes on that same
  authenticated page. Both are the identical shape as Kuali's late-painting menubar, and both fixes
  are the same: a BOUNDED WAIT for the SAME fact, never a widened locator or a weaker fact.
  `exactlyOne` is therefore a wait for the count to become one — with a count of TWO short-circuiting
  immediately, because ambiguity does not resolve itself by waiting.
- **2026-08-12: the panel has two states and they share no control, so the context probe takes an
  ANCHOR.** Before a search the panel renders the query field; after one it collapses to
  `Show Search` and the query field is gone while Go To appears. Probing for the query field to find
  the context — which is what legacy's `resolveSearchRoot` does, and what it warns about in a comment
  — made the timecard step refuse immediately after a SUCCESSFUL search (live run `sk-123940-ab25`).
  The caller now names the anchor that proves the state it needs.
- **2026-08-12: a node whose real product is BROWSER state may not be `replay: "checkpoint"`.** The
  search node's output is durable, but its POINT is the selection it leaves in the panel. Replaying
  the checkpoint restored the output into a fresh browser that had never opened the panel, and Go To
  refused on an empty selection (live run `sk-124132-9beb`). Ref workflow-model §5.3 replay restores VALUES,
  never page state. The search node is `always-rerun` for exactly that reason, and the rule
  generalises to every store slice after this one.
- **2026-08-12: a positive count is evidence; a click is not.** `#goToDropdownButton` is
  `ng-disabled` until Angular registers the slat selection, and WFD publishes its own
  `Total [N]` / `Selected [N]` counters. The driver reads the counter rather than inferring the
  selection from the fact that it clicked a checkbox — and refuses when the counter is absent instead
  of substituting the rendered row count, because a paged or virtualized result set would make the
  two disagree.

## Live map — 2026-08-12 (read-only, Duo cleared hands-off by Duo Autopilot)

- **SSO does NOT go through `a5.ucsd.edu`.** UKG's chain lands on ForgeRock at
  `cust01-prd07-ath01.prd.mykronos.com/authn/XUI/?realm=ucsd_prd_01&service=30847CustomerIDPChain`,
  heading `Signing on using: Active Directory`, with **no** login-type picker (CRM's realm hazard
  cannot occur here). The FORM is the same UCSD one — `#ssousername`
  (`name="urn:mace:ucsd.edu:sso:username"`), `#ssopassword`, `button[name="_eventId_proceed"]` — so
  the shared `ucsd-sso.ts` recipes port unchanged. Credential submit → `…/wfd/home` measured
  **3.32 s**; whole browser-launch-to-home ≈ 33 s.
- **Session proof:** `kronosAuthToken` on `ucsd-sso.prd.mykronos.com` — issued by the APPLICATION,
  absent before authentication. `AUTHN_TOKEN` (the IDP's RS256 JWT on `.prd.mykronos.com`) was the
  alternative and is deliberately not used: it proves the identity provider authenticated somebody,
  and it is scoped to a parent domain that includes the sign-on host itself.
- **The search panel renders in TWO contexts.** Fresh home load → inside
  `iframe[name^="portal-frame-"]` (suffix is session-scoped: `portal-frame-172554836363` and
  `portal-frame-227531434843` minutes apart). After a timecard navigation → TOP-LEVEL, with **no
  named frames on the page at all**. Both observed; the probe is mandatory.
- **Complete Go To option list:** `Timecard`, `Schedule`, `People`, `Reports` (role=option, inside
  the panel's context only). Go To → Timecard ≈ **6.2 s** to `…/timekeeping#/timecard`.
- **Complete pay-period option list (24)** plus `Select range` — recorded in
  `NEW_KRONOS_PERIOD_OPTIONS`; this chunk uses none of them and always applies an explicit window.
- **Timecard grid columns:** pinned `. · . · Date`, data `Schedule · In · Out · Transfer · Pay code ·
  Amount · Shift · Daily · Period · Absence`.
- **`fill()` on the range fields is silently reverted** by the Angular digest in text mode (6 samples
  over 2.4 s all read the pre-fill value). **Real keystrokes stick** (5 samples over 2 s). That is
  why legacy's whole moment-picker calendar path — `pickRangeDateViaCalendar`, month stepping, and
  four extra selectors — is NOT ported. Apply → grid repaint ≈ **6.1 s**.
- **Pay codes observed in one 73-day window:** `Holiday - Hourly`, `Juneteenth Observed`,
  `Independence Day Observed`. Only the first matches the ported `/holiday/i` rule; the other two
  surface as `unclassifiedPayCodes` rather than being dropped. **This is an open operator question**
  — see the migration doc's mapping appendix.
- **Driver-internal, deliberately not registry elements:** the timecard grid (legacy reaches it
  through `page.evaluate` with no selector key) and the timecard's employee-name combobox
  `#combo_inptxt` (no legacy key at all). Publishing a registry element with no ported row would be
  fabricated provenance.

## Provenance

Element recipes ported from legacy commit `793abe1f8265f3213ffe8a80d6cfd9860a32a1dc`,
`src/systems/new-kronos/selectors.ts` (blob `4143290c85acf70d0730ad4c1c97b243bbd74208`) — sixteen
keys, each carrying its own `verifiedAt: 2026-08-12` live re-verification. Four narrow deliberately
and say so on the port: `timecard.payPeriodTriggerButton()` (legacy's regex matches **two** live
nodes and `.first()` was masking it), `goToMenu.goToButtonOnPage()` (the `.or()` arm and the
duplicate `goToButtonInFrame()` key both collapse into one id), `goToMenu.timecardItem()` (a
four-deep `.or()` becomes one exact-name option), and `search.firstResultSlat()` (reads EVERY slat,
because the row itself carries `Name <name> ID <eid>` — as its `aria-label` on 2026-08-12, and as the
interpolated text of its `krn-slats-tabular-data` card on 2026-08-27, when that `aria-label` turned
out to be a feature-toggle-gated binding and was absent; the read's text arm is the live path).

Behaviour ported from `1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/systems/new-kronos/navigate.ts`: `resolveSearchRoot` :70-84, `waitForEmployeeSearchOutcome`
:142-178 (found beats the sentinel — WFD renders both briefly while the grid loads),
`resolveEnabledGoToButton` :304-321, `clickGoToTimecard` :445-533, `verifyTimecardEmployee` :554-576,
`setDateRange` :1266-1345, `getSeparationTimecardData` :852-894, and
`resolveSeparationTimecardDates` :817-834. Login flow from `src/infra/auth/login.ts` :772-852.

NOT ported: the calendar path (above), `search.resultEmployeeId()`'s bare `getByText(eid)` (it can
hit the search box's own echo of the query), and the `loadingOverlay` CSS union (legacy marks it
`NEEDS LIVE RE-VERIFY` and none of its classes matched the live build).
