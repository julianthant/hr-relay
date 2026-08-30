# DCC1 M4 — UI preservation and rendered verification

Status: read-only inspection complete; **rendered verification and parity PENDING**.
Native `sup_terra_dcc1_m4_ui`, agent `01a05322-2987-7371-8a62-7d3195615747`,
gpt-5.6-terra/high, 240k/220k. Parent persists this read-only return.

## Immutable inspection

Frozen baseline `13175b13340fec7b5326207fe54f98078d481d7d`, candidate
`1a4eba98436b7321b9055a7da8a6cfb226ab6a50`. `/ui` route: UI diff review, then later
browser/parity verification. Stack: React19, Tailwind4, Lucide, TypeScript, no components.json;
shadcn-specific rules do not apply. Web Interface Guidelines fetched live; repository contracts
and existing design-system/parity authorities take precedence over generic preferences.

The Settings UI/model, app exit guards, typed query/command clients and form primitive are
unchanged from the frozen baseline. Static preservation observed: one page draft and atomic
expected-revision command, environment-owned disabled leaves, active versus persisted restart
identity and preflight refusal, full navigation/exit guard, server-owned eight-field inventory.

Initial missing `name`/`autocomplete` observation at settings.tsx:483–490 was checked against
both immutable versions: the markup and shared Input forwarding are byte-identical. This is
a baseline metadata observation outside the reconciliation delta, **not a new finding or
acceptance blocker**, and does not authorize an ambient UI redesign. No source was changed.

## Required rendered proof

- `tests/parity/dashboard-reference.spec.ts`: editable Settings (~462–515; three viewports/two
  themes), storage Settings (~556–594), system-hosts/capabilities (~909–952).
- `tests/parity/panel-heading-accessibility.spec.ts`: Settings headings (~37–74).
- Related existing units: settings-editor-surface, preflight-client, settings-takeover.
- Verify page-wide draft/apply/readback, locked environment leaves, restart-required/preflight
  refusal, discard/navigation and preserved rendering with the allocated gate. No browser, build,
  tests or parity ran during this read-only phase. Parent will resume M4 after code stabilizes.

No live authority, real HR workflows, board writes, migration changes, new worktrees or extra
supervisors. No rendered pass is inferred from unchanged source or static inspection.
