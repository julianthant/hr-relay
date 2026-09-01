# DCA4 A6 — D183 registration diagnosis

Read-only nativeSol `01a052f3-1069-7531-8ddb-949bd903ebd7`, high240k/220k. HEADeda17b27;
schema/producer are dirtyDCA4 additions, both audit files HEAD-identical. Fullcoverage05 actual
red line179 proves missing registration, not demonstrated leakage. No gate/edit during diagnosis.

The complete ArchivedCaptureResourceWireSchema belongs to operator-loopback, as existing
ArtifactResourceWireSchema. runId/artifactId closed UUID-pattern strings; resource.state closed
literals. resource.downloadUrl is repository-authored fixed route+encoded exactIDs; reason/message
are repository-authored fixed missing/verification sentences, never raw exception text. URL runtime
refinement does not make its JSON-schema string leaf closed. No newclassification/policy needed.

Proposed minimum: import/register complete schema and exactly three origin rows in
tests/unit/architecture/helpers/redaction-surface-audit.ts; clarify existingarchive disposition.
Add registry/origin pins plus actualbuildArchivedCaptureResource+verifier canaries in
tests/unit/architecture/redaction-surface-scan.test.ts. Preserve all existing scanner/matrix
completeness/canary controls; no wholeinventory replacement or consumer waiver.

Exercise all nine known sentinels, verify they were planted, then exact requested IDs/URL and
fixed reason/message across available/missing/error; assert store invocation and serializedoutput
contains none. Typed canary-bearing missing/corrupt errors are essential: ordinary errors are
normalized by verifier and alone could miss query regression to error.message. Omit each origin
independently and require rejection; retain scannerpositive controls and reject foreign/canaryURL.

Focused red-capable command: `VITEST_MAX_WORKERS=1 npm run test -- tests/unit/architecture/redaction-surface-scan.test.ts`
in assigned absolute workdir. Native remains idle/read-only until A5writer/light ownership ends.
Independent Tests/Security/Correctness review and finalparent lights required after implementation.
