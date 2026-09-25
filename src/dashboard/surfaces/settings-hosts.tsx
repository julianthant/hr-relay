import { Link2 } from "lucide-react";
import { Banner, Panel, PanelBody, PanelHeader, dsIcon, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useSettingsFacts } from "./settings-facts-model.js";
import { FactsPane } from "./settings-facts.js";
import { SYSTEM_HOST_PRESENTATION, systemHostsMeta } from "./settings-hosts-model.js";

export function SystemHostsSection() {
  const facts = useSettingsFacts();
  return <Panel className="settings-page-panel">
    <PanelHeader title="System hosts" headingLevel={2} icon={<Link2 aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="settings-page-body">
      <FactsPane facts={facts}>{loaded => <>
        <section className="settings-group">
          <div className="settings-group-heading">
            <h3 className={cn(dsText.title, "font-medium")}>Entry hosts</h3>
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{systemHostsMeta(loaded.systemHosts)}</span>
          </div>
          <div className="settings-group-rows">
            {loaded.systemHosts.map(host => <div key={host.system} className="settings-host-row">
              <div className="settings-host-heading">
                <span className={cn(dsText.ui, "font-medium")}>{SYSTEM_HOST_PRESENTATION[host.system].name}</span>
                <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>{SYSTEM_HOST_PRESENTATION[host.system].note}</span>
              </div>
              <dl className="settings-host-destinations">
                <div><dt>Production</dt><dd title={host.production}>{host.production}</dd></div>
                <div><dt>Test</dt><dd data-refused={host.test.state === "not-distinct" ? "true" : undefined} title={host.test.state === "provisioned" ? host.test.url : undefined}>
                  {host.test.state === "provisioned" ? host.test.url : host.test.state === "not-distinct" ? "provisioned identical to production — refused" : "none provisioned"}
                </dd></div>
              </dl>
            </div>)}
          </div>
        </section>
        <Banner tone="info" title="Each run selects its host" className="settings-inline-note">
          Current deployment. Production is the default. A test request without a distinct test host is refused; it never falls through to production.
        </Banner>
      </>}</FactsPane>
    </PanelBody>
  </Panel>;
}
