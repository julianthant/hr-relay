# Write safety

Relay refuses uncertain writes and reports completion only from validated external proof and durable settlement. The permanent key and compare-and-swap fence allow one unattended commit attempt per intent generation. They do not guarantee exactly-once behavior in an external browser system.

## Owners

| Protection | Enforcing module |
| --- | --- |
| Required completion proof, read probe, and recovery policy | `src/models/task/write-safety.ts`, `src/models/task/task-contract.ts` |
| Transaction pairing and declared probe policy | `src/workflow-kit/flow.ts` |
| Dry-run preview, subject observation, fence, commit, and saved-effect verification | `src/backend/runtime/writes/write-sequencer.ts` |
| Unforgeable commit capability | `src/workflow-kit/mutation-capability.ts`; system driver `commit` methods |
| Permanent keys, intent generations, atomic settlement, and authenticated resolution | `src/backend/storage/sqlite/authority-database.ts`, `migrations.ts`, and `write-commit-contracts.ts` in that folder |
| Negative recovery evidence | `src/rules/write-safety/write-safety.ts` |
| Crash recovery and typed operator resolution | `src/backend/runtime/writes/write-recovery.ts` |
| Resolution target identity | `src/backend/runtime/writes/write-resolution-binding.ts` |
| No generic retry or cancellation over an unresolved write | `src/backend/runs/commands/command-kernel.ts` |
| Immutable terminal evidence receipt | `src/backend/runs/provenance/evidence-receipt.ts`, `src/backend/runs/trust/receipt-service.ts` |
| Confirmed transaction history | `src/models/events/confirmed-operation.ts`, `src/backend/storage/sqlite/transaction-history.ts` |
| Separation identity authority | `src/rules/separations/identity-approval.ts`, `src/workflows/separations/workflow.ts` |

[Task contract](task-contract.md) owns task declaration, observation, and failure shapes. [Workflow model](workflow-model.md) owns graph execution, checkpoints, and gates. [Execution and sessions](execution-and-sessions.md) owns browser leases and workers. [Operator trust](operator-trust.md) owns evidence presentation and egress. [Clock, config, and secrets](clock-config-secrets.md) owns clocks, instance selection, and retained configuration.

## Write contracts

Every `effect: "commit"` contract requires `writeSafety`. `WriteSafetyRuntimeSchema` validates its completion and idempotency declarations. `ReadTaskReferenceSchema` requires `{ taskId, effect: "read" }` for probes and verifiers.

All completion kinds declare these functions and schema:

| Member | Meaning |
| --- | --- |
| `proofSchema` | Canonical JSON schema for landing proof |
| `proofFromOutput` | Extracts proof from a normal commit output |
| `proofFromPresentProbe` | Extracts proof from a positive probe or verifier |
| `outputFromProof` | Reconstructs the full typed commit output during prior-work reuse, recovery, or operator resolution |

The completion union contains three kinds:

- `receipt` validates proof extracted from the commit's output.
- `save-verify` invokes its declared read verifier after the commit callback settles.
- `upload-verify` invokes its declared read verifier. Its optional `unverifiableByPage` declaration requires `policy: "always-park"`, a reason, and an `operatorAttestationExample`. That path parks after the click instead of reporting automatic completion.

`REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY` currently has no admitted contracts. All three current commit contracts use `save-verify`.

`idempotency` declares a read `probe`, a pure `key(input)`, and `recoveryAbsence`. Optional `retiredKeys` identify immutable keys that cannot be interpreted under the current contract. Before a real or dry-run probe, the sequencer rejects duplicate current/retired key material and refuses if any retired key has an intent. It does not rewrite the old row or use it as current proof.

### Probe verdicts

`probeVerdictSchema` in `src/rules/write-safety/write-safety-primitives.ts` admits four states:

