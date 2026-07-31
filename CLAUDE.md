# HR Automation — rebuild

The ground-up rebuild of UCSD's UCPath HR automation. This repository is **not** production. The
legacy repository at `/Users/julianhein/Projects/hr-automation` runs every real HR transaction and
stays the sole production authority until a single all-at-once cutover (D89/D93).

Seeded 2026-07-31 from `hr-automation@5879004` (branch `feature/rebuild-phase1b`, which stays in the
legacy repo as the pre-split record). Phase 1b is in flight.

## Before you start

**`docs/rebuild/` is the plan SSOT — read it, do not re-derive it.**

- `docs/rebuild/07-master-plan.md` — phases, work items, exit criteria. §4 owns the two-repo model.
- `docs/rebuild/04-reconciliation.md` — the decision changelog (D1–D93). A **pointer index**, not a
  spec: it tells you which doc owns a contract. Never implement from it.
- `00-charter` · `01-task-contract` · `02-workflow-model` · `03-tracker-dashboard` ·
  `05-execution-parallelism` · `06-data-intake` · `08-foundation-gap-audit` · `09-write-safety` ·
  `10-guard-test-architecture` · `11-clock-config-secrets` · `12-operator-trust` ·
  `13-frontend-backend-integration` — each owns its contracts.
- `docs/rebuild/guard-inventory.json` — the reviewed guard manifest. `tests/unit/architecture/`
  must match it exactly, both directions.
- `docs/rebuild/reviews/` — history. Superseded by the owning docs wherever they differ.

**A decision is not ratified until it lands in its owning doc, in the same commit that records it.**
Doc 04 gets a one-line pointer; the owner gets the normative text.

## Commands

```bash
npm run typecheck          # tsc --noEmit over src/, tests/, scripts/ — one program, no exclusions
npm run lint               # eslint src tests scripts --max-warnings 0 — zero-debt, no manifest
npm run test               # every vitest project (unit + architecture)
npm run test:architecture  # the guard suite alone
npm run test:coverage      # 60/80 lines/statements/functions floors + the suite-size report
npm run test:watch

npm run rebuild:cli        # the isolated rebuild runtime (help | phase)
npm run rebuild:dashboard  # reserved — lands with the 1g-spine BFF
```

The gate family is deliberately plain (`typecheck`/`lint`/`test`/`test:architecture`); the old
`*:rebuild` names retired with D93. The **runtime** commands stay `rebuild:`-prefixed on purpose —
see "Operational isolation" below.

## What lives where

| Path | Contents |
|---|---|
| `src/` | the rebuild runtime (`domain` → `infra`/`services`/`stores` → `core` → `control`/`workflows`) |
| `tests/unit/` | domain unit tests |
| `tests/unit/architecture/` | the guard suite; every file registered in `docs/rebuild/guard-inventory.json` |
| `tests/scenario/` | reserved for 1e's executable scenarios (absent until its first file — an empty root fails on purpose) |
| `config/` | `legacy-change-accounting.json`, `legacy-capabilities.json`, `legacy-test-disposition.json`, `runtime-isolation.json` |
| `docs/rebuild/` | the plan SSOT — kept at this exact path so every cross-doc link still resolves |
| `duo-autopilot/` | the Duo MFA WebAuthn extension (vendored; credentials are gitignored) |

## Fail loud — no unverified silent fallbacks

**The system this replaces submits REAL HR transactions. Correctness beats graceful degradation
every time.** A fallback that silently substitutes a plausible-but-wrong value when something fails
is the single most dangerous pattern here — it hides the failure and can push wrong data (wrong pay
rate, wrong person, wrong department, a blank or duplicate document, a false "submitted") into a
live UCPath / Kuali / Kronos / OnBase / I-9 transaction, or mislead the operator into acting on a
lie. When it fails silently we never find out; when it fails loud we fix it.

**The rule:** when an operation fails or an expected value is missing, do **NOT** substitute a
default, an alternative selector or element, a cached-or-"latest" value, a fabricated constant, a
"safe" guess, or a swallowed-error return, and then continue as if nothing happened. **Throw with a
legible message naming the offending value / EID / field**, so the error surfaces and gets corrected
at the source.

