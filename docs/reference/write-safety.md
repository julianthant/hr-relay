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
| Durable recovery activity, action notes and required read captures | `src/backend/runtime/writes/recovery-activity.ts`, `src/models/run/recovery-activity.ts` |
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

`REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY` currently has no admitted contracts. All current commit contracts use `save-verify`.

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
| `ucpath/create-hire` | `ucpath:hire\|<email>\|<effectiveDate>\|<positionNumber>` | `ucpath/match-hire` | `ucpath/verify-hire` | `operator-only` |
| `ucpath/create-termination` | `ucpath:termination\|<emplId>\|<effectiveDate>` | `ucpath/match-existing-termination` | `ucpath/verify-termination` | `operator-only` |
| `ucpath/submit-paypath-work-study` | `ucpath:paypath-work-study\|<emplId>\|<effectiveDate>` | `ucpath/match-paypath-work-study` | `ucpath/verify-paypath-work-study` | `operator-only` |
| `ucpath/delete-pending-terminations` | `ucpath:pending-terminations-clear:v2\|<emplId>\|<set-digest>` | `ucpath/match-pending-terminations` | `ucpath/verify-pending-terminations-cleared` | `operator-only` |
| `kuali/save-separation-finalization` | `kuali:<documentNumber>\|finalization\|<transactionNumber>` | `kuali/match-separation-finalization` | `kuali/verify-separation-finalization` | `stabilized`: 30,000 ms after fence, two reads at least 5,000 ms apart, same source state |
| `ucpath/save-emergency-contact` | `ucpath:emergency-contact\|<employee-and-effect-sha256>` | `ucpath/match-emergency-contact-plan` | `ucpath/verify-emergency-contact-plan` | `operator-only` |
| `i9/create-profile` | `i9:profile\|<email-lower>\|<first-name-lower>\|<last-name-lower>\|<dob>` | `i9/match-profile` | `i9/verify-profile` | `operator-only` |
| `i9/create-remote-record` | `i9:remote\|<profile-id>\|<start-date>` | `i9/match-remote-record` | `i9/verify-remote-record` | `operator-only` |

These declarations live in `src/models/systems/ucpath/{create-termination,delete-pending-terminations,save-emergency-contact,submit-paypath-work-study}.ts` and `src/models/systems/kuali/save-separation-finalization.ts`.

The PayPath work-study probe and verifier fold the SS Smart HR transaction findings for the EID in
`src/rules/work-study/transaction-verdict.ts`. Before any Save the probe is absent only when no transaction of any
kind shows the effective date; any row on that date is unknown and the run refuses with nothing staged, so an
existing row is never taken as this person's filing. After Save and Submit the commit read-back and the verifier
take as proof the one filed work-study row now on that date and nothing else; two such rows are ambiguous, and any
other row on the date, a Denied, Error or Pushed Back row, or a capped or unreadable search is unknown and parks.
Because the "Saved" answer to a parked write rechecks through the probe, a landed Save cannot settle that way until
a row can be tied to reason JRL or pool F. Four facts behind both folds are unproven live: that PayPath transactions
are listed in the SS Smart HR search, the Action label a work-study row shows, that its start date is the PayPath
effective date, and that the PayPath header name matches the SS Smart HR detail name. Every Save-path PayPath
anchor is unproven too.

Emergency Contact declares the full ordered demotion/addition plan under the OCR release. Its
probe checks the complete persisted protected set, and its key validates the raw desired contact
against the plan. The permanent key uses one SHA-256 digest of the employee and canonical
desired-effect identity. Original and freshly read stable content must agree; observation timestamps do
not become transaction identity. The member authenticates the approved OCR record and native child
lineage before acquiring contacts.

Individual failed-member Retry authenticates the complete item/continuation write history and
any retained transaction mapping before enqueue. A committed or already-present effect, unresolved
natural key or UNKNOWN refuses another member attempt. A settled aggregate's original receipt is
materialized before replacement-dependency mutation; later accounting receives a new immutable
settlement and receipt. Parent Resume and accounting reuse cannot grant descendant mutation authority.
Direct aggregate-member Recover is refused; its operator entry is member Retry. Authenticated
parent-owned continuation recovery keeps its existing scope.

