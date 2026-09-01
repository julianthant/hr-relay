# DCA joined J2 authority map — native return

Task: `sup_analyst_j2_root_authority_reconciliation`

Agent: `01a0586b-e789-7643-8285-bff3d6948641`

Role: `sup_analyst` (Terra, high)

Status: PASS — no coordinator judgment required.

Root owner commit `2e173e5c` postdates the two candidates' common base `eda17b2`; its owner text governs. The joined candidate reconciles the stopped implementation claims with that owner text:

- retain `task-contract.md` D291's private incremental reader and opaque lease contract;
- retain three distinct authorities in `frontend-backend-integration.md`: generic indexed (DCA1), exact bundle (DCA2), and frozen Archive (DCA4), with no arbitrary artifact access, generic status/gallery, or new producer;
- retain `dashboard-surfaces.md` D292 all-origin projection and literal-`failure` framing, plus DCA4's frozen-run-only Archive detail;
- retain DCA2's exact-bundle route and accounting beside generic and Archive routes;
- describe the candidate as implemented with joined rendered/heavy proof pending until J4 succeeds;
- remove only the captures pending binding because it now has a mounted consumer; preserve every other pending row;
- retain the root decisions pointer and remove candidate duplicate ratification text;
- treat `docs/roadmap/index.html` as generated output only, not hand-edited authority.

The required freshness order is: reconcile docs/wire, regenerate and check the manifest, generate/check the roadmap, run wire connectivity, run locked typecheck/lint, then full coverage and asserted parity.

`operator-trust.md`, `lessons.md`, and dashboard `AGENTS.md` are supporting implementation lessons, not D291/D292 owners; keep only non-duplicative wording that matches the joined code.

No test, gate, or write was performed by this analyst.