**A fallback is acceptable only when BOTH hold:**
1. The fallback path is itself **verified correct** for the exact case it handles (live-verified for
   selectors and page state; test-pinned for pure logic) — and its verification is recorded (a
   `// verified <date>` comment, a lesson, or a test), AND
2. Absence, or the fallback case, is a **genuinely valid expected state** (e.g. "no search results"
   is a real outcome; a documented default that is provably right).

If you cannot satisfy both, **fail loud**. When in doubt, throw.

**Not a fallback (these are fine):** retrying the *same* operation on a transient error — that
re-runs the operation, it does not substitute data. Swallowing an error is fine only when the
*action itself* is genuinely optional AND the caller does not treat the result as load-bearing.

**When you catch, don't swallow:** a `catch` that returns a default / empty / `{}` / `null` / `0` /
`true` and lets execution continue must instead re-throw (or at minimum log AND propagate a
distinguishable "unknown" the caller checks). Never let "the check failed" become indistinguishable
from "the check passed / found nothing." `catch { won = true }`, `catch { return [] }`,
`JSON.parse(...) catch { return {} }`, `.catch(() => ({ match: true }))`, and `?? "queued"` on
corrupted input are bugs, not resilience.

This tree is zero-debt from its first file: `npm run lint` carries `--max-warnings 0` and there is
no debt manifest. The mechanical arms live in `tests/unit/architecture/helpers/ratchet-arms.ts`
(fail-loud-catch-default, nullish-literal-data-fallback, wait-for-timeout, inline selectors,
evaluate-named-fn, import cycles, layer matrix, code conventions, tailwind palette), each executed
against a violating fixture by `guard-manifest.test.ts` so a dead arm cannot stand in for
enforcement.

## Cross-repo rules (D93)

**The legacy repo is a frozen production reference, not a dependency.**

- **Never import, invoke, proxy, or read the legacy repo's live state from `src/`.** Two
  repositories share no module graph — this is now structural, not merely banned. The only code
  permitted to reach across is the **guard lane**, which audits legacy as data.
- **Porting = copy with provenance.** When you bring verified knowledge across (a selector, a
  parsing rule, a page-state fact), copy it and record **the legacy commit hash and source path** in
  the ported code. Never link it at runtime — which is impossible anyway.
- **Every legacy maintenance change must be recorded HERE**, in
  `config/legacy-change-accounting.json`, against the affected capability ids and the rebuild
  evidence it may invalidate, keyed by the **legacy repo's** commit hashes. Doc 10 §3.13 makes this
  the program's *only* drift detector now that the same-tree scan is retired — it is load-bearing,
  not corroborating. `legacy-change-accounting.test.ts` fails when the manifest and the legacy repo
  disagree.
- **Nothing in the legacy repo may be deleted** during the rebuild or the initial cutover. The whole
  repository is the D89 rollback asset.
- The guard lane finds the legacy repo at `../hr-automation`, overridable with
  `HRAUTO_LEGACY_REPO`. It **fails loud** when the repo is missing — a skipped legacy audit is
  exactly the drift D93 warns about.
- Inventories that span both repos (`src/domain/runtime-environment.ts`) mark legacy paths with an
  explicit **`legacy:` scheme**. Both repos have a `src/` — `src/cli.ts` exists in both — so a bare
  path is ambiguous. Unprefixed always means this repo.

## Operational isolation

A repository boundary does not separate two runtimes on **one machine**. `config/runtime-isolation.json`
pins what must differ, and `operational-isolation.test.ts` proves it:

| | legacy | rebuild |
|---|---|---|
| state root | `.tracker` | `.tracker-rebuild` |
| artifact root | `.tracker` | `.tracker-rebuild/artifacts` |
| backend / frontend port | 3838 / 5173 | 3938 / 5174 |
| process locks | `.tracker/daemons` | `.tracker-rebuild/locks` |
| browser profile / session | `.auth` / `hrauto-legacy` | `.auth-rebuild` / `hrauto-rebuild` |
| launch commands | `dashboard`, `dashboard:prod`, `dashboard:watch` | `rebuild:dashboard`, `rebuild:dashboard:prod`, `rebuild:cli` |