| State | Required evidence | Before a new fence |
| --- | --- | --- |
| `present` | Completion proof | Validate proof and reconstructed output; settle prior work without a click |
| `absent` | `AbsentEvidence`: key digest, source, source state, observation instant, query digest, and evidence reference | Continue only when the evidence binds the business key |
| `ambiguous` | Match count, observation instant, query digest, and at least two evidence references | Refuse fence and click |
| `unknown` | Reason and observation instant | Refuse fence and click |

A throwing, ambiguous, or unknown pre-write probe raises `WriteSafetyAuthorityError`. `run-executor.ts` passes that error to node failure settlement, which terminalizes the run as failed. It does not create a parked write or an intent for an unfenced transaction. Post-fence uncertainty instead uses the parked-write protocol below.

A positive probe is not trusted without parsing. The sequencer parses both the declared proof and the full output reconstructed from it. An existing `committed` or `observed-present` intent also requires valid stored schema identities and proof before reuse.

## 3. Permanent identity and storage

`deriveIdempotencyKeyDigest` derives the permanent digest from the system and exact natural key using the `hrauto:permanent-write-key:v1` domain. `WriteIntentRecordSchema` re-derives the key and binding-proof digests from stored fields.

The current SQL tables are `write_intents` and `write_attempts`. `migrations.ts` supplies uniqueness on `(system, idempotency_key)`, `idempotency_key_digest`, and `(intent_id, generation)`, plus triggers protecting identity and settled states. Repository methods parse and authenticate their records before applying transitions.

`WriteIntentRecordSchema` has five statuses:

| Status | Meaning and admission |
| --- | --- |
| `observed-present` | External work discovered without this automation crossing a fence; no attempt or confirmed submission history is created |
| `attempting` | A durable fence exists for the current generation; an active owner blocks another fence, and a lost owner requires recovery |
| `committed` | Validated proof and durable settlement exist; ordinary execution reuses them without another click |
| `retryable` | Contract-valid negative recovery evidence or an authenticated confirmed-absent resolution permits a fresh generation |
| `parked` | An attempted write needs operator resolution; ordinary execution refuses another fence |

The row's `version` supports compare-and-swap. Re-fencing `retryable` increments both generation and version and creates a distinct attempt. It does not delete history. A workflow attempt ordinal and an intent generation are different identities.

Natural keys remain private authority data. Public projections use digest references. `protected-input.ts` and `idempotencyKeyDigestReference` withhold protected-derived digests where required without changing permanent lookup identity. Diagnostic messages identify the contract, code, and evidence category rather than copying observed person values.

### Current write keys

| Contract | Natural key | Probe | Saved-effect verifier | Negative recovery |
| --- | --- | --- | --- | --- |
| `ucpath/create-termination` | `ucpath:termination\|<emplId>\|<effectiveDate>` | `ucpath/match-existing-termination` | `ucpath/verify-termination` | `operator-only` |
| `ucpath/delete-pending-terminations` | `ucpath:pending-terminations-clear:v2\|<emplId>\|<set-digest>` | `ucpath/match-pending-terminations` | `ucpath/verify-pending-terminations-cleared` | `operator-only` |
| `kuali/save-separation-finalization` | `kuali:<documentNumber>\|finalization\|<transactionNumber>` | `kuali/match-separation-finalization` | `kuali/verify-separation-finalization` | `stabilized`: 30,000 ms after fence, two reads at least 5,000 ms apart, same source state |

These declarations live in `src/models/systems/ucpath/{create-termination,delete-pending-terminations}.ts` and `src/models/systems/kuali/save-separation-finalization.ts`.

### Explicit repetition

A source-bound rerun can carry exact server-owned repeat authorization. Ordinary completed-proof reuse remains the behavior when that authorization is absent.

`executeTransaction` checks the source warning set against the current node, task, system, natural-business-key digest, and completion evidence. Missing or stale acknowledgment refuses. A newly discovered relevant completion requires acknowledgment rather than silently becoming prior-work reuse.

