# Backend compositions, runtime and BFF

Root instructions apply. Read this file before backend or CLI composition changes, even when the
task starts at the repository root.

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

Before changing a seam, read the relevant
`docs/reference/frontend-backend-integration.md`, `dashboard-surfaces.md`, and
`clock-config-secrets.md` contract before changing behavior. Exact routes and composition order
belong in source and their tests.