The runtime command names stay distinct across both repos so a muscle-memory `npm run dashboard` in
the wrong checkout can never start the wrong runtime. Isolation values reach the runtime through one
exported direct-`const` `defineRuntimeIsolation` call that a composition root invokes at top level —
an identifier mention, or a call inside an uninvoked function, is not proof.

## Live verification — standing pre-authorization (always available, never ask)

**The live environment is always available, and reaching it for verification is pre-authorized.
Never ask whether live access is up, whether to spend the live session, or to confirm a Duo prompt —
assume yes and proceed.** This covers the whole range: a read-only selector `snapshot`, a login smoke
check, a live collector, and a full live workflow dry-run against real UCPath / CRM / Kuali /
ServiceNow / I-9. Duo is cleared hands-off by Duo Autopilot on every verification path, so there is
no phone-approval step and nothing to sign off. The safety boundary for a live *workflow* run is
`dryRun=true` (no UCPath transaction, no Kuali finalization) — that, not gated access, is what keeps
a live run safe. If one system is genuinely down, skip it and proceed with the rest.

Mapping or verifying a selector is **pre-approved** — do it whenever a fix or debugging needs it, and
never pause to ask. A `snapshot` is a read-only view of a page; treat it like running a test.

`playwright-cli` runs **headless by default**. The loop is: open headless → `snapshot` → read the ref
ids → confirm or repair the locator.

```bash
playwright-cli -s=sel open "<url>"          # headless — just omit --headed
playwright-cli -s=sel snapshot              # accessibility tree + ref ids
playwright-cli --raw snapshot > /tmp/s.yml  # grep-friendly dump for big pages
playwright-cli -s=sel close
```

**Auth-gated pages (UCPath/PeopleSoft, CRM, Kuali, ServiceNow, I-9) — use Duo Autopilot.** The
`duo-autopilot/` extension answers the Duo MFA WebAuthn ceremony itself, so an auth-gated login runs
unattended. You still fill the SSO username/password from `.env`
(`UCPATH_USER_ID` / `UCPATH_PASSWORD`). It needs Playwright's **full** bundled Chromium
(`channel: chromium`) — the lightweight headless shell cannot load extensions. See
`duo-autopilot/README.md`. The one thing it cannot do unattended is a brand-new credential
enrollment.

**Always** `close` the session when done and sweep orphans (`playwright-cli list` →
`playwright-cli close-all`) — these are real Chromium processes.

Until this repo grows its own driver layer, live *selector* work still happens against the legacy
repo's registry; port what you verify with provenance (see cross-repo rules above).

## Environment

`.env` is gitignored and NOT part of the repo. Copy `.env.example` and fill it, or copy the legacy
repo's `.env`. `src/domain/config/resolve.ts` implements `env > settings.json > default` exactly
once; `src/domain/secrets.ts` is the **only** module permitted to read a credential from
`process.env` (`secrets-single-source.test.ts` enforces it). A credential must never be interpolated
into a message — `no-secret-values-in-logs.test.ts` enforces that half.

## Conventions

- No default exports.
- Kebab-case filenames; `.tsx` only under `src/dashboard/`.
- `verbatimModuleSyntax` + `.js` extensions on relative imports.
- Every durable / wire / config boundary is a recursively strict zod schema; no open records at a
  boundary, no `any`, no unchecked assertion (`strict-boundary-schemas.test.ts`).
- All time reads go through `src/domain/clock.ts` (`clock-single-source.test.ts`); `manualClock` is
  test-only (`manual-clock-test-only.test.ts`).
- Registry exports are recursively frozen at module load (`src/domain/immutability.ts`).
- Structured errors, never `console.*` in `src/`.

## After changes

Run `npm run typecheck && npm run lint && npm run test && npm run test:architecture` before
committing. Add a new guard file **and** its `docs/rebuild/guard-inventory.json` entry in the same
commit — `guard-manifest.test.ts` checks both directions. Retiring a guard requires an explicit
`retired` entry naming the deciding decision and where the invariant went; a guard that simply
disappears is indistinguishable from an accident.

Never push to any remote without explicit instruction.