`repeatOccurrenceKey` in `src/models/run/rerun.ts` derives one occurrence key from the business digest, consumed confirmation command, and transaction node. The intent retains its `occurrence` provenance. The sequencer queries all intents for the business digest and refuses a different unresolved occurrence. A new occurrence cannot bypass an `attempting`, `parked`, or other unresolved sibling.

A selected repeat reaches fresh prepare, binding, fence, commit, and verification. `isFreshOccurrenceProof` in `src/backend/runtime/gates/repeat-proof.ts` rejects an earlier receipt as proof of the new occurrence. Recovery and operator-present resolution apply the same check. Generic business-key absence cannot settle a repeat occurrence, and an old confirmation cannot authorize another click.

## Sequenced writes

`createWriteSequencer` owns the complete transaction. Its commit path checks both the caller's `dryRun` context and the durable run envelope before any fence or click.

| Stage | Enforcement | Failure boundary |
| --- | --- | --- |
| Resolve and probe | Parse frozen commit input, derive the key, inspect durable authority, and run the policy-controlled read probe | Invalid authority, an active competing owner, a parked key, and uncertain live evidence refuse before a click |
| Prepare | Acquire one exclusive transaction lease and stage the declared prepare task | Failed preparation releases the lease without creating a fence |
| Bind | Observe the prepared page and build `WriteBindingProof` | Missing, malformed, unreadable, or mismatched subject and missing staged-page identity refuse with zero fence and click |
| Fence | Check the monotonic probe-to-fence budget and CAS the intent and attempt into durable `attempting` | `StagedPageDiscardedError` or a lost fence prevents the click |
| Commit | Mint the capability for the fenced generation and binding digest, retain the lease after the fence, and invoke the commit callback | A settled callback failure becomes post-fence uncertainty; an unsettled callback remains owned |
| Verify | Parse commit output and run the completion contract's proof arm on the retained transaction page | Missing or invalid proof and every non-`present` saved-effect verdict park the write |
| Settle | Atomically commit operation authority, checkpoint, confirmation publication, timeline history, and the run transition | A failed transaction leaves no partial accepted settlement |

A competing fence winner can be reused only if it has settled `committed` or `observed-present` proof. An unresolved winner refuses another click.

### Probe policy and age

A transaction node requires `probePolicy` and positive `probeToFenceMaxMs`:

- `always` runs the live probe before each new write.
- `retries-and-recovery-only` can skip the live probe only for an unseen key on the initial ordinary attempt. Durable lookup remains mandatory. Existing intents, retries, recovery, and source-bound execution still require the relevant read.

The sequencer measures probe completion to fence with the injected monotonic clock. An expired budget discards the staged page without clicking. A preview has no fence and does not measure that budget.

### Binding the staged page

`buildBindingProof` in `write-sequencer.ts` observes the subject after preparation on the retained lease. `SubjectProofSchema` binds run, attempt, lease, task, staged page state, observation, and matching expected/observed identity digests.

Person binding normalizes the declared `eid` or `name` and requires exact equality. Both UCPath commits bind the independently resolved displayed name, since reading the typed EID back would echo input. Kuali finalization binds the displayed EID.

An unscoped commit requires a reviewed reason and a valid `UnscopedBindingProof`. The task-contract declaration and `src/models/write-safety/unscoped-commit.ts` own its admitted reasons. Artifact subject binding currently refuses before fencing because its observation arm is not implemented.

`mintMutationCapability` creates frozen objects registered in a module-private WeakSet. `assertMintedMutationCapability` rejects caller-created objects. The capability carries intent generation and binding digest. The UCPath and Kuali driver `commit` methods check membership before resolving their irreversible control. Only the sequencer mints capabilities.

### Fenced callback lifetime and verification

After the durable fence, `withTransactionDriver` crosses `retainAfterFence()`. A deadline or parent abort requests cancellation but cannot prove the callback stopped. The sequencer waits for the callback's actual settlement before releasing its transaction page or parking. A callback that never settles remains process-owned with an `attempting` intent; process loss transfers responsibility to recovery.

