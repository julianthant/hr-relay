import { BodySection, FormGroup, PageHeading, Skeleton } from "../../ds/ui.js";
import { LoadingRegion, SettingsRowsSkeleton, SkeletonText } from "../shared/loading/loading.js";
import { routeLoadingGroups } from "./routes/settings-routes-model.js";
import { settingPlaceholderCopy } from "./settings-presentation.js";

export function SettingsSectionSkeleton({ section, contentOnly = false }: { section: string; contentOnly?: boolean }) {
  const copy = section === "general" ? { title: "General", description: "ChatGPT account, appearance, and browser preferences." }
    : section === "paths" ? { title: "Paths", description: "Workflow files and runtime locations." }
    : section === "performance" ? { title: "Performance", description: "Time limits for navigation, work, and sign-in." }
    : section === "routes" ? { title: "Routes", description: "Production destinations, organized by system." }
    : { title: "Credentials", description: "Sign-in details and protected workflow configuration." };
  return <section className="settings-compact-page" data-settings-loading={section}>
    {!contentOnly && <PageHeading {...copy} />}
    <LoadingRegion label={`Loading ${copy.title.toLowerCase()}`} className="settings-compact-form">
      <div className="ds-body-stack">
        {section === "general" ? <>
          <BodySection title="Employment"><FormGroup label="Employment loading"><SettingsRowsSkeleton rows={1} /></FormGroup></BodySection>
          <BodySection title="Browser"><FormGroup label="Browser loading">{[0, 1, 2].map(index => <div key={index} className="ds-body-row" data-control-width="standard"><div><SkeletonText className="w-40 text-body" /><div><SkeletonText className="w-60 text-caption" /></div></div><Skeleton className="ml-auto h-[var(--ds-h-body-switch)] w-[var(--ds-w-body-switch)] rounded-full" /></div>)}</FormGroup></BodySection>
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
        </> : section === "routes" ? <>
          <Skeleton className="mb-[var(--ds-space-section)] h-[var(--ds-h-body-control)]" />
          {routeLoadingGroups().map(group => <BodySection key={group.title} title={<span className="routes-section-heading"><span>{group.title}</span><span>{group.rows} {group.rows === 1 ? "URL" : "URLs"}</span></span>}><FormGroup label={`${group.title} routes loading`}><SettingsRowsSkeleton rows={group.rows} wide /></FormGroup></BodySection>)}
        </> : <>
          {["UCPath sign-in", "Workflow configuration"].map(title => <BodySection key={title} title={title}><FormGroup label={`${title} loading`}><SettingsRowsSkeleton rows={2} presentation="field" /></FormGroup></BodySection>)}
        </>}
      </div>
    </LoadingRegion>
  </section>;
}
