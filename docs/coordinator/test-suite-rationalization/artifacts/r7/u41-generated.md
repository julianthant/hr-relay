# R7 u41 — roadmap, manifest, and generated-authority disposition

R7 changes test configuration, test/support sources, instructions, and normative test/performance
contracts. It changes neither a workflow descriptor import closure nor roadmap node/status truth.
The generated roadmap site also embeds excerpts from owning reference documents, however, so the
authority amendments legitimately changed its one-line JSON payload even though
`docs/roadmap/roadmap.md` did not change. Therefore:

- the workflow build manifest requires verification but no regeneration;
- the roadmap source requires no edit, while `docs/roadmap/index.html` must be regenerated from the
  unchanged plan plus the amended owning references;
- no phase completion, migration status, T1b live result, or product feature changes;
- the historical roadmap/D5 value 5,568 remains a correct dated measurement and is not rewritten;
  current executable authority is the 2026-09-02 §7.4 addendum at 5,569;
- scenario path authorities were already reconciled by R5a and remain current.

The first final `npm run build:manifest:check` passed. The first final `npm run roadmap:check`
correctly failed stale; `npm run roadmap` produced exactly one generated-line replacement in
`docs/roadmap/index.html`, attributable to the changed embedded authority excerpts. After that
generated artifact is committed, both freshness checks are rerun in u42. No workflow manifest or
roadmap-plan source regeneration was required.
