# Shared artifact serving — source findings and proposal boundary

2026-08-30. G45 is a READ-ONLY proposal owned by the existing DCA2 supervisor under
briefs/dca-shared-prerequisites.md. No implementation, test or gate is authorized here.

| Claim | Classification | Coordinator evidence |
|---|---|---|
| Real open is eager before it returns a Readable | source-proved | Main312029 reads complete infra/artifacts/content-addressed-artifact-writer.ts: readFile UTF8 → JSON.parse → full base64 decode/copies/digest checks → Readable.from([copied bytes]) |
| A spool after existing open would not bound production payload memory | implication of source | The full read/decode has already occurred; verification-only dashboard calls also reach this path |
| Actual adapter has additional lifetime seams | source-proved, behavior unrun | Main2f1821 reads complete server/dashboard/http-server.ts: Request has no forwarded abort signal; app.fetch precedes response reader/close hookup; drain waits only for drain; reader cancellation rejection is discarded |
| HEAD may discard a GET body | source-proved, proposed-resource cleanup unrun | Installed Hono4.12.34 hono-base.js278–279 dispatches GET then constructs Response(null, response); version confirmed39d735 |
| Shared source matches in both DCA trees | proved | Maina26016 byte comparison of writer, adapter and dashboard artifact verifier |

Exact common inputs:

- src/infra/artifacts/content-addressed-artifact-writer.ts,9511bytes,
  SHA2562bc848a127e8b8ce0d9a4c7f0ab2dfc8622b012eaccba168e38fcf92a6f3fdc3.
- src/server/dashboard/http-server.ts,4266bytes,
  SHA2561cdfd4dcf0134f667923da43ceb32636906532edb538a02a6ba312cc873bd3d9.
- src/server/dashboard/queries/artifact-bytes.ts,7404bytes,
  SHA2560d7ffd313015837b8323d55ab98eb29cb0ae07cb72bc8057f8365eb94d12f76c.

Owning task-contract §2.3 (main39d735) fixes the public put/open capability, exact reference
identity/digest/metadata and existing publication/owner-temp rules. The proposal must distinguish
a compatible bounded reader for the current JSON/base64 format from a new persistent format,
retention policy, broad put-path rewrite or altered public capability. None of those changes is
silently approved. Existing E29 whole-bundle/selected-second-pass verification, route-specific
errors and verified Range416 stay required.

G45 includes the minimum reader, HTTP response/body lifetime, pre-response cancellation, HEAD,
close/backpressure and cleanup seams and their proof requirements. A source concern is not a
measured leak or reproduced failure; runtime behavior and the eventual bounded mechanism remain
unproved. The one existing unit continues; no new review/preparation cycle or duplicate writer.
Its final proposal remains pending at assigned reports/dca2-g45-shared-serving-proposal.md.

Read-only path-discovery mistakes are not product failures: first HTTP grep used the absent
src/server/http-server.ts; actual discovered dashboard/http-server.ts was then read fully.
2f1821 exited2 solely because later nearest-AGENTS probes named absent paths. No test ran and
neither command is reported as a green gate. Candidate/source/reference state was not changed.
An initial coordinator documentation patch rejected its last context before any edit; f732fa
verified root still clean, then this exact corrected documentation patch was applied.