Commit `recordData` batches are validated and timestamped at the call but delivered only after callback settlement. Fallible diagnostic delivery cannot interrupt fence-to-click. A task error remains primary when terminal observation delivery also fails.

`runMandatorySavedVerification` in `mandatory-saved-verification.ts` ensures a settled successful callback still reaches the saved-effect verifier when diagnostic delivery fails. Delivery failures are reported separately. A diagnostic program/schema failure remains a failure after verification. `completeProtectedWrite` settles validated proof before non-authoritative settled notifications.

`captureProof` wraps verifier task lookup, input binding, span setup, execution, verdict parsing, and proof parsing within `PostFenceWriteFailure`. `parkAfterFence` persists intent uncertainty before the executor returns `parked-write`. Its closed codes are `unknown`, `ambiguous`, `present-proof-invalid`, `binding-invalid`, and `operator-required`.

## Dry runs

`executeDryRun` admits only `dryRun: "stop-after-prepare"`. It performs durable-key lookup, retired-key refusal, and the same policy-controlled probe admission as a real write.

A settled prior transaction returns an `already-present` preview without staging or observing a subject. Otherwise it stages the page and observes the subject, then returns `TransactionDryRunPreview`. It does not mint a mutation capability, fence an intent, create a write attempt, invoke commit, invoke the post-commit verifier, or write a transaction checkpoint or confirmed-operation history.

`run-executor.ts` records the preview and ends the run at that transaction node. Upstream task checkpoints, gate records, preview events, and terminal rehearsal evidence can still exist. A dry run is not a verified real write. Dry-run evidence accounting uses `writeIntents.countDryRunEvidenceByRun`, scoped to the run rather than global table counts.

## 4. Crash recovery and UNKNOWN refusal

`createWriteRecovery` handles unfinished `attempting` intents. Worker and expired-claim recovery must reconcile these intents before ordinary queue admission. [Execution and sessions](execution-and-sessions.md) describes that scheduling boundary.

The recovery service rebuilds the exact commit input and binds the retained run configuration fingerprint around its read lease. Missing authority or incompatible semantic identity refuses before probing. A failed probe is not absence.

| Recovery evidence | Result |
| --- | --- |
| `present` with valid proof and reconstructed output | Atomic backfill settlement, `proofSource: "recovery-probe"`, no second commit |
| `present` with invalid proof or an old repeat receipt | Park with `present-proof-invalid` or `unknown` |
| `ambiguous`, `unknown`, or a throwing probe | Park with a typed authority reason |
| `absent` under `operator-only` | Park `operator-required` |
| Qualifying stabilized absences, but not enough observations yet | Return `wait { notBefore, observationsNeeded }` |
| Complete stabilized negative proof | Mark the same intent `retryable` and resume the run for a fresh generation |

`evaluateNegativeSettlement` validates every counted absence against the fenced key, query, authoritative source, and source state. Each observation must fall after the propagation window and meet spacing constraints. Future, early, malformed, contradictory, or foreign-key observations cannot grant retry authority. Earlier observations are diagnostic only. Prior observations are held within the recovery episode and recollected after process loss.

`wait` returns a scheduling instant rather than sleeping a worker. Inline same-owner recovery accepts valid positive proof but parks negative uncertainty; stabilized settlement belongs to the standalone recovery service.

Worker Remove and Retry do not reconcile a write. Before profile release or replacement, native
authority refuses held Duo, a current owned claim or an unattributable attempting write. Another
worker's legitimately claimed write does not prevent an unrelated idle member's retirement. An
exact safely released parked UNKNOWN may coexist with worker retirement or replacement; its
intent, generation, attempt, run and resolution remain untouched. Final lifecycle settlement
rechecks this authority and requires the actual supervisor's one-use exit or birth capability.

