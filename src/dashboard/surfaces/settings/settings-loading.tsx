import { BodySection, FormGroup, PageHeading, ResultRow, Skeleton } from "../../ds/ui.js";
import { LoadingRegion, SettingsRowsSkeleton, SkeletonText } from "../shared/loading/loading.js";
import { routeLoadingGroups } from "./routes/settings-routes-model.js";
import { settingPlaceholderCopy } from "./settings-presentation.js";
import { SECRET_FAMILY_SPECS } from "../../../domain/config/provider-family-specs.js";

export function SettingsSectionSkeleton({ section, contentOnly = false }: { section: string; contentOnly?: boolean }) {
  const copy = section === "general" ? { title: "General", description: "Appearance, browser behavior, display, and job end date." }
    : section === "paths" ? { title: "Paths", description: "Workflow files and runtime locations." }
    : section === "performance" ? { title: "Performance", description: "Time limits for navigation, work, and sign-in." }
    : section === "providers" ? { title: "Provider budgets & models", description: "Request limits and model preferences for each provider." }
    : section === "routes" ? { title: "Routes", description: "Production destinations, organized by system." }
    : { title: "Credentials", description: "Sign-in details, protected configuration, and provider keys." };
  return <section className="settings-compact-page" data-settings-loading={section}>
    {!contentOnly && <PageHeading {...copy} />}
    <LoadingRegion label={`Loading ${copy.title.toLowerCase()}`} className="settings-compact-form">
      <div className="ds-body-stack">
        {section === "general" ? <>
          <BodySection title="Employment"><FormGroup label="Employment loading"><SettingsRowsSkeleton rows={1} /></FormGroup></BodySection>
          <BodySection title="Browser"><FormGroup label="Browser loading">{[0, 1, 2].map(index => <div key={index} className="ds-body-row" data-control-width="standard"><div><SkeletonText className="w-40 text-body" /><div><SkeletonText className="w-60 text-caption" /></div></div><Skeleton className="ml-auto h-[var(--ds-h-body-switch)] w-[var(--ds-w-body-switch)] rounded-full" /></div>)}</FormGroup></BodySection>
          <BodySection title="Display"><FormGroup label="Display loading"><ResultRow className="[&_.ds-result-row-value]:w-full" controlWidth="wide" label={<SkeletonText className="w-40" />} description={<SkeletonText className="w-60" />} value={<div className="settings-viewport-pair w-[var(--ds-w-body-control-wide)] max-w-full">{[0, 1].map(index => <div key={index} className="settings-viewport-control"><SkeletonText className="w-12" /><Skeleton className="h-[calc(var(--ds-h-body-control)+2*var(--ds-border-w))] w-full" /></div>)}</div>} /></FormGroup></BodySection>
        </> : section === "paths" ? <>
          <BodySection title="Runtime locations"><FormGroup label="Runtime locations loading"><SettingsRowsSkeleton rows={5} wide copy={[
            { label: "Runtime state folder", description: "Persistent settings and run data." },
            { label: "Artifact folder", description: "Run evidence and generated artifacts." },
            ...["paths.browserProfileRoot", "paths.duoCredential", "paths.duoExtensionDir"].map(settingPlaceholderCopy),
          ]} /></FormGroup></BodySection>
          <BodySection title="Generated files"><FormGroup label="Generated files loading"><SettingsRowsSkeleton rows={2} wide /></FormGroup></BodySection>
          <BodySection title="Workflow documents"><FormGroup label="Workflow documents loading"><SettingsRowsSkeleton rows={2} wide /></FormGroup></BodySection>
        </> : section === "performance" ? <>
          {[{ title: "Navigation", rows: 3 }, { title: "Work", rows: 3 }, { title: "Sign-in & Duo", rows: 4 }, { title: "Additional limits", rows: 4 }].map(group => <BodySection key={group.title} title={group.title}><FormGroup label={`${group.title} loading`}><SettingsRowsSkeleton rows={group.rows} presentation={group.title === "Additional limits" ? "disclosure" : "field"} /></FormGroup></BodySection>)}
        </> : section === "providers" ? <>
          <BodySection title="Request budgets"><FormGroup label="Request budgets loading"><div><SettingsRowsSkeleton rows={1} presentation="disclosure" /><div className="settings-provider-budget-content"><div className="settings-provider-grid">{[0, 1, 2, 3, 4].map(index => <div key={index} className="ds-field"><div className="ds-field-label"><SkeletonText className="w-3/4" /></div><Skeleton className="mt-[var(--ds-space-tight)] h-[var(--ds-h-body-control)]" /><div className="ds-field-description"><SkeletonText className="w-16" /></div></div>)}</div></div></div><SettingsRowsSkeleton rows={3} presentation="disclosure" /></FormGroup></BodySection>
          <BodySection title="Model priority"><FormGroup label="Model priority loading"><div><SettingsRowsSkeleton rows={1} presentation="disclosure" /><div className="flex flex-col gap-2 px-[var(--ds-space-base)] pb-[var(--ds-space-base)]">{[0, 1].map(index => <Skeleton key={index} className="h-[var(--ds-h-body-row)]" />)}</div></div><SettingsRowsSkeleton rows={4} presentation="disclosure" /></FormGroup></BodySection>
        </> : section === "routes" ? <>
          <Skeleton className="mb-[var(--ds-space-section)] h-[var(--ds-h-body-control)]" />
          {routeLoadingGroups().map(group => <BodySection key={group.title} title={<span className="routes-section-heading"><span>{group.title}</span><span>{group.rows} {group.rows === 1 ? "URL" : "URLs"}</span></span>}><FormGroup label={`${group.title} routes loading`}><SettingsRowsSkeleton rows={group.rows} wide /></FormGroup></BodySection>)}
        </> : <>
          {["UCPath sign-in", "Workflow configuration", "Provider keys"].map((title, index) => <BodySection key={title} title={title}><FormGroup label={`${title} loading`}><SettingsRowsSkeleton rows={index === 2 ? SECRET_FAMILY_SPECS.length : 2} presentation={index === 2 ? "disclosure" : "field"} /></FormGroup></BodySection>)}
        </>}
      </div>
    </LoadingRegion>
  </section>;
}
