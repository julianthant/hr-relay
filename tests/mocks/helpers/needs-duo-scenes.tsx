import { createRoot } from "react-dom/client";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Banner, Button, DsBodyScope, Panel, PanelBody, PanelHeader, StatusPill, Tab, TabList, Tabs, TooltipProvider } from "../../../src/dashboard/ds/ui.js";

/** "Needs Duo" variants for a run only the operator can unblock; each variant answers where the action lives. */
export const DUO_VARIANTS = ["on-the-row", "in-needs-you", "in-the-panel"] as const;
export type DuoVariant = typeof DUO_VARIANTS[number];

interface Row { person: string; workflow: string; detail: string; status: "running" | "queued" | "verifiedDone" | "waiting"; age?: string }

const ACTIVE: Row[] = [
  { person: "Marcus Oyelaran", workflow: "Separations", detail: "Filing the separation in UCPath", status: "running", age: "4m" },
  { person: "Lena Hartmann", workflow: "Separations", detail: "Starts after Marcus Oyelaran", status: "queued" },
  { person: "Tomas Brandt", workflow: "Emergency Contact", detail: "Reading 3 contacts", status: "running", age: "1m" },
];
const REVIEW: Row = { person: "Priya Raman", workflow: "Person Lookup", detail: "Choose the matching record", status: "waiting", age: "6m" };
const DUO_RUN = { person: "Dana Whitfield", workflow: "Separations", age: "3m" };
const DUO_COPY = { sentence: "Approve the Duo sign-in", detail: "Relay is signed out of UCPath and is waiting for your Duo approval. The run continues once you approve it." };

const SCENE_CSS = `
.nd-root.ds-body-scope{max-width:none;margin:0}
.nd-root{box-sizing:border-box;width:100vw;height:100vh;padding:12px;background:var(--ds-surface-0, var(--background));color:var(--ds-fg)}
.nd-root *{box-sizing:border-box}
.nd-split{display:flex;gap:12px;height:100%}
.nd-queue{width:380px;flex:none}.nd-main{flex:1;min-width:0}
.nd-group{margin:0;padding:10px 12px 4px;font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--ds-fg-muted);text-transform:uppercase}
.nd-list{list-style:none;margin:0;padding:0 8px 8px;display:flex;flex-direction:column;gap:4px}
.nd-row{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:8px;border-radius:8px;font-size:13px}
.nd-row small{display:block;color:var(--ds-fg-muted);font-size:12px}
.nd-row-main{min-width:0;display:flex;flex-direction:column;gap:2px}
.nd-row-end{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none}
.nd-hot{background:var(--ds-queue-info-bg);border:1px solid var(--ds-queue-info-border)}
.nd-key{display:inline-flex;align-items:center;gap:4px;color:var(--ds-fg-secondary);font-size:12px}
.nd-pad{padding:12px;display:flex;flex-direction:column;gap:16px}
.nd-ghost{display:flex;flex-direction:column;gap:12px}.nd-ghost span{height:36px;border-radius:8px;background:var(--ds-surface-2);opacity:.6}
.nd-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}
`;

const noop = () => undefined;
const DuoPill = ({ age }: { age?: string }) => <StatusPill status="waiting" presentation="queue" size="sm" label="Needs Duo" age={age} meaning="Relay is waiting for your Duo approval. Approve it to continue." />;

function RowView({ row, children }: { row: Row; children?: React.ReactNode }) {
  return <li className="nd-row">
    <span className="nd-row-main"><span>{row.person}</span><small>{row.workflow} · {row.detail}</small></span>
    <span className="nd-row-end"><StatusPill status={row.status} presentation="queue" size="sm" age={row.age} />{children}</span>
  </li>;
}

/** The run under ACTIVE today, and the three placements of it. */
function DuoRow({ variant }: { variant: DuoVariant }) {
  if (variant === "on-the-row") return <li className="nd-row nd-hot">
    <span className="nd-row-main"><span>{DUO_RUN.person}</span><small>{DUO_RUN.workflow} · Waiting for your Duo approval</small></span>
    <span className="nd-row-end"><DuoPill /><Button variant="primary" icon={<KeyRound aria-hidden width={14} height={14} />} onClick={noop}>Approve Duo</Button></span>
  </li>;
  if (variant === "in-needs-you") return <li className="nd-row nd-hot">
    <span className="nd-row-main"><span>{DUO_RUN.person}</span><small>{DUO_RUN.workflow}</small><span className="nd-key"><ShieldCheck aria-hidden width={14} height={14} /> Open Duo on your phone and approve the sign-in</span></span>
    <span className="nd-row-end"><DuoPill age={DUO_RUN.age} /></span>
  </li>;
  return <li className="nd-row nd-hot">
    <span className="nd-row-main"><span>{DUO_RUN.person}</span><small>{DUO_RUN.workflow}</small></span>
    <span className="nd-row-end"><DuoPill age={DUO_RUN.age} /></span>
  </li>;
}

function Queue({ variant }: { variant: DuoVariant }) {
  return <Panel className="nd-queue"><PanelHeader title="Queue" headingLevel={2} subtitle="Today" />
    <PanelBody>
      <h3 className="nd-group">Needs you · 2</h3>
      <ul className="nd-list"><DuoRow variant={variant} /><RowView row={REVIEW} /></ul>
      <h3 className="nd-group">Active · {ACTIVE.length}</h3>
      <ul className="nd-list">{ACTIVE.map(row => <RowView key={row.person} row={row} />)}</ul>
    </PanelBody></Panel>;
}

function RunPanel({ variant }: { variant: DuoVariant }) {
  const action = <div className="nd-actions"><Button variant="primary" icon={<KeyRound aria-hidden width={14} height={14} />} onClick={noop}>Approve Duo</Button></div>;
  return <Panel className="nd-main">
    <PanelHeader title={DUO_RUN.person} headingLevel={2} subtitle={`${DUO_RUN.workflow} · Dry run`} actions={<DuoPill age={DUO_RUN.age} />} />
    <Tabs value="logs" onValueChange={noop}><TabList label="Run views"><Tab value="logs">Logs</Tab><Tab value="data">Data</Tab></TabList></Tabs>
    <PanelBody><div className="nd-pad">
      <Banner tone="info" title={DUO_COPY.sentence}><span>{DUO_COPY.detail}</span>{variant === "on-the-row" ? null : action}</Banner>
      <div className="nd-ghost" aria-hidden><span /><span /><span /></div>
    </div></PanelBody></Panel>;
}

export function NeedsDuoScenePage({ variant }: { variant: DuoVariant }) {
  return <TooltipProvider><style>{SCENE_CSS}</style><DsBodyScope className="nd-root">
    <div className="nd-split"><Queue variant={variant} /><RunPanel variant={variant} /></div>
  </DsBodyScope></TooltipProvider>;
}

/** Browser entry: the variant and theme come from the URL. */
export function mountNeedsDuoScene(): void {
  const query = new URLSearchParams(location.search);
  const theme = query.get("theme") === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-demo-theme", theme);
  document.body.setAttribute("data-demo-theme", theme);
  const variant = DUO_VARIANTS.find(option => option === query.get("variant"));
  if (variant === undefined) throw new Error(`needs-duo-variant-invalid:${String(query.get("variant"))}`);
  const root = document.getElementById("root");
  if (root === null) throw new Error("needs-duo-root-missing");
  createRoot(root).render(<NeedsDuoScenePage variant={variant} />);
}
