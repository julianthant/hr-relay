import { createRoot } from "react-dom/client";
import { CircleAlert, RotateCw } from "lucide-react";
import { Banner, Button, DsBodyScope, Panel, PanelBody, PanelFooter, PanelHeader, Tab, TabList, Tabs, TooltipProvider } from "../../../src/dashboard/ds/ui.js";

/** The shared "could not load / could not do this" notice: sentence, what still works, then the action beneath; the scenes host it in each placement. */
export const NOTICE_SCENES = ["run-panel", "settings", "dialog-checks", "dialog-refusal", "app-start"] as const;
export const NOTICE_COPY = ["short", "long"] as const;
export type NoticeScene = typeof NOTICE_SCENES[number];
export type NoticeCopy = typeof NOTICE_COPY[number];
export type NoticePlacement = "panel" | "page" | "slot";

interface NoticeContent { sentence: string; stillWorks: string; action: string }

const CONTENT: Record<NoticeScene, Record<NoticeCopy, NoticeContent>> = {
  "run-panel": {
    short: { sentence: "Logs could not load.", stillWorks: "The queue still works.", action: "Retry" },
    long: { sentence: "Relay could not read the logs for this run because the log store did not answer in time, so no steps are shown yet.", stillWorks: "The queue and the other runs still work, and nothing was changed.", action: "Retry reading logs" },
  },
  settings: {
    short: { sentence: "Settings could not load.", stillWorks: "Your runs are not affected.", action: "Retry" },
    long: { sentence: "Relay could not read your General settings, so the values below may not be the ones you saved.", stillWorks: "Runs and the queue are not affected, and nothing was saved over your settings.", action: "Retry reading settings" },
  },
  "dialog-checks": {
    short: { sentence: "Checks are unavailable.", stillWorks: "You can still review Input and Options.", action: "Check again" },
    long: { sentence: "Relay could not read this workflow's readiness checks, so it cannot tell whether a run would start.", stillWorks: "You can still review Input, Options and Steps; Start stays off until the checks are read.", action: "Check again" },
  },
  "dialog-refusal": {
    short: { sentence: "Run not started.", stillWorks: "Your input and options are kept.", action: "Start again" },
    long: { sentence: "Run not started because T00042871 is already pending in UCPath, filed today at 09:33.", stillWorks: "Your input and options are kept; remove that person or open the existing run.", action: "Open existing run" },
  },
  "app-start": {
    short: { sentence: "Relay could not start.", stillWorks: "Nothing was changed.", action: "Try again" },
    long: { sentence: "Relay could not reach its backend, so the queue, Logs and Settings cannot load yet.", stillWorks: "Nothing was changed, and runs already filed are not affected.", action: "Try again" },
  },
};


const SCENE_CSS = `
.fn-root.ds-body-scope{max-width:none;margin:0}
.fn-root{box-sizing:border-box;width:100vw;height:100vh;padding:12px;background:var(--ds-surface-0, var(--background));color:var(--ds-fg)}
.fn-root *{box-sizing:border-box}
.fn-split{display:flex;gap:12px;height:100%}
.fn-queue{width:280px;flex:none}.fn-main{flex:1;min-width:0}
.fn-list{list-style:none;margin:0;padding:8px;display:flex;flex-direction:column;gap:4px}
.fn-list li{display:flex;justify-content:space-between;gap:8px;padding:8px;border-radius:8px;font-size:13px}
.fn-list small{display:block;color:var(--ds-fg-muted);font-size:12px}.fn-list em{font-style:normal;color:var(--ds-fg-muted)}
.fn-pad{padding:12px}.fn-stack{display:flex;flex-direction:column;gap:16px}
.fn-ghost-rows{display:flex;flex-direction:column;gap:12px}.fn-ghost-rows span{height:36px;border-radius:8px;background:var(--ds-surface-2);opacity:.6}
.fn-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.fn-beneath .fn-actions{margin-top:12px}
.fn-still{color:var(--ds-fg-secondary)}
.fn-backdrop{display:flex;align-items:center;justify-content:center;height:100%;background:color-mix(in srgb,var(--ds-surface-0, #000) 70%,transparent)}
.fn-dialog{width:min(720px,100%);height:min(600px,100%)}
.fn-slot{padding:12px 12px 0}.fn-slot:has(.fn-footer{display:flex;align-items:center;gap:12px;padding:8px 12px;width:100%}.fn-hint{flex:1;font-size:12px;color:var(--ds-fg-muted)}
.fn-fullpage{display:flex;align-items:center;justify-content:center;height:100%}.fn-fullpage-card{width:min(560px,100%);display:flex;flex-direction:column;gap:16px}
.fn-brand{display:flex;align-items:center;gap:8px;margin:0;font-size:18px;font-weight:600}
`;
function SceneStyle() { return <style>{SCENE_CSS}</style>; }

const noop = () => undefined;
const actionRow = (content: NoticeContent) => (
  <div className="fn-actions">
    <Button variant="primary" icon={<RotateCw aria-hidden width={14} height={14} />} onClick={noop}>{content.action}</Button>
  </div>
);

