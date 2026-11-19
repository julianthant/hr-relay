import { useDelayedLoading } from "../shared/loading/loading-model.js";
import { BodySection, FormGroup, PageHeading, Skeleton } from "../../ds/ui.js";
import { LoadingRegion, SettingsRowsSkeleton } from "../shared/loading/loading.js";
import { GENERAL_RUN_GROUPS } from "./general/general-groups-model.js";
import { routeLoadingGroups } from "./routes/settings-routes-model.js";

export function SettingsSectionSkeleton({ section, contentOnly = false }: { section: string; contentOnly?: boolean }) {
  const show = useDelayedLoading(true);
  const copy = section === "general" ? { title: "General", description: "ChatGPT account, appearance, and browser preferences." }
    : section === "performance" ? { title: "Performance", description: "Time limits for navigation, work, and sign-in." }
    : section === "routes" ? { title: "Routes", description: "Production destinations, organized by system." }
    : { title: "Account", description: "Sign-in details and protected workflow configuration." };
  return <section className="settings-compact-page" data-settings-loading={show ? section : undefined}>
    {!contentOnly && <PageHeading {...copy} />}
    {show && <LoadingRegion label={`Loading ${copy.title.toLowerCase()}`} className="settings-compact-form">
      <div className="ds-body-stack">
        {section === "general" ? <>
          {[...contentOnly ? [] : [{ title: "Assistant", rows: 4, singleLine: [] as number[] }], { title: "App", rows: 5, singleLine: [2, 3] }, ...GENERAL_RUN_GROUPS.map(group => ({ title: group.title, rows: group.rows.length, singleLine: [] as number[] }))].map(group => <BodySection key={group.title} title={group.title}><FormGroup label={`${group.title} loading`}><SettingsRowsSkeleton rows={group.rows} singleLine={group.singleLine} /></FormGroup></BodySection>)}
        </> : section === "performance" ? <>
          {[{ title: "Navigation", rows: 3 }, { title: "Work", rows: 3 }, { title: "Sign-in & Duo", rows: 4 }, { title: "Additional limits", rows: 4 }].map(group => <BodySection key={group.title} title={group.title}><FormGroup label={`${group.title} loading`}><SettingsRowsSkeleton rows={group.rows} presentation={group.title === "Additional limits" ? "disclosure" : "field"} /></FormGroup></BodySection>)}
        </> : section === "routes" ? <>
          <Skeleton className="mb-[var(--ds-space-section)] h-[var(--ds-h-body-control)]" />
          {routeLoadingGroups().map(group => <BodySection key={group.title} title={<span className="routes-section-heading"><span>{group.title}</span><span>{group.rows} {group.rows === 1 ? "URL" : "URLs"}</span></span>}><FormGroup label={`${group.title} routes loading`}><SettingsRowsSkeleton rows={group.rows} wide /></FormGroup></BodySection>)}
        </> : <>
          {["UCPath sign-in", "Workflow configuration"].map(title => <BodySection key={title} title={title}><FormGroup label={`${title} loading`}><SettingsRowsSkeleton rows={2} presentation="field" /></FormGroup></BodySection>)}
        </>}
      </div>
    </LoadingRegion>}
  </section>;
}