The contact-specific Save driver consumes its retained prepared plan once, checks the mutation
capability, and re-reads the complete staged set before Save. The production page adapter clicks only
when exactly one visible `[id="#ICSave"]` matches, then waits for the busy indicator to hide and the
page to reach `networkidle`. It reopens the contact editor by the retained EID, searches that EID,
checks the expected name, and reads the complete persisted contact set. The task derives proof from a
newer complete read matching the plan; the native sequencer still requires captures around the submit,
fences the attempt, and runs the mandatory independent `ucpath/verify-emergency-contact-plan` verifier
before settlement. Any uncertain post-fence outcome stays parked as `UNKNOWN` and cannot retry Save.

`createContactOperations` keeps its Save port optional. A composition without that port reports
`CONTACT_SAVE_UNAVAILABLE`; the production page adapter supplies it. Integration tests exercise the
member workflow definition against persistent synthetic contact state. Preview captures the original
and final prepared sets and creates no write intent, attempt, or confirmation.

No live Save has verified its success or error UI, settle behavior, persisted reload, `UNKNOWN`
handling, multi-row expansion, typing postbacks, or preservation of Address 3, County, and Same Phone
as Employee. The synthetic fixture proves adapter behavior, not live selector validity or these page
behaviors.

I-9 declarations live in `src/models/systems/i9/{create-profile,create-remote-record}.ts`.
Profile save and remote-record creation have separate intents and proofs. A saved profile cannot
prove remote-record creation. Both proof schemas reject reserved preview values; remote submission
also refuses a staged preview profile before clicking. A duplicate dialog is an uncertain save
outcome, never authority to choose its first row or repeat the save.

### Explicit repetition

A source-bound rerun can carry exact server-owned repeat authorization. Ordinary completed-proof reuse remains the behavior when that authorization is absent.

`executeTransaction` checks the source warning set against the current node, task, system, natural-business-key digest, and completion evidence. Missing or stale acknowledgment refuses. A newly discovered relevant completion requires acknowledgment rather than silently becoming prior-work reuse.

Explicit `run/recover-run` and same-run Resume may carry authenticated continuation; ordinary Rerun
does not capture one. The separate recovery planner validates retained transaction inputs and exact
settlement proof before admission. For a continuation, the sequencer first reads that exact node through `readRunCheckpoint`, which authenticates
the durable owner, issuance, retained sources and checkpoint digest. Only a returned predecessor checkpoint
suppresses repeat authorization for that node. Own-run repeat checkpoints retain their occurrence key.
Predecessor replay still requires the current natural key's
settled durable proof, no unresolved sibling occurrence, and matching descriptor, implementation,
transaction, output and proof schemas. It returns the retained settlement without another probe,
prepare, submit, intent or checkpoint. Missing or unsupported continuation evidence grants no repeat
or replay authority; ordinary source-bound repetition keeps its existing consent checks.

`repeatOccurrenceKey` in `src/models/run/rerun.ts` derives one occurrence key from the business digest, consumed confirmation command, and transaction node. The intent retains its `occurrence` provenance. The sequencer queries all intents for the business digest and refuses a different unresolved occurrence. A new occurrence cannot bypass an `attempting`, `parked`, or other unresolved sibling.

A selected repeat reaches fresh prepare, binding, fence, commit, and verification. `isFreshOccurrenceProof` in `src/backend/runtime/gates/repeat-proof.ts` rejects an earlier receipt as proof of the new occurrence. Recovery and operator-requested rechecks apply the same check. Generic business-key absence cannot settle a repeat occurrence, and an old confirmation cannot authorize another click.

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
| Settle | Atomically commit operation authority, checkpoint, confirmation publication, timeline history, and the run transition | A failed transaction leaves no partial accepted settlement and parks the proven write `UNKNOWN` |

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

After the durable fence, `withTransactionDriver` crosses `retainAfterFence()`, and its lease signal stops following the run's abort. Pause, Stop, shutdown and heartbeat loss cannot reach the commit, the after-submit capture, verification or settlement; only task deadlines bound them. A deadline requests cancellation but cannot prove the callback stopped. The sequencer waits for the callback's actual settlement before releasing its transaction page or parking. A callback that never settles remains process-owned with an `attempting` intent; process loss transfers responsibility to recovery.

Commit `recordData` batches are validated and timestamped at the call but delivered only after callback settlement. Fallible diagnostic delivery cannot interrupt fence-to-click. A task error remains primary when terminal observation delivery also fails.

`runMandatorySavedVerification` in `mandatory-saved-verification.ts` ensures a settled successful callback still reaches the saved-effect verifier when diagnostic delivery fails. Delivery failures are reported separately. A diagnostic program/schema failure remains a failure after verification. `completeProtectedWrite` settles validated proof before non-authoritative settled notifications.

