# Decisions — Phase 3 close — 2026-09-03

_Answered positionally by the operator on 2026-09-03: `A and A`._

## 1 · Separations T1b and the 3c-A exit gate

**Situation.** Person Lookup's `live-read` T1b is met. Separations' `dry-run-preview` still needs an
available `finalization-canary`; the registered Kuali document disappeared from the Action List and
the durable result is correctly `blocked/not-started`. D284 forbids silently choosing a substitute.

**Options.**

- **A.** Keep the strict green-live-proof gate and supply a new closed Kuali document number. The
  registry receives a dated `available` observation and the preview is rerun.
- **B.** Treat the typed blocked result as sufficient for 3c-A and record an owed future rerun.
- **C.** Leave 3c-A open until a canary appears without selecting a path now.

**Recommendation.** A when a vetted document is available; otherwise B.

**Notes.** Choice A selects the strict path but does not itself identify the replacement document.
The ignored environment still referenced the retired 4537 canary when the answer was recorded; no
secret value is copied into this artifact.

## 2 · Authorize 3c-B after 3c-A

**Situation.** 3c-B is the bounded final acceptance run for Person Lookup and Separations. It
reconciles the owning authorities, runs the integrated gates, performs the exact lifecycle sweep and
closes Phase 3; it does not start a third workflow.

**Options.**

- **A.** Authorize 3c-B to start automatically once every 3c-A exit condition is green.
- **B.** Leave 3c-B parked for another explicit approval after 3c-A closes.

**Recommendation.** A.

**Notes.** This authorization is conditional. It does not waive the strict Separations T1b result,
the two remaining 3c-A proof units or the integrated gate.

## Answers (2026-09-03)

| # | Chosen | Note |
|---|---|---|
| 1 | **A** | Strict `met` evidence remains required. A new closed Kuali document number is still outstanding. |
| 2 | **A** | 3c-B is authorized once 3c-A is actually green; no further start approval is required. |

Rejected: 1B would weaken the existing exit wording to accept a blocked result; 1C would leave the
path undecided; 2B would add a second approval pause after the already-defined gate.
