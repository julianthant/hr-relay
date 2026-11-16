# Backend compositions, runtime and BFF

Read [the architecture](../../docs/ARCHITECTURE.md) and
[codebase map](../../docs/reference/codebase-structure.md#backend) for composition and module owners.

## Product boundaries

- Build for one operator on one machine. Add no multi-user, remote-client or hosting layer.
- Admit backend use only through the operator's dashboard. The dashboard assistant may use
  allowlisted reads and propose actions through the dashboard-owned typed client. Dispatch a
  validated proposal only after explicit operator confirmation. Give the assistant no arbitrary
  backend, shell, HTTP or credential access, gate approval or safety bypass. Allow no other agent
  or external API access.
- Limit product AI to OCR and the dashboard assistant through the operator's ChatGPT subscription.
  Connect Settings with OpenAI's open-source "Sign in with ChatGPT" flow: OAuth with PKCE, a
  loopback redirect and the Responses API. Store tokens only in the local credential store.
  Add no other AI provider.
- Keep HTTP parsing and application composition thin; repositories own durable storage.
- Publish workflow outputs through the Spreadsheets library, never loose files.
- List used task contracts without a store implementation in
  `src/backend/app/registries/pending-impl-bindings.json`; keep the correspondence exact.
- Bind browser tasks to the store's exact `DriverDeclaration<ConcreteDriver>` with
  `defineTask(driver, contract, impl)`. Do not narrow a driver to `{system}` or create another
  declaration for the same store. Service/workflow tasks use `defineTask(contract, impl)`.

## Invariants

- A long-lived CLI command owns and awaits shutdown. Keep signal handlers installed throughout
  the drain, retain the lifetime listener through worker shutdown, and propagate a failed stop. After clean resource closure, create verified person backups and retain the last three shutdown
  backups before releasing the lifetime listener; pre-erase and pre-upgrade backups stay protected.
- Acquire the genuine root lifetime before installation effects and retain that same capability
  through admissions, composition and recovery. Inherited workers receive it over actual IPC.
  Prior fixed mutex cleanup runs only during the root's first workspace initialization; synchronous
  mutation callbacks retain their distinct file locks, and awaited drains stay outside those locks.
- Admit request identity once, then pass the derived actor to services. Caller-supplied identity
  fields must agree before effects; do not backfill historical actor evidence.
- Every browser-reachable mutation passes the registered loopback Host/Origin guard before its
  handler or body effects. JSON envelopes also require the declared content type. Keep the exact
  route/admission table and its architecture guard synchronized.
- SSE drains on demand through the one bounded queue. Respect socket backpressure; overflow is
  one reset-required response, not an unbounded stream-controller push path.
- Production static serving validates the bundle before authority/locks/sockets, registers last,
  checks lexical and realpath containment, and uses the closed extension/cache policy.
- Run resources first admit exact run membership through RunRecordService.read, then bind evidence
  to the immutable run/digest and retained capture metadata. Never reconstruct evidence from current
  inputs or infer purge from a deadline; preserve safe download headers.
- Boot upgrades supported registered person databases under stopped exclusive custody with a verified
  backup before mutation. Startup restores SQLite-damaged same-person authority only from a verified
  backup preserving current write evidence and credentials; missing, foreign, future, version-skewed or
  unprovable authority holds only that person's admission. Ordinary readers accept only the current schema.

Before changing behavior, read the relevant [frontend/backend contract](../../docs/reference/frontend-backend-integration.md),
[dashboard contract](../../docs/reference/dashboard-surfaces.md), and
[configuration contract](../../docs/reference/clock-config-secrets.md).
Keep exact routes and composition order in source and tests.