Required captures follow the owned-run probe and prepare and surround submit. A failed post-submit capture
still reaches saved-effect verification, then refuses settlement and parks the original held attempt
even when proof is valid. Missing required capture cannot create a transaction checkpoint or
confirmed-operation history; resolution stays on the typed parked-write path.

Prepare tasks can await `ctx.captureScreenshot()` between browser steps. This uses the retained
session's required capture with the same run, node, attempt, configuration and sample labels.
The capability expires with the lease. Intermediate capture failure aborts prepare before the fence
on both the real and dry-run paths; it does not replace the sequencer's boundary captures.

Standalone recovery and held-only diagnostic checks open a durable recovery activity before their
read probe. It binds the exact run, attempt, trace, node, intent generation and original write attempt,
with actual start and end instants. Only that operation's live scope admits its action notes outside
the ordinary run window. Required probe captures bind the retained run and descriptor fingerprint.
The scope remains open until the actual callback settles, sessions close and the canonical action
notes drain in occurrence order. Notes retain their action timestamps; they do not rewrite run times
or grant submission, settlement or retry authority. Recovery records ordinary actions and captures
without invented attribution.
Cancellation and deadlines stop new action notes
while cleanup waits for the callback. The scope seals before its durable end append; a crash-open
record cannot reopen it. Start/end evidence is protected from ordinary timeline expiry. Failed open
records no recovery notes or captures, and activity, note or capture persistence failure refuses the
check or recovery rather than becoming an ordinary unknown probe result. This path persists directly
through native authority; ordinary worker logging retains its existing emergency fault spool.
Unproved browser or retained-configuration cleanup remains fatal to the worker control, including
when probe, note drain or activity-end persistence also fails. It cannot become a swallowed refusal.

`captureProof` wraps verifier task lookup, input binding, span setup, execution, required step capture, verdict parsing, and proof parsing within `PostFenceWriteFailure`. `parkAfterFence` persists intent uncertainty before the executor returns `parked-write`. Its closed codes are `unknown`, `ambiguous`, `present-proof-invalid`, `binding-invalid`, and `operator-required`.

## Dry runs

`executeDryRun` admits only `dryRun: "stop-after-prepare"`. It performs durable-key lookup, retired-key refusal, and the same policy-controlled probe admission as a real write.

A settled prior transaction returns an `already-present` preview without staging or observing a subject. Otherwise it stages the page and observes the subject, then returns `TransactionDryRunPreview`. It does not mint a mutation capability, fence an intent, create a write attempt, invoke commit, invoke the post-commit verifier, or write a transaction checkpoint or confirmed-operation history.

`SchemaBoundEvidenceValueSchema` owns the durable transaction proof/output envelope. It retains
the protected-store and local test-data evidence grammar; admitted profile provenance belongs to
the run input and outer checkpoint. Transaction producers bind their parsed proof/output values
without copying run-input metadata into those nested envelopes. This keeps transaction-outcome,
local-preview and delegated-preview schema identities stable when a new run-input origin is
introduced. Existing result bytes, completion/dependency digests and receipt links remain intact.

`run-executor.ts` records each transaction preview and continues through the declared graph. A later form can consume a separately declared, labelled preview-only sample; dependent receipt/confirmation reads stay unavailable. Samples never become ordinary outputs, real transaction checkpoints or submit receipts. A live sequencer rejects preview scope, preview bindings and reserved sample values before probing, staging or fencing. Upstream task checkpoints, gate records, preview events, and terminal rehearsal evidence can still exist. A dry run is not a verified real write. Dry-run evidence accounting uses `writeIntents.countDryRunEvidenceByRun`, scoped to the run rather than global table counts.

The shared preview contract reserves `DRY_RUN_TRANSACTION_NUMBER` and the numeric
`DRY_RUN_I9_PROFILE_ID`. Numeric profile samples retain their producer and field labels and use
the same preview admission and real-write refusal as transaction-number samples. Numeric detection
matches a complete digit token, so an ordinary longer identifier containing the same digits is not a sample.

## 4. Crash recovery and UNKNOWN refusal

`createWriteRecoveryService` handles unfinished `attempting` intents. Production worker startup parks unfinished attempts for operator action; the standalone recovery service is not composed into that startup path. Worker and expired-claim recovery must reconcile these intents before ordinary queue admission. [Execution and sessions](execution-and-sessions.md) describes that scheduling boundary.

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

