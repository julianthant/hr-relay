# Workflow migrations

These records hold workflow-specific scope, reuse decisions, scenarios, and dated verification
evidence. Build order and admission belong to the [roadmap](../../roadmap/roadmap.md) and its
owning phase documents. Follow the [workflow authoring guide](../guides/workflow-authoring.md)
when creating or updating a record.

| Record | Purpose |
| --- | --- |
| [Person Lookup](person-lookup.md) | Historical Search evidence plus the current Phase 3.2 Task 5-1 Search/Match acceptance contract |
| [Separations](separations.md) | Historical build/live evidence; Phase 3.2 owns current no-write acceptance and Phase 3.3 owns controlled commits |
| [Separations legacy behavior](separations-legacy-behavior.md) | Source-pinned legacy scenario evidence supporting the Separations record |
| [I-9 signer lookup](i9-lookup.md) | Unnumbered future candidate evidence; Phase 4 admission is required before implementation |

Use `docs/rebuild/migrations/<workflow-id>.md` for the migration artifact required by the
authoring contract. The Separations legacy supplement is the existing reviewed exception.
Read current status at the owning phase and each record's header; a dated observation does not
establish current subject availability or authorize another live write.
