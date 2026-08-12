# New Kronos store

UKG Dimensions / Workforce Dimensions (WFD), at `ucsd-sso.prd.mykronos.com/wfd`. This store owns the
separations **timecard read** and nothing else. Raw Playwright access and locator recipes stay under
`driver/`; tasks import only the task-safe declaration at `../declaration.ts`.

**It is structurally read-only.** There is no `commit` operation, no `MutationCapability` anywhere in
its import graph, and no `external-commit` element in its UI registry — `auditNewKronosUiRegistry`
refuses one by name. A future write slice adds the capability deliberately; it cannot be inherited.

## Two tasks, because there are two page visits (D194 / doc 01 §2.8)

| Task | Page visit | What it returns |
|---|---|---|
| `new-kronos/search-employee` | the Employee Search results panel | `Total [N]`, every rendered candidate as `{displayName, employeeId}`, the matched row, `Selected [N]`, and which context rendered the panel |
| `new-kronos/read-separation-timecard` | the Timecard | the subject the page displays, the window it is proved to be showing, and the whole grid — last punch, every punch day, sick and holiday days, every raw pay-code row, and the pay codes the classifier did not recognise |

`docs/migrations/separations.md` §2.4 sketches five tasks (`open-timecard`,
`verify-timecard-subject`, `set-timecard-range`, `read-separation-timecard`). That table predates the
extraction-width rule ratified later in the same document. Go To, the subject proof, the range apply
and the grid read are one visit to one page and cannot be re-entered independently — a separate
"set the range" task would hand the next task a page it could not prove it was still standing on.

## Invariants

- **A timeout is never a negative.** WFD's own `There are no items to display.` sentinel rendered in
  **548 ms** live. Silence is the `no-signal` state with its reason and the `search-no-signal` error
  code — never `found:false`. Legacy's `log.warn(...); return false` is the single most dangerous
  thing in its New Kronos code (S35 / pattern D5).
- **Three negatives, three error codes.** `employee-not-found` (WFD's sentinel),
  `search-returned-no-match` (rows, but not this person), `search-no-signal` (the check could not
  run). §4b fails the run on all three; keeping them distinct is what lets a future composition be
  selected on the difference.
- **A mechanical failure is never an empty timecard.** A Go To that never enables, a menu option that
  never renders, a window that did not apply, a grid that was not fully read — each throws with its
  own code. `lastPunchDate: null` is reachable ONLY from a grid whose day set covers the whole
  applied window (S34/S36/S38).
- **The grid is VIRTUALIZED.** A 73-day window renders **51** date rows at `scrollTop: 0`. The driver
  scrolls the pinned viewport and accumulates; `assertTimecardCoversRange` then refuses a day set
  that does not cover the applied window. Legacy reads the DOM once — a punch after the rendered
  window is invisible to it, and the last-day-worked silently regresses.
- **Columns bind BY HEADER NAME.** Legacy hardcodes `[1]=In [2]=Out [4]=Pay code`. A column inserted
  by a WFD release would re-point "Pay code" at "Transfer"; here a missing or ambiguous header is a
  loud refusal naming the observed header row.
- **The applied window is proved by VALUE.** WFD renders the window back into the period label
  (`6/01/2026 - 8/12/2026`), so S40 is a calendar-day comparison, not legacy's "the label changed".
  Padding differs between the two halves, so the comparison is never on strings.
- **The subject is `.emp-nav-id`, never page-wide text.** The searched EID lingers in the search
  chrome, which is exactly how legacy attributed one person's punches to another's separation (S37).
  The panel is closed BEFORE the subject read.
- **Exactly one match, or throw.** Every recipe was counted live at one; there is no `.or()` chain
  and no `.first()` on an ambiguous set.

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
because the row's own `aria-label` carries `Name <name> ID <eid>`).

Behaviour ported from `1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/systems/new-kronos/navigate.ts`: `resolveSearchRoot` :70-84, `waitForEmployeeSearchOutcome`
:142-178 (found beats the sentinel — WFD renders both briefly while the grid loads),
`resolveEnabledGoToButton` :304-321, `clickGoToTimecard` :445-533, `verifyTimecardEmployee` :554-576,
`setDateRange` :1266-1345, `getSeparationTimecardData` :852-894, and
`resolveSeparationTimecardDates` :817-834. Login flow from `src/infra/auth/login.ts` :772-852.

NOT ported: the calendar path (above), `search.resultEmployeeId()`'s bare `getByText(eid)` (it can
hit the search box's own echo of the query), and the `loadingOverlay` CSS union (legacy marks it
`NEEDS LIVE RE-VERIFY` and none of its classes matched the live build).

## Lessons learned

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
  refused on an empty selection (live run `sk-124132-9beb`). Doc 02 §5.3 replay restores VALUES,
  never page state. The search node is `always-rerun` for exactly that reason, and the rule
  generalises to every store slice after this one.
- **2026-08-12: a positive count is evidence; a click is not.** `#goToDropdownButton` is
  `ng-disabled` until Angular registers the slat selection, and WFD publishes its own
  `Total [N]` / `Selected [N]` counters. The driver reads the counter rather than inferring the
  selection from the fact that it clicked a checkbox — and refuses when the counter is absent instead
  of substituting the rendered row count, because a paged or virtualized result set would make the
  two disagree.