The command kernel accepts `recheck-write` and `resolve-write-absent` only for the current `parked-write` run and `parked` intent. Both bind run version, intent ID, generation, original attempt ID, binding digest, and `occurrenceKeyDigest`. A stale request or mismatched target changes nothing. No command accepts operator-supplied completion proof.
The dashboard's `check-parked-write` command uses an existing idle worker's control journal and session owner for a registered target-system read. Admission binds the installation, profile, operator, worker lifetime and control revision, run version, original intent generation and attempt, node, binding and occurrence digest. The service rechecks retained write authority after reading and closes its sessions before acknowledging. A deadline or unproved closure retains uncertainty. All results leave the run and intent parked, and absence never invokes the confirmed-absent or recovery path.

UCPath termination checks invoke `ucpath/read-transaction-findings` with the re-derived approved subject. The journal retains its exact schema-bound rows, Requested text and completeness, together with descriptor/implementation/claim identity and the closed recovery activity. The acknowledgement digest binds that evidence to its original target. The Runs gate-park query verifies those joins before serving the existing table. Pending selector provenance keeps the held status UNKNOWN and resolution authority false, including an empty or capped scan. This recovery-only read records native activity notes without inventing a workflow invocation. Other supported write families retain their registered idempotency verdict; a matching target state without original-attempt attribution is ambiguous.

The check retains its actual registered task callback across task deadlines and command cancellation. Browser closure does not prove that callback exited: the worker control and retained configuration remain owned until callback settlement, including after a failed close. Expired or cancelled checks cannot publish late success.


`createWriteResolutionExecutor` provides two arms:

- `recheck-write` records an audited request on the parked intent and queues the same run at its transaction node. The lifecycle continuation requires that exact command and node. The worker runs the read-only probe before prepare, staging, fencing, or clicking. Valid present proof settles the intent with `proofSource: "recovery-probe"`, writes the checkpoint and confirmation history atomically, and continues the run. Absent, ambiguous, unknown, throwing, or invalid proof clears the request and returns the run to `parked-write` with a renewed code, message, and time. This path never authorizes retry, including contracts with stabilized negative recovery.
- `resolve-write-absent` records the operator and confirmation instant and marks the intent `retryable`. It does not click. The next attempt must prepare, observe, and fence again.

A recheck optionally accepts `transactionId` only when the completion verifier is `ucpath/verify-termination`. That verifier searches the exact employee and reads only the requested transaction detail. Proof must match the requested transaction ID and the permanent key's subject and effective date. A missing or mismatched record stays parked.

`requestRecheck`, `parkRecheck`, `commitRecheckedParkedWrite`, and `settleResolvedParkedAbsence` in `authority-database.ts` enforce intent CAS and authenticated command/audit identity. Recheck settlement also requires the current running worker claim. The original parked browser attempt remains immutable. The recheck request audit and settled intent authenticate confirmation history and canonical receipts through the recovery-probe proof source.

A lost or crashed recheck claim returns claimed, validating, or running execution to `parked-write`; the intent remains parked and its request is cleared. A fresh operator command is required to check again.

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
- `name-resolved` and `operator-entered` require the operator's identity gate result even when similarity is high. The comparison derives `approvalRequired` for these two origins, and every identity gate tests that fact.
- The optional `operatorEmployeeId` run input is entered only through the declared Job Summary not-found action in Logs. It is absent from start and rerun forms. The action plans a source-version-bound rerun changing only that field, preserving execution options, omissions and private retained input. The entered EID is read exactly in UCPath; the original document EID text or absence remains unchanged in the identity packet. It never becomes a document EID or a machine-verified canonical EID.

### 14.5 Identity authority and approval evidence

The post-gate task verifies the packet digest, approved EID membership, and `chosenFrom` label. It refuses an EID the packet never showed. A document-EID or independently supplied canonical-EID packet cannot consume an operator result. An operator-entered EID cannot proceed without one. Failure correction provenance retains the source run, version, failure ID and input field in the rerun plan and consumed run authorization. The entered EID is classified as a direct identifier; its identity origin and approval requirement are decision facts in receipts and evidence. Rejection is a failed identity verification and cannot reach a write.

