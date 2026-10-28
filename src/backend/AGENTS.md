# Backend compositions, runtime and BFF

Root instructions apply. Read this file before backend or CLI composition changes, even when the
task starts at the repository root.

## Invariants

- A long-lived CLI command owns and awaits shutdown. Keep signal handlers installed throughout
  the drain, retain the lifetime listener through worker shutdown, and propagate a failed stop. Shutdown does not imply
  a backup: backups are explicit-only.
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
- Boot/upgrade follows the current authority contract; ordinary startup never converts an incompatible database.

Before changing a seam, read the relevant
`docs/rebuild/reference/frontend-backend-integration.md`, `dashboard-surfaces.md`, and
`clock-config-secrets.md` contract before changing behavior. Exact routes and composition order
belong in source and their tests.
