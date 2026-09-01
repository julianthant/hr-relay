# DCA4 wire coverage — read-only native analyst return

Native `sup_analyst_dca4_wire_coverage_classification`, high200k/180k,
01a05381-2047-78c2-b3d1-393bbb5a4390; no writes/gates, now closed.
Provenance HEADeda17b2708286e36542e1e18e9f8ef6a06cf3187. UI/backend/spec labels in dispatch are
SHA256 working-diff/file identities, NOT Git revisions; analyst correctly notes they cannot
replace commit provenance. Shared generic route introduced atc72f0e69772ec2821c1dc8707b8064c723cbf3c1;
Archive route/schema/consumer are DCA4 dirty additions.

| Route | Evidence-backed disposition in THIS checkout |
| --- | --- |
| GET /artifacts/v1/archive/:runId/:artifactId | Guard-recognition false negative: strict resourcewire binds exactrun/idURL (domain/dashboard/archive.ts351–372); query emits after verification (queries/archive.ts258–268); Archive consumes retainedURL in actualimage and Download (surfaces/archive.ts2169–2173,2294–2304). Renderer/realHTTPfixture tests prove actualhref and exactbytes. |
| GET /artifacts/v1/:artifactId | InheritedDCA1 served route (routes/api.ts294–332), no local deliveredbrowserURL/consumer found. Diagnosticwire exposesIDs, clientJSON/manifest door, not thisbyteURL. This is distinct from Archive; final shared/DCA2 integration disposition is coordinator-owned, not a DCA4 deletion or inventedpending entry. |

Primary guard contract: ref frontend-backend-integration§8.8,2414–2425 both-directionroute/client
connectivity; sameowner82–92 allows dedicated immutable artifact routes and client-owned URL boundary.
Scanner helpers/wire-connectivity.ts136–172 accepts onlyapi|events literals and tests376–405 scan only
dashboard/client and phonecapture. Browser-native navigation is a real consumer, not necessarily fetch.

Proposed DCA4-only mechanism (NOT implemented/authorized yet): helper/test recognition of artifact
browser-URL consumption. It must prove retainedwire path + exactrun/idvalidation + actual image/href
consumer; broad source-root/literal presence alone is insufficient. No dummycaller, weakenedscanner,
automaticpendingbinding or productionURLduplication. Genericroute must remain unconsumed by Archive.

Required negativecontrols: mismatched/foreign ArchiveURL refuses; one-IDgenericroute cannot satisfy
two-IDArchivepattern; removeactualArchivebrowserconsumer and orphanroute guard returnsred. Parent
requires concrete implementation proposal/authority before any sharedscanner/config change.

Red-capable focused command: `VITEST_MAX_WORKERS=1 npm run test -- tests/unit/architecture/wire-connectivity.test.ts`.
Affected actual consumers: renderer, ArchivefixtureHTTP and serverArchivecapture routes tests, each
with VITEST_MAX_WORKERS=1. No command was executed by analyst. Full05 raw208–227 remains observedred.
Analyst recommends generic owner reconcile real consumer versus endpoint retirement; parent makes
no global claim about other isolated checkouts and no generic route product decision.