`identity-evidence.ts` produces the decision packet, disagreements-first comparisons, and persisted risk `approvalShape`, including `type-the-eid`. The gate projection separately derives its presentation `approvalShape`: `choose-a-candidate` when it shows several approvable EIDs, otherwise `one-click`. Disagreeing fields make the served approval confirmation destructive. The served review carries only display text, masked Employee IDs and opaque gate and candidate refs; the packet, its digest, the result schema hash and node ids stay server-side. The dashboard answers with `answer-identity-gate`, and command ingress resolves its refs against the run's current evidence into the canonical `resolve-gate`, refusing a stale ref. This presentation does not change the canonical packet, approved subject, schema bindings or evidence digest, and requires a fresh operator confirmation. The packet includes the write plan from `write-plan.ts`; its digest binds the planned values as well as identity. New timekeeper inputs bind the admitted profile ID and session epoch in this packet and its digest; caller-supplied names are refused. Kuali receives the exact full display name, including interior accented letters and the combined 129-character profile limit. The shared name validator rejects controls, line separators and padding; it never truncates or transliterates. Staging and save payload checks retain exact readback equality, so an external rejection cannot substitute a different name. Historical protected-store bindings remain immutable evidence. Rerun captures the currently admitted profile identity, while continuation of an existing run preserves its original write evidence.

The actual `IdentityApprovalResultSchema` carries the decision, selected EID, choice origin, and evidence digest, or a rejection reason. Actor and instant come from the durable `GateResultRecord` written by the command kernel. Approval cannot be inferred from a browser observation. Fresh staged-page binding remains required in both identity branches.

### 14.6 Approval ceremony risks

Risk 1 is a client that downgrades the server's required identity ceremony to one-click approval. `src/dashboard/surfaces/run-detail/identity/identity-ceremony.ts` accepts the served `one-click` or `choose-a-candidate` shape and refuses unknown or contradictory packets. Candidate choice has no default selection. Operator-entered EIDs use the same served ceremony as name-resolved identities: UCPath's returned person is shown before approval, with no write before the gate is resolved. The dashboard serves and composes approvals only; it offers no rejection. Only the operator's decision is composed locally; the EID origin and evidence digest come from the served packet.

`src/rules/separations/identity-approval.ts` remains the authority: an unshown EID, changed evidence digest, contradictory origin, rejection, or missing required approval refuses before a write. Fresh page binding separately prevents an approved person from being replaced by a different staged subject.

### UCPath termination and pending sweep

`smart-hr-operation.ts` stages the wizard and restricts commit to the named irreversible controls. `UcpathTerminationProofSchema` requires the transaction identity and admissible approval status alongside the exact subject and effective date. A `T…` number or a pre-submit `NEW` value alone is not proof.

The pending sweep is a separate transaction before filing. It admits only the observed complete eligible/protected set. Eligible rows are Pending or Pushed Back termination rows. The v2 key digests stable transaction ID, EID, action, status, date, and normalized name in both partitions.

Prepare re-reads the set and uniquely joins eligible IDs to Transactions in Progress by verified row identity. Changed, extra, missing, or ambiguous rows refuse before selection and fencing. Verification proves selected IDs absent and protected rows unchanged. A validated empty-set no-op has a different key from a later nonempty set.

Before Kuali finalization, `ucpath/verify-termination-filing-present` always re-runs and finds exactly the receipt's stable T ID with matching EID, date, name, action, and admissible status. Missing or changed filing stops before Kuali staging. It does not re-file as repair and does not promote an asserted receipt into controlled-filing evidence.

### Kuali saved-effect proof

`src/backend/systems/kuali/driver/interpreter.ts` stages all twelve finalization fields from typed variables and checks each staged value. It waits for model update rather than treating DOM text as saved data. The commit waits for the specific `submitDocumentV2` response, binds its action and verified payload encodings, and propagates explicit refusal.

HTTP 200, `Ok`, and a success banner are not landing proof. `kuali/verify-separation-finalization` reloads the document, checks its identity, and compares every stored field exactly. Unsupported payload encodings are not guessed. The reload comparison covers all twelve fields even where payload assertions are narrower.

## OnBase Emergency Contact import

The child-only OnBase workflow extracts one verified source PDF page, probes for that exact page,
then stages the Employee Lookup keyset form. Preparation and commit read back the employee,
required keywords, document type and single-page upload queue. The write sequencer fences one
Import action; dry runs stop after preparation.