An UNKNOWN submission never authorizes generic retry, another occurrence, cancellation, or automatic success. It retains its fence until typed positive or permitted negative evidence settles that exact generation.

## 4.1 Parked-write resolution

The command kernel accepts `resolve-write-present` and `resolve-write-absent` only for the current `parked-write` run and `parked` intent. Requests bind run version, intent ID, generation, original attempt ID, binding digest, and `occurrenceKeyDigest`. A stale request or mismatched target changes nothing.

`createWriteResolutionExecutor` provides two arms:

- Confirmed present validates the supplied proof's current schema hash, parses its value, checks repeat freshness, and reconstructs the output. Authenticated settlement records `proofSource: "operator-attestation"`, the checkpoint, confirmation history, and continuation.
- Confirmed absent requires `evidenceNote`, records the operator and confirmation instant, and marks the intent `retryable`. It does not click. The next attempt must prepare, observe, and fence again.

`commitResolvedParkedWrite` and `settleResolvedParkedAbsence` in `authority-database.ts` authenticate the resolution against the command and audit and verify the run CAS. Both preserve the original parked attempt bytes. Resolution is recorded on the intent, not by rewriting the original browser attempt's outcome.

`requireWriteResolutionBinding` checks the consumed semantic surface. Exact contract-closure identity is sufficient. When the closure changes, the module checks workflow identity, descriptor version, transaction node, canonical-input schema, re-derived permanent key, and retained binding identity. Missing evidence, schema failure, and key drift remain distinct refusal categories. There is no force or waiver arm. Settling an intent does not re-plan its run onto a changed descriptor.

`command-kernel.ts` refuses generic retry for parked writes and rejects cancellation over any `attempting` or `parked` intent in the entire cancellation cascade. Resolution must precede cancellation. Confirmed absence resumes to queued, so subsequent cancellation remains subject to the ordinary queue race.

## 6. Settlement, history, and evidence receipts

`executeSequencedWriteCommit` composes one authority transaction around current claim validation, write settlement, and the lifecycle transition. `AuthorityDatabase.commitWriteAttempt` verifies the exact checkpoint output and confirmation instant, run/attempt/claim ownership, intent generation, attempt state, and fenced transaction identity.

The transaction stores the committed intent and attempt, the schema-bound `TransactionOutcome` checkpoint, a confirmation publication, and an `operation-confirmed` timeline event. It verifies lossless reconstruction of ledger and terminal-span facts before returning. Current storage does not use an operation outbox or a ledger-file projector.

`TransactionOutcomeSchema` distinguishes `committed` from `already-present`. It carries proof and output with their own schema hashes. A transaction checkpoint stores the outcome envelope's schema hash, not the bare output hash. The executor reads the exact durable checkpoint back and refuses a missing or mismatched row instead of inventing one from the sequencer result.

`reconstructConfirmedOperation` authenticates history through retained operation, attempt, checkpoint, and publication evidence. `createTransactionHistory` uses one SQLite read snapshot for Activity and explicit exports. It checks owner identity, authenticated deletion where needed, selection completeness, and unique operation/generation identities. Rows retain system, actor, instance, business identity, binding digest, proof source, completion kind, and fence/confirmation times. A prior-work probe is not an automation submission.

Confirmed-operation history is exempt from ordinary timeline expiry. Authorized deletion is governed by `native-run-deletion.ts` and database deletion triggers. Shared evidence remains while a retained consumer needs it; deleting a run cannot release an unresolved fence or manufacture retry authority.

`createReceiptService` reads immutable terminal result or failure, authenticated checkpoints, intents and attempts, and durable gate results. `buildRunEvidenceReceipt` validates those authorities against the descriptor before composing a receipt. A settled transaction checkpoint without its required intent or current proof schema refuses derivation. A terminal label, browser success message, typed transaction number, or log event alone cannot prove a write.

An omitted transaction step produces no transaction outcome or write evidence. An operator-asserted transaction number remains an assertion. It cannot be promoted into a claim that this automation submitted it.

