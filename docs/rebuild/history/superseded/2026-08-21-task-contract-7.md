# Superseded — `reference/task-contract.md` §7, "Alternative shapes for the core contract"

**Superseded by** `docs/rebuild/reference/task-contract.md` §2.2, which states the chosen shape
normatively as what shipped. **Do not cite as normative.**

Written 2026-07-17 with the rest of doc 01, moved here 2026-08-21 by the docs/roadmap cohesion
plan's per-doc rewrite (step 5.1). The three-way comparison below decided the core contract's shape
before any of it was built: **B** — plain objects plus `defineTaskContract`/`defineTask` factories —
was chosen, and the tree has been B since Phase 1d (2026-08-01). The section is preserved because
the ARGUMENT is what keeps someone from re-litigating it: A's fatal flaw (a subclass can override
`run` wholesale, and metadata behind a constructor breaks the bundle-safe contract split) and C's
(partially-built states exist at runtime) are still the reasons not to change shape.

Two live citations resolve here: `reference/foundation-gap-audit.md` §"Pure-logic unit" and
`reference/guards-and-tests.md` §10 both cite **§7B** for "a task is a plain object, so
`task.impl.run({ input, ctx: fakeCtx })` is the whole unit-test story", and
`src/infra/browser/login-contract.ts` cites it for the same shape at the session seam. What they
are citing is true and now lives in `reference/task-contract.md` §2.2 (the contract/impl split) and
§2.3 (the ctx a fake must supply).

---

## 7. Alternative shapes for the core contract

### A. Class-based (`class SearchPersonOrg extends Task<In, Out>`)

*Pros:* familiar OO decoration via subclassing; instanceof dispatch; per-task private helpers.
*Cons:* subclass-decoration is exactly the **fork** we're banning (a subclass can override `run`
wholesale and drift from the base — today's cross-spec `approveTo!` borrowing with more ceremony);
zod schemas as `static` members break inference ergonomics (`z.infer<typeof X.input>` on statics
needs annotations); `this`-binding traps in hooks; metadata is behind a constructor, so descriptor
projection needs instantiation — fatal for the bundle-safe contract split (D3).

### B. Plain object + `defineTaskContract`/`defineTask` factories (recommended)

*Pros:* matches the codebase's proven `defineWorkflow` idiom; **best-in-class zod inference**
(generics flow from the literal object; no annotations at call sites); the contract IS plain data →
descriptors and the dashboard import it directly with no Playwright in the graph (D3); decoration
is a pure wrapper returning the same type (fork-resistant by construction); trivially
unit-testable (`task.impl.run({ input, ctx: fakeCtx })`); load-time validation in two small
factories.
*Cons:* no inheritance for shared behavior — shared behavior must live in `impl/` helpers (which is
what we want); the generic signatures of the factories are gnarly (one-time cost in
`domain/contracts/base.ts` + `base/task.ts`).

### C. Fluent builder (`task("ucpath/x").input(S).output(S).run(fn)`)

*Pros:* reads nicely; can stage type inference per call.
*Cons:* partially-built states exist at runtime (forgot `.run()` compiles until the terminal call is
required — needs extra type machinery); worse error locality (a schema mismatch points at the
builder chain, not a field); more base machinery to maintain; harder to grep (task shape varies).

**Recommendation: B.** It is the only shape where (a) the contract is inert data the descriptor
layer can import without executing anything, (b) decoration structurally cannot fork the base, and
(c) the team's existing mental model (`defineWorkflow`) carries over. The builder shape is retained
**only** for workflow composition (ref workflow-model), where accumulating generics genuinely need staged
inference — tasks stay plain objects.