`onbase/match-import` and `onbase/verify-import` require exact retrieval filters, a fresh complete
result census, matching employee/document metadata and the downloaded PDF digest. A success
banner cannot prove completion. Uncertain submission stays parked with operator-only negative
recovery; no indexing delay authorizes another Import. Retrieval selectors and the probe-to-fence
budget still require live operator acceptance before activation.

## Verification ownership

[Guards and tests](guards-and-tests.md) owns the verification commands and guard inventory. Current architecture tests cover write-safety contracts, transaction pairing, subject-before-fence ordering, permanent-key dedupe, stabilized negative settlement, atomic write settlement, and identity authority before both commit and terminal sinks. Driver boundary tests restrict capability minting and commit implementation ownership.

The corresponding runtime tests exercise preview, parked resolution, proof verification, and recovery with temporary authority databases and controlled drivers. They do not establish current live system availability or authorize a live write.

## Not built yet

- Artifact subject observation remains a refusal in `buildBindingProof`; the first artifact-writing workflow needs its implemented observation arm.
- ServiceNow has no commit contract; its first writing workflow needs positive proof and a justified recovery policy.
- Onboarding has no hire commit/probe contract; its workflow needs a stable pre-hire business identity and evidence-qualified duplicate probe.
- Separation workflow cutover still requires operator-approved controlled-write evidence for each write, safe target disposition, and measured probe-to-fence budgets.
- Kuali finalization's configured stabilized policy still needs its own controlled-write propagation confirmation before production reliance.

## Worker reset admission

The native worker-control journal binds an admitted reset to the exact member and process lifetime,
reserved revision, current run/claim/attempt and queued cascade. The SQLite claim boundary and common
`#writeFenceRefusal` used by `fenceAttempt` and `refenceRetryable` respect this reservation. The
fence also refuses while the run has a requested pause or cancellation, so each request lands either
before the fence (no intent, the step restarts) or after it (the write finishes). An unsafe
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

Profile credential keys use OS custody through `storage/configuration/credential-key-custody.ts`.
Missing or mismatched entries refuse before decryption; ordinary reads and restores never generate
replacement keys. Ordinary credential erase/logout retains the key and authenticated erasure
history. Cancelled unpublished sign-up removes metadata and then the OS entry under its durable
abort intent; unproved deletion prevents completion. The [clock/config contract](clock-config-secrets.md)
owns the exact migration and backup rules.

UCPath hire filing proofs bind the independently read transaction, legal identity, date and position. Pending proves a filing awaiting approval; it does not mean the person has been hired. Denied, Error and Pushed Back cannot complete the write. New hires may have no assigned EID; a pre-assignment ID is never filled into the master. The entire new-hire or concurrent-hire wizard is staged and captured before fencing, and Save and Submit is clicked once.

Hire event keys retain the verified hire email, date and position across EID assignment or reviewed mode changes. Before master fills, a fresh complete read must prove the exact retained T-number and current filing status. New-hire receipt reuse also checks the independently read Tracker Profile ID against the verified I-9 profile.

Completion-proof descriptions preserve nullable scalar fields explicitly. Email syntax and refinements remain marked for server validation; the completion proof schema still decides acceptance.


Retained schema evidence keeps its original selectors and linked digests. A stopped profile-name
domain conversion validates the supported source grammar and the current registered contracts,
after exact browser/process closure and a verified same-profile authority backup. One settled
`database_upgrades` record certifies each affected frozen owner, source selector, current selector
and canonical source digest. The source includes the entire canonical input, checkpoint, result,
gate, delegation manifest or permanent write intent, preserving signer bindings and command facts.
The conversion does not rewrite those records, completion/dependency links or receipts.

The admission facade seals the complete conversion statement with domain-separated HMAC-SHA256
using the installation's existing profile pepper. Signing requires the exact stopped backed source;
verification binds the installation and profile before reading that key. Credential erasure or key
rotation does not discard the evidence seal. Restart validates the original backup and sealed
certificate, then resumes credential conversion without duplicating the evidence record.

Ordinary receipt, delegation and write-proof consumers use only this current certificate format.
They verify the seal and exact owner/source/target digest, then parse the original value with the
current contract. Missing certificates preserve the original mismatch refusal; changed, foreign,
unknown or future evidence refuses. No historical value parser or historical hash list runs in an
ordinary reader. Execution's descriptor, implementation, claim, gate, UNKNOWN and write-binding
checks remain independent requirements. Source ingress selectors, command requests and immutable
nested transaction envelopes remain original evidence rather than fresh admission authority.