Confirmed-action publication is separate from settlement. `run-executor.ts` publishes a submit fact only after matching the frozen commit action, completed saved-effect verifier, durable checkpoint, and proof digests. Missing or mismatched evidence yields no successful submit fact. Prior-work reuse and recovery do not invent new submit actions. Publisher failure cannot undo durable write completion.

## Separation write protections

### 14.4 Identity gate

`match-identity.ts`, `verifyIdentityApproval`, and the registered graph distinguish independently supplied EIDs from name resolution:

- `document-eid` and `canonical-eid` require an exact UCPath actual-detail read-back and coherent declared origin. They produce `machine-verification` without a gate result.
- `name-resolved` requires the operator's typed identity gate result even when similarity is high. The graph's gate condition is exactly `packet.emplIdSource == "name-resolved"`.

### 14.5 Identity authority and approval evidence

The post-gate task verifies the packet digest, approved EID membership, and `chosenFrom` label. It refuses an EID the packet never showed. A supplied-EID packet cannot consume an operator result. Rejection is a failed identity verification and cannot reach a write.

`identity-evidence.ts` produces the decision packet, disagreements-first comparisons, and persisted risk `approvalShape`, including `type-the-eid`. The gate projection separately derives its presentation `approvalShape`: `choose-a-candidate` when it shows several approvable EIDs, otherwise `one-click`. Disagreeing fields make the served approval confirmation destructive. This presentation does not change the canonical packet, approved subject, schema bindings or evidence digest, and requires a fresh operator confirmation. The packet includes the write plan from `write-plan.ts`; its digest binds the planned values as well as identity. Protected timekeeper values use retained protected-input binding identity in this packet and its digest.

The actual `IdentityApprovalResultSchema` carries the decision, selected EID, choice origin, and evidence digest, or a rejection reason. Actor and instant come from the durable `GateResultRecord` written by the command kernel. Approval cannot be inferred from a browser observation. Fresh staged-page binding remains required in both identity branches.

### 14.6 Approval ceremony risks

Risk 1 is a client that downgrades the server's required identity ceremony to one-click approval. `src/dashboard/surfaces/run-detail/identity/identity-ceremony.ts` accepts the served `one-click` or `choose-a-candidate` shape and refuses unknown or contradictory packets. Candidate choice has no default selection. The dashboard serves and composes approvals only; it offers no rejection. Only the operator's decision is composed locally; the EID origin and evidence digest come from the served packet.

`src/rules/separations/identity-approval.ts` remains the authority: an unshown EID, changed evidence digest, contradictory origin, rejection, or missing required approval refuses before a write. Fresh page binding separately prevents an approved person from being replaced by a different staged subject.

### UCPath termination and pending sweep

`smart-hr-operation.ts` stages the wizard and restricts commit to the named irreversible controls. `UcpathTerminationProofSchema` requires the transaction identity and admissible approval status alongside the exact subject and effective date. A `T…` number or a pre-submit `NEW` value alone is not proof.

The pending sweep is a separate transaction before filing. It admits only the observed complete eligible/protected set. Eligible rows are Pending or Pushed Back termination rows. The v2 key digests stable transaction ID, EID, action, status, date, and normalized name in both partitions.

Prepare re-reads the set and uniquely joins eligible IDs to Transactions in Progress by verified row identity. Changed, extra, missing, or ambiguous rows refuse before selection and fencing. Verification proves selected IDs absent and protected rows unchanged. A validated empty-set no-op has a different key from a later nonempty set.

Before Kuali finalization, `ucpath/verify-termination-filing-present` always re-runs and finds exactly the receipt's stable T ID with matching EID, date, name, action, and admissible status. Missing or changed filing stops before Kuali staging. It does not re-file as repair and does not promote an asserted receipt into controlled-filing evidence.

### Kuali saved-effect proof

