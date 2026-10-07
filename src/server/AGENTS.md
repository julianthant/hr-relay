# Server compositions and BFF

Root instructions apply. Read this file before server or CLI composition changes, even when the
task starts at the repository root.

## Invariants

- A long-lived CLI command owns and awaits shutdown. Keep signal handlers installed throughout
  the drain, release the exact process lock, and propagate a failed stop. Shutdown does not imply
  a backup: D322 backups are explicit-only.
- Admit request identity once, then pass the derived actor to services. Caller-supplied identity
  fields must agree before effects; do not backfill historical actor evidence.
- Every browser-reachable mutation passes the registered loopback Host/Origin guard before its
  handler or body effects. JSON envelopes also require the declared content type. Keep the exact
  route/admission table and its architecture guard synchronized.
- SSE drains on demand through the one bounded queue. Respect socket backpressure; overflow is
  one reset-required response, not an unbounded stream-controller push path.
- Production static serving validates the bundle before authority/locks/sockets, registers last,
  checks lexical and realpath containment, and uses the closed extension/cache policy.
- Archived resources first admit canonical archive membership through RunRecordService.read, then
  bind evidence to the exact immutable run/digest and frozen capture metadata. Never reconstruct
  archived evidence from current inputs or infer purge from a deadline; preserve safe download headers.
- Boot/upgrade follows the current authority floor and D332. Old integration-lineage lessons are
  history, not permission to migrate an existing database during ordinary startup.

Before changing a seam, search [LESSONS.md](LESSONS.md) for its evidence and traps. Read the relevant
`docs/rebuild/reference/frontend-backend-integration.md`, `dashboard-surfaces.md`, and
`clock-config-secrets.md` contract before changing behavior. Exact routes and composition order
belong in source and their tests; requested new lessons belong in the ledger.
