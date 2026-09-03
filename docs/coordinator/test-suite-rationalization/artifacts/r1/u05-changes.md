# R1 u05 — guard rationalization and red-capability repairs

## Decision

Retain all 70 active architecture guard files and all 11 planned/retired manifest rows. Under the
coordinator's ratified policy, apparent overlap is a duplicate only when it protects the same
failure mode at the same seam with the same oracle. The review found one duplicate assertion—not
a duplicate file—and two red-capability gaps.

| Candidate family | Seam / oracle comparison | Disposition |
|---|---|---|
| `gate-coverage` architecture-script assertion / `guard-manifest` project audit | same `package.json:test:architecture` seam and exact-string oracle; manifest also owns recursive include + unit exclusion | merge assertion into manifest; retain both files |
| selector provenance / UCPath strict port | 406-key frozen provenance vs operation semantics/fail-loud/pagination | retain both |
| runtime dependency / provider capability | registry/preflight completeness vs forbidden raw reach/task boundary | retain both |
| identity gate / subject-before-fence / transaction pairing | graph dominance vs live chronology/capability proof vs prepare/commit lease shape | retain all |
| dashboard wire / refresh / wire connectivity | bundle isolation vs Fast Refresh export purity vs served/consumed route reachability | retain all |
| descriptor / delegation / editor / workflow layout | build closure vs child policy vs derived Explorer authority vs filesystem topology | retain all |
| receipt / redaction / secret logs / secret source / advisory | authority classification vs all-egress scan vs interpolation vs env admission vs advisory isolation | retain all |
| worker overlap / teardown soak / storage recovery | concurrent claims vs stop/poison/requeue vs backup/degraded/restore | retain all |
| retired rows | historical decision + explicit surviving owner, or documented no-runtime replacement | retain; strengthen replacement references |

No file/title rename is justified. The reviewed names—including `multi-worker-overlap`,
`worker-teardown-soak`, `storage-recovery`, `subject-before-fence`, `evidence-receipt`,
`workflow-editor-compile-integrity`, and `ai-advisory-no-authority`—predict their protected refusal
families accurately. Cost hotspots have unique real-DB/runtime/whole-tree oracles; the performance
budget is not authority to delete them.

## Exact duplicate consolidation

`gate-coverage` no longer repeats the exact architecture command assertion introduced in u03.
`guard-manifest` remains the sole owner and rejects the old path filter, wrong project, file/glob
narrowing, an extra exclude/config, missing/narrow unit exclusion, and narrow/non-recursive
architecture inclusion. Both guard files remain because their remaining seams differ.

## Red-capability repair 1 — executable gate identity

Before the repair, a temporary inert wrapper passed:

```text
package.json: "typecheck": "echo tsc --noEmit"
Test Files 1 passed (1)
Tests 6 passed (6)
```

With the new exact command audit and the same mutation:

```text
FAIL ... > rejects inert wrappers around every per-commit gate
typecheck must be exactly 'tsc --noEmit'; found 'echo tsc --noEmit'
Test Files 1 failed (1); Tests 1 failed | 5 passed (6)
```

The pure audit also rejects inert wrappers around `lint`, `test`, and `test:coverage`. It pins only
the four per-commit local commands; architecture, roadmap, and manifest registration stay with
their existing specialized guards.

## Red-capability repair 2 — retired replacement integrity

Before the repair, changing `authority-target-no-fallback.replacedBy` from `storage-recovery` to
`storage-recoveri` still produced `6/6` passing `guard-manifest` tests. With the new active-name
cross-reference and the same mutation:

```text
FAIL ... > records every retirement as an explicit replacement rather than a silent shrink
authority-target-no-fallback replacement must resolve to an active guard: storage-recoveri
Test Files 1 failed (1); Tests 1 failed | 5 passed (6)
```

Both temporary mutations were restored. Green focused proof:

```text
$ vitest run tests/unit/architecture/{gate-coverage,guard-manifest}.test.ts --project architecture --reporter=dot
Test Files 2 passed (2)
Tests 12 passed (12)
```

## Residue for R7

- Reconcile `guards-and-tests` historical counts/topology to 70 active files and the named
  architecture project.
- Ratify the self-contained frozen-provenance contract in the broad authority prose. Commit
  `8a96afec` already removed the stale sibling-checkout requirement from the paired root
  instructions; that part of this pre-integration note is resolved.
- Record the coordinator's exact same-seam/same-oracle deletion standard and affected/full/parity
  evidence budgets in the owning test authority without turning budgets into guarantee weakening.
