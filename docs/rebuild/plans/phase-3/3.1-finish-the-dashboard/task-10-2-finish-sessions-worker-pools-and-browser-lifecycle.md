# Task 10-2 · Finish sessions, worker pools, and browser lifecycle
<!-- roadmap: dash-sessions -->

**Current assignment: 3.1.11.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Historical filenames and headings remain citation aliases, not another assignment.


Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Make every session/pool control execute a real supervisor effect and prove durable membership,
  claims, browser instances, crash/restart, CAS, resize, parallel runs, and orphan cleanup.

Before closing this prerequisite, bind disjoint Setup and Run/Rerun paths, fixtures, generated
outputs and gate resources. Complete shared session-interface changes and demonstrate that both
children can pass independently and merge in either order from this accepted base.
