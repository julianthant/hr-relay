import { Link2 } from "lucide-react";
import { Panel, PanelBody, PanelHeader, dsIcon, dsText } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { useSettingsFacts } from "../editor/settings-facts-model.js";
import { FactsPane } from "../editor/settings-facts.js";
import { SYSTEM_HOST_PRESENTATION } from "./settings-hosts-model.js";

export function SystemHostsSection() {
  const facts = useSettingsFacts();
  return <Panel className="settings-page-panel">
    <PanelHeader title="System hosts" headingLevel={2} icon={<Link2 aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="settings-page-body">
      <FactsPane facts={facts}>{loaded => <>
        <section className="settings-group">
          <div className="settings-group-heading">
            <h3 className={cn(dsText.title, "font-medium")}>Production endpoints</h3>
          </div>
          <div className="settings-group-rows">
            {loaded.systemHosts.map(host => <div key={host.system} className="settings-host-row">
              <div className="settings-host-heading">
                <span className={cn(dsText.ui, "font-medium")}>{SYSTEM_HOST_PRESENTATION[host.system].name}</span>
              </div>
              <dl className="settings-host-destinations">
                <div><dt>Production</dt><dd title={host.production}>{host.production}</dd></div>
              </dl>
            </div>)}
          </div>
        </section>
      </>}</FactsPane>
    </PanelBody>
  </Panel>;
}
