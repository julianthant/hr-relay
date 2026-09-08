# Task 10-2 · Finish sessions, worker pools, and browser lifecycle
<!-- roadmap: dash-sessions -->

**Current assignment: 3.1.9-2.1.** Former task 3.1.10-2; stable node `dash-sessions`.
Read [Run operations](subphase-9-2-run-operations.md) for dependencies and operator-controlled integration.
The existing filename and historical task heading remain citation aliases, not another assignment.


Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Make every session/pool control execute a real supervisor effect and prove durable membership,
  claims, browser instances, crash/restart, CAS, resize, parallel runs, and orphan cleanup.
