---
name: hr-debug
description: 'Internal repo-specific debugging for Relay: selector/page-state repair via live probe, structural anchors, registry fix, live re-verification, and provenance; login/Duo/session problems; stale-singleton-BFF fingerprint; checkpoint-key and gate-resume collisions; span/projection gaps; guard/manifest failures; and a dry-run audit proving no submission node by node. Builds on the global `diagnose` skill with fail-loud rules against longer waits, unverified fallbacks, and fixture-only repros.'
user-invocable: false
metadata:
  exposed: "true"
---

# hr-debug

Run the global `diagnose` loop. The canonical [Relay debugging reference](references/debugging.md)
adds Relay's evidence sources, failure classes and forbidden first moves; read it before forming a theory.
