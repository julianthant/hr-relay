import { BodySection, FormGroup, PageHeading, Skeleton } from "../../ds/ui.js";
import { LoadingRegion, SettingsRowsSkeleton } from "../shared/loading/loading.js";
import { GENERAL_RUN_GROUPS } from "./general/general-groups-model.js";
import { routeLoadingGroups } from "./routes/settings-routes-model.js";

export function SettingsSectionSkeleton({ section, contentOnly = false }: { section: string; contentOnly?: boolean }) {
  const copy = section === "general" ? { title: "General", description: "Assistant, app, run, and notification preferences." }
    : section === "performance" ? { title: "Performance", description: "Time limits for navigation, work, and sign-in." }
    : section === "routes" ? { title: "Routes", description: "Production destinations, organized by system." }
    : { title: "Account", description: "Sign-in details and protected workflow configuration." };
  return <section className="settings-compact-page" data-settings-loading={section}>
    {!contentOnly && <PageHeading {...copy} />}
    <LoadingRegion label={`Loading ${copy.title.toLowerCase()}`} className="settings-compact-form">
      <div className="ds-body-stack">
        {section === "general" ? <>
          {[...contentOnly ? [] : [{ title: "Assistant", description: "ChatGPT sign-in and assistant permissions.", rows: 4, singleLine: [] as number[] }], { title: "App", description: "Download folder, employment end date, and appearance.", rows: 4, singleLine: [0, 1, 2, 3] }, ...GENERAL_RUN_GROUPS.map(group => ({ title: group.title, description: group.description, rows: group.rows.length, singleLine: group.rows.map((_, row) => row) }))].map(group => <BodySection key={group.title} title={group.title} description={group.description}><FormGroup label={`${group.title} loading`}><SettingsRowsSkeleton rows={group.rows} singleLine={group.singleLine} /></FormGroup></BodySection>)}
        </> : section === "performance" ? <>
          {[{ title: "Navigation", description: "Time allowed for pages to load and respond.", rows: 3 }, { title: "Work", description: "Time allowed for each workflow step.", rows: 3 }, { title: "Sign-in & Duo", description: "Time allowed for sign-in and Duo approval.", rows: 4 }, { title: "Additional limits", description: "Scheduling, retry, OCR, and recovery limits.", rows: 4 }].map(group => <BodySection key={group.title} title={group.title} description={group.description}><FormGroup label={`${group.title} loading`}><SettingsRowsSkeleton rows={group.rows} presentation={group.title === "Additional limits" ? "disclosure" : "field"} /></FormGroup></BodySection>)}
        </> : section === "routes" ? <>
          <Skeleton className="mb-[var(--ds-space-section)] h-[var(--ds-h-body-control)]" />
          {routeLoadingGroups().map(group => <BodySection key={group.title} title={<span className="routes-section-heading"><span>{group.title}</span><span>{group.rows} {group.rows === 1 ? "URL" : "URLs"}</span></span>} description={group.description}><FormGroup label={`${group.title} routes loading`}><SettingsRowsSkeleton rows={group.rows} wide /></FormGroup></BodySection>)}
        </> : <>
          {[["UCPath sign-in", "Workflows use this to sign in to UCPath."], ["Workflow configuration", "Names workflows put on the forms they file."]].map(([title, description]) => <BodySection key={title} title={title} description={description}><FormGroup label={`${title} loading`}><SettingsRowsSkeleton rows={2} presentation="field" /></FormGroup></BodySection>)}
        </>}
      </div>
    </LoadingRegion>
  </section>;
}
