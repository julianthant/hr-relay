# A record-sanity-check advisory panel
<!-- roadmap: def-sanity-check -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: def-sanity-check -->
- [-] **RETIRED by the operator, 2026-08-18** — no AI feature; the deterministic §14.2 comparison IS the sanity check (D192; `config/legacy-capabilities.json` → `legacy-tool-ops-sanity-check-record`, `disposition.kind: "retired"`)
- [x] the deferral condition D192 named ("renders beside the order-8 ALWAYS-GATE identity approval") was met DETERMINISTICALLY — the gate packet's server-computed `comparisons` array occupies exactly that slot (`ref write-safety` §14.2)
- [x] `AdvisorySurfaceIdSchema` stays closed at its D178 two-value shape, `["failure-triage", "contact-normalization"]` (`src/domain/ids.ts:232`) — no surface arm was ever added
- [x] its two siblings retired with it on the same reasoning (D192): run summary duplicates the receipt, selector suggestion is an unverified selector reaching a live driver
> 2026-08-20 | docs-cohesion 04 | verified against config/legacy-capabilities.json (`kind: "retired"`, reason names the 2026-08-18 ruling) and src/domain/ids.ts:232; nothing left — reopening requires a fresh decision, not a build
<!-- /roadmap-status -->

**This is no longer a deferral. It is retired**, by the operator on **2026-08-18**, and the section
exists to say so where somebody looking for the AI sanity check will look.

**What it was.** The one AI advisory tool D192 kept open. Legacy has an ops script
(`src/scripts/ops/sanity-check-record.ts`) that reads a record and says whether it looks wrong;
D192's plan was to render its rebuild equivalent as prose beside the order-8 separations
ALWAYS-GATE, where a human is already being asked to confirm an identity.

**Why it retired instead of being built: its deferral condition was met deterministically.** The
`ref write-safety` §14.2 identity-evidence packet computes its own `comparisons` array SERVER-side —
the disconfirming evidence, Kuali beside UCPath, leading the packet — and that array occupies
exactly the slot the AI prose was reserved for. Separations' §9.17 live pass flagged the condition
as materially satisfied and left the closure to the operator, who ruled: **no AI feature — the
deterministic comparison IS the sanity check.** A paraphrase of a comparison the server already made
is strictly worse than the comparison: it can be wrong, and it cannot be diffed.

**Its two siblings retired with it** on the same argument, which is worth keeping because it is the
general shape. Run summary → `RunEvidenceReceipt` is already the run's structured,
byte-reproducible, per-field-redaction-declared summary, so an LLM digest over the same facts would
duplicate it and reintroduce paraphrase risk on the exact surface D141 built to remove. Selector
suggestion → an operator-facing LLM selector suggestion is an unverified selector reaching a live
driver, which the fail-loud rule bans outright; the deterministic half (`npm run selector:search`)
stays and is unaffected.

**What retirement means structurally.** `AdvisorySurfaceIdSchema` stays closed at D178's two values
(`failure-triage`, `contact-normalization`) — no arm was added for the sanity check and none will be
— and `config/legacy-capabilities.json` carries the disposition as `retired` with the ruling as its
reason, so the `legacy-capability-disposition` guard (D184) validates it like every other closed
entry. **Reopening requires a fresh decision, not a build.**
