import { useDelayedLoading } from "../../shared/loading/loading-model.js";
import { type ReactNode } from "react";
import {
type SettingsFactsWire
} from "../../../../models/dashboard/settings.js";
import { Banner } from "../../../ds/ui.js";
import { useSettingsFacts } from "./settings-facts-model.js";
import { LoadingRegion, SettingsRowsSkeleton } from "../../shared/loading/loading.js";


export function FactsPane({
  facts,
  children,
  loading,
}: {
  facts: ReturnType<typeof useSettingsFacts>;
  children: (loaded: SettingsFactsWire) => ReactNode;
  loading?: ReactNode;
}) {
  const show = useDelayedLoading(facts.state === "loading");
  if (facts.state === "loading") {
    if (!show) return null;
    return loading ?? <LoadingRegion label="Loading deployment facts"><SettingsRowsSkeleton rows={4} wide presentation="result" /></LoadingRegion>;
  }
  if (facts.state === "failed") {
    return (<>
      <Banner
        className="mb-[var(--ds-space-heading-content)]"
        tone="danger"
        title="These facts could not be read"
      >
        <span className="flex flex-col gap-[var(--ds-space-tight)]">
          <span>{facts.message}</span>
        </span>
      </Banner>
      {facts.facts !== undefined && children(facts.facts)}
    </>);
  }
  return <>{children(facts.facts)}</>;
}
