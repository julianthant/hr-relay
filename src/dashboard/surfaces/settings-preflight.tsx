import type { FrontendBootstrapWire } from "../../domain/dashboard/bootstrap.js";
import { Banner,Button,dsText,SectionLabel } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useEditableSettings } from "./settings-editor-model.js";


export function PreflightControl({
  editor,
  retained,
}: {
  editor: ReturnType<typeof useEditableSettings>;
  retained: NonNullable<FrontendBootstrapWire["preflight"]>;
}) {
  const checks = editor.preflight.state === "completed" ? editor.preflight.checks : retained;
  return (
    <section className="flex flex-col gap-[var(--ds-space-snug)]" aria-label="Preflight">
      <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]">
        <SectionLabel>Preflight</SectionLabel>
        <Button size="sm" variant="secondary" onClick={editor.rerunPreflight} disabled={editor.preflight.state === "running"}>
          {editor.preflight.state === "running" ? "Running preflight…" : "Rerun preflight"}
        </Button>
      </div>
      {editor.preflight.state === "refused" && <Banner tone="danger" title="Preflight was not rerun">{editor.preflight.message}</Banner>}
      <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
        {checks.length === 0 ? "No retained preflight report was served." : `${String(checks.length)} retained check${checks.length === 1 ? "" : "s"}; rerun verifies the active runtime only.`}
      </span>
    </section>
  );
}