`src/backend/systems/kuali/driver/interpreter.ts` stages all twelve finalization fields from typed variables and checks each staged value. It waits for model update rather than treating DOM text as saved data. The commit waits for the specific `submitDocumentV2` response, binds its action and verified payload encodings, and propagates explicit refusal.

HTTP 200, `Ok`, and a success banner are not landing proof. `kuali/verify-separation-finalization` reloads the document, checks its identity, and compares every stored field exactly. Unsupported payload encodings are not guessed. The reload comparison covers all twelve fields even where payload assertions are narrower.

## Verification ownership

[Guards and tests](guards-and-tests.md) owns the verification commands and guard inventory. Current architecture tests cover write-safety contracts, transaction pairing, subject-before-fence ordering, permanent-key dedupe, stabilized negative settlement, atomic write settlement, and identity authority before both commit and terminal sinks. Driver boundary tests restrict capability minting and commit implementation ownership.

The corresponding runtime tests exercise preview, parked resolution, proof verification, and recovery with temporary authority databases and controlled drivers. They do not establish current live system availability or authorize a live write.

## Not built yet

- Artifact subject observation remains a refusal in `buildBindingProof`; the first artifact-writing workflow needs its implemented observation arm.
- OnBase and ServiceNow have no commit contracts; their first writing workflows need positive proof and justified recovery policies.
- Onboarding has no hire commit/probe contract; its workflow needs a stable pre-hire business identity and evidence-qualified duplicate probe.
- Separation workflow cutover still requires operator-approved controlled-write evidence for each write, safe target disposition, and measured probe-to-fence budgets.
- Kuali finalization's configured stabilized policy still needs its own controlled-write propagation confirmation before production reliance.

## Worker reset admission

The native worker-control journal binds an admitted reset to the exact member and process lifetime,
reserved revision, current run/claim/attempt and queued cascade. The SQLite claim boundary and common
`#writeFenceRefusal` used by `fenceAttempt` and `refenceRetryable` respect this reservation. An unsafe
or foreign-owned cascade refuses before reservation. An unresolved historical Stop without reset
identity remains authority-unavailable and blocks admission through its unknown effect.

A reset admitted after a fence leaves the existing write intent, claim, callback and sequencer
ownership intact. Its current-work signal cannot detach the fenced transaction callback, repeat
the external submit, terminally cancel an attempting write, or overwrite UNKNOWN/parked evidence.
Actual read-task callbacks are also tracked by run/claim/attempt across ordinary deadline races;
reset retains the operation until owned settlement, including callbacks that reject or outlive their
task deadline. After actual settlement, known committed evidence permits lawful residual-work
cancellation without repeating the write. A released parked UNKNOWN may coexist with browserless
idle; reset preserves its exact run, intent, attempt and resolution authority. Both lifecycle and final
reset settlement authenticate parked run/intent generation, attempt, workflow, item and original
parked attempt before releasing the barrier. Attempting writes or inconsistent parked identity retain
the reservation. The dedicated authority transaction records idle, closure, exact success and audit
atomically; no client acknowledgement or generic journal setter can supply those facts.


Active claims retain the membership revision and lease generation supplied at genuine admission.
Active transitions cannot rewrite or drop this identity. Historical absent or conflicting lifetime
proof cannot become a current-run join or reset target by attaching a newer lease. Native standing
recovery and failed Stop replacement hold claim and fence exclusion across the old and new
lifetimes until their exact original audit is committed. Replacement never resolves, resumes,
retries or cancels UNKNOWN to manufacture worker readiness.

Failed-lifetime Stop can canonically cancel its exact safe pre-fence graph inside admission, before
the full stopped-owner release check, in one synchronous authority transaction. Missing death,
Duo, browser, graph or write proof rolls back the command, reservation and all provisional run and
journal mutations. Attempting or foreign-owned work cannot use this ordering to become cancelled.
Actual replacement is dispatched only after that transaction commits and rechecks release.