export function FailureNotice({ scene, copy }: { scene: NoticeScene; copy: NoticeCopy }) {
  const content = CONTENT[scene][copy];
  return <Banner tone="danger" title={<span className="fn-sentence">{content.sentence}</span>} className="fn-beneath">
    <span className="fn-still">{content.stillWorks}</span>
    {actionRow(content)}
  </Banner>;
}

const QUEUE = [["Separations", "Dana Whitfield", "Done"], ["Separations", "Marcus Oyelaran", "Running"], ["Person Lookup", "Priya Raman", "Review"], ["Separations", "Lena Hartmann", "Queued"]];
function Queue() {
  return <Panel className="fn-queue"><PanelHeader title="Queue" headingLevel={2} subtitle="Today" />
    <PanelBody><ul className="fn-list">{QUEUE.map(([workflow, person, status]) => <li key={person}><span>{person}<small>{workflow}</small></span><em>{status}</em></li>)}</ul></PanelBody></Panel>;
}

function RunPanelScene({ copy }: { copy: NoticeCopy }) {
  return <div className="fn-split"><Queue />
    <Panel className="fn-main"><PanelHeader title="Dana Whitfield" headingLevel={2} subtitle="Separations · Failed 09:33" />
      <Tabs value="logs" onValueChange={noop}><TabList label="Run views"><Tab value="logs">Logs</Tab><Tab value="data">Data</Tab></TabList></Tabs>
      <PanelBody><div className="fn-pad"><FailureNotice scene="run-panel" copy={copy} /></div></PanelBody></Panel></div>;
}

function SettingsScene({ copy }: { copy: NoticeCopy }) {
  return <div className="fn-split"><Panel className="fn-queue"><PanelHeader title="Settings" headingLevel={2} />
    <PanelBody><ul className="fn-list">{["General", "Account", "Paths", "Routes"].map(name => <li key={name}><span>{name}</span></li>)}</ul></PanelBody></Panel>
    <Panel className="fn-main"><PanelHeader title="General" headingLevel={2} />
      <PanelBody><div className="fn-pad fn-stack"><FailureNotice scene="settings" copy={copy} />
        <div className="fn-ghost-rows" aria-hidden><span /><span /><span /></div></div></PanelBody></Panel></div>;
}

function DialogScene({ copy, scene }: { copy: NoticeCopy; scene: "dialog-checks" | "dialog-refusal" }) {
  return <div className="fn-backdrop"><Panel className="fn-dialog" role="dialog" aria-label="Start run">
    <PanelHeader title="Start run" headingLevel={2} subtitle="Separations" />
    <Tabs value={scene === "dialog-checks" ? "checks" : "options"} onValueChange={noop}><TabList label="Stages"><Tab value="input">Input</Tab><Tab value="options">Options</Tab><Tab value="checks">Checks</Tab></TabList></Tabs>
    <div className="fn-slot"><FailureNotice scene={scene} copy={copy} /></div>
    <PanelBody><div className="fn-pad"><div className="fn-ghost-rows" aria-hidden><span /><span /><span /></div></div></PanelBody>
    <PanelFooter><div className="fn-footer"><span className="fn-hint">{CONTENT[scene][copy].sentence}</span><Button variant="secondary" onClick={noop}>Cancel</Button><Button variant="primary" disabled>Start</Button></div></PanelFooter>
  </Panel></div>;
}

function AppStartScene({ copy }: { copy: NoticeCopy }) {
  return <div className="fn-fullpage"><div className="fn-fullpage-card"><h1 className="fn-brand"><CircleAlert aria-hidden width={18} height={18} /> Relay</h1>
    <FailureNotice scene="app-start" copy={copy} /></div></div>;
}

export function NoticeScenePage({ scene, copy }: { scene: NoticeScene; copy: NoticeCopy }) {
  return <TooltipProvider><SceneStyle /><DsBodyScope className="fn-root">
    {scene === "run-panel" && <RunPanelScene copy={copy} />}
    {scene === "settings" && <SettingsScene copy={copy} />}
    {(scene === "dialog-checks" || scene === "dialog-refusal") && <DialogScene copy={copy} scene={scene} />}
    {scene === "app-start" && <AppStartScene copy={copy} />}
  </DsBodyScope></TooltipProvider>;
}

function parseOption<T extends string>(value: string | null, options: readonly T[], name: string): T {
  const match = options.find(option => option === value);
  if (match === undefined) throw new Error(`failure-notice-${name}-invalid:${String(value)}`);
  return match;
}

/** Browser entry: the scene, copy length and theme come from the URL. */
export function mountNoticeScene(): void {
  const query = new URLSearchParams(location.search);
  const theme = query.get("theme") === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-demo-theme", theme);
  document.body.setAttribute("data-demo-theme", theme);
  const root = document.getElementById("root");
  if (root === null) throw new Error("failure-notice-root-missing");
  createRoot(root).render(<NoticeScenePage scene={parseOption(query.get("scene"), NOTICE_SCENES, "scene")} copy={parseOption(query.get("copy"), NOTICE_COPY, "copy")} />);
}
