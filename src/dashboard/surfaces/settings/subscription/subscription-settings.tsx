import { BodySection, Button, FormGroup, PageHeading, ResultRow, Switch } from "../../../ds/ui.js";
import "./subscription-settings.css";

export interface SubscriptionPlan { readonly name: string; readonly price: string }
export interface SubscriptionLimit { readonly label: string; readonly resets: string; readonly left: number }
export interface SubscriptionPermissions { readonly defaultPermissions: boolean; readonly fullAccess: boolean }
export type SubscriptionAccount =
  | { readonly state: "connected"; readonly email: string; readonly plan: SubscriptionPlan; readonly limits: readonly SubscriptionLimit[] }
  | { readonly state: "disconnected" };

/** One limit: name, when it resets and how much is left, over a thin bar that shows what is left. */
function LimitCard({ limit }: { limit: SubscriptionLimit }) {
  return <FormGroup label={limit.label}>
    <div className="sub-limit">
      <div className="sub-limit-title">{limit.label}</div>
      <div className="sub-limit-meta"><span>Resets in {limit.resets}</span><span>{limit.left}% left</span></div>
      <div role="progressbar" aria-label={`${limit.label} left`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={limit.left} className="sub-limit-bar"><span style={{ width: `${limit.left}%` }} /></div>
    </div>
  </FormGroup>;
}

/** Subscription page: the ChatGPT plan Relay runs on, its limits, what the assistant may do and the connected account. */
export function SubscriptionSettings({ account, permissions, onPermissions, onConnect, onDisconnect }: {
  account: SubscriptionAccount;
  permissions: SubscriptionPermissions;
  onPermissions: (next: SubscriptionPermissions) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return <section className="settings-compact-page">
    <PageHeading title="Subscription" />
    <BodySection title="Your plan" description="Your plan is managed through ChatGPT.">
      <FormGroup label="Your plan">
        {account.state === "connected"
          ? <ResultRow label={account.plan.name} description={account.plan.price} value={<Button variant="secondary">View plans</Button>} />
          : <ResultRow label="No plan" description="Connect ChatGPT to see your plan." value={<Button variant="secondary">View plans</Button>} />}
      </FormGroup>
    </BodySection>
    {account.state === "connected" && <BodySection title="Plan limits" description="Shared by the assistant and reading scans.">
      <div className="sub-limits">{account.limits.map(limit => <LimitCard key={limit.label} limit={limit} />)}</div>
    </BodySection>}
    <BodySection title="Permissions">
      <FormGroup label="Permissions">
        <Switch name="Default permissions" label="Default permissions" description="By default, the assistant can read runs and look people up. It asks before starting runs or saving anything." checked={permissions.defaultPermissions} onCheckedChange={defaultPermissions => onPermissions({ ...permissions, defaultPermissions })} />
        <Switch name="Full access" label="Full access" description="The assistant can start dry runs and answer run questions without asking. Live runs and saves always ask." checked={permissions.fullAccess} onCheckedChange={fullAccess => onPermissions({ ...permissions, fullAccess })} />
      </FormGroup>
    </BodySection>
    <BodySection title="Connected account">
      <FormGroup label="Connected account">
        <ResultRow label="ChatGPT" className="!min-h-[52px]" value={account.state === "connected"
          ? <span className="inline-flex items-center justify-end gap-3"><span>{account.email}</span><Button variant="secondary" onClick={onDisconnect}>Disconnect</Button></span>
          : <span className="inline-flex items-center justify-end gap-3"><span>Not connected</span><Button variant="secondary" onClick={onConnect}>Connect</Button></span>} />
      </FormGroup>
    </BodySection>
  </section>;
}
