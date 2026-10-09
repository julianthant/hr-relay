import { type ReactNode } from "react";
import {
type SettingsFactsWire
} from "../../../../models/dashboard/settings.js";
import { Banner } from "../../../ds/ui.js";
import { useSettingsFacts } from "./settings-facts-model.js";
import { LoadingRegion, SettingsRowsSkeleton } from "../../shared/loading/loading.js";


/** ── the two served status sections ─────────────────────────────────────── */

/** The async half of both sections, drawn rather than hidden.
 * A refusal is NOT an empty table. "No test host is configured" and "we could */
export function FactsPane({
  facts,
  children,
  loading,
}: {
  facts: ReturnType<typeof useSettingsFacts>;
  children: (loaded: SettingsFactsWire) => ReactNode;
  loading?: ReactNode;
}) {
  if (facts.state === "loading") {
    return loading ?? <LoadingRegion label="Loading deployment facts"><SettingsRowsSkeleton rows={4} wide presentation="result" /></LoadingRegion>;
  }
  if (facts.state === "failed") {
    return (
            // No inner `role="alert"`: a `danger` Banner already carries one
      // (`primitives-layout.tsx`), and nesting a second is the defect.
      <Banner
        className="m-[var(--ds-space-cozy)]"
        tone="danger"
        title="These facts could not be read"
      >
        <span className="flex flex-col gap-[var(--ds-space-tight)]">
          <span>{facts.message}</span>
        </span>
      </Banner>
    );
  }
  return <>{children(facts.facts)}</>;
}
