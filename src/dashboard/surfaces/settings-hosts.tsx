import {
Link2
} from "lucide-react";
import { Banner,Panel,PanelBody,PanelHeader,TBody,TD,TH,THead,TR,Table,dsIcon,dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useSettingsFacts } from "./settings-facts-model.js";
import { FactsPane } from "./settings-facts.js";
import { SYSTEM_HOST_PRESENTATION,systemHostsMeta } from "./settings-hosts-model.js";


/**
 * SE40 — the hosts this deployment resolves, per system.
 *
 * It STATES and sets nothing, and the banner says why that is a decision rather
 * than an unbuilt control: the instance is a per-RUN choice the envelope
 * carries, and a standing override here would redirect every future run with no
 * expiry and nothing on screen to say so. `none provisioned` is the served
 * absence — the projection drops a test host that is not distinct from
 * production, because a run asking for that one is refused (D274 item 6).
 */
export function SystemHostsSection() {
  const facts = useSettingsFacts();
  return (
    <Panel className="settings-page-panel">
      <PanelHeader
        title="System hosts"
        headingLevel={2}
        // ported from legacy 1ec1d870
        // src/dashboard/components/dev/rebuild-demo/DemoSettings.tsx:164-168
        subtitle="Which machine each system resolves to. Choosing between them is a per-run question, asked in the run modal."
        icon={<Link2 aria-hidden className={dsIcon.lg} />}
        meta={facts.state === "loaded" ? systemHostsMeta(facts.facts.systemHosts) : undefined}
      />
      <PanelBody className="flex flex-col">
        <FactsPane facts={facts}>
          {(loaded) => (
            <>
              <Banner
                tone="info"
                title="Choosing between these is a per-run decision"
                className="m-[var(--ds-space-cozy)]"
              >
                A run envelope carries the instance per system and defaults to production; a start
                that asks for <strong>test</strong> is refused outright unless a distinct test host is
                configured, never quietly sent to production. This page states the hosts and sets
                none — a standing override here would redirect every future run with no expiry and
                nothing on screen to say so.
              </Banner>
              <Table label="System entry hosts">
                <THead>
                  <TR>
                    <TH>System</TH>
                    <TH>Production</TH>
                    <TH>Test</TH>
                  </TR>
                </THead>
                <TBody>
                  {loaded.systemHosts.map((host) => (
                    <TR key={host.system}>
                      {/* The system's own NAME over the one sentence that says
                          why the instance choice matters for it — never the raw
                          wire id, which is a key and not a word (UF-SET-25 /
                          UF-SET-26). Both come from
                          `SYSTEM_HOST_PRESENTATION`, which is exhaustive over
                          the closed enum, so a system with nothing to say about
                          it is a compile error rather than an id on screen. */}
                      <TD>
                        <span className="flex min-w-0 flex-col">
                          <span className={cn(dsText.ui, "whitespace-nowrap text-[color:var(--ds-fg)]")}>
                            {SYSTEM_HOST_PRESENTATION[host.system].name}
                          </span>
                          {/* `micro` (10px) is the demo's own token for this
                              note — legacy 1ec1d870
                              `DemoSettings.tsx:842` — not a step chosen here.
                              DESIGN.md's micro row names it as the one ported
                              exception to "badges and kbd". */}
                          <span className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
                            {SYSTEM_HOST_PRESENTATION[host.system].note}
                          </span>
                        </span>
                      </TD>
                      {/* One line, clipped at the demo's own width, never
                          fragmented: a deep PeopleSoft route has no spaces to
                          wrap at, so wrapping it broke the host across lines
                          mid-token. `max-w-[260px] truncate` is the demo's
                          treatment for both URL cells, ported from legacy
                          1ec1d870
                          `src/dashboard/components/dev/rebuild-demo/DemoSettings.tsx:845-850`.
                          `title` is ours: the demo clips with no way to read
                          the rest, and a truncated host the operator cannot
                          recover is a host they cannot check. The absence arms
                          below are NOT clipped — their words are prose, and
                          `none pro…` would be unreadable. */}
                      <TD numeric className="max-w-[260px] truncate" title={host.production}>
                        {host.production}
                      </TD>
                      {host.test.state === "provisioned" ? (
                        <TD numeric className="max-w-[260px] truncate" title={host.test.url}>
                          {host.test.url}
                        </TD>
                      ) : host.test.state === "not-distinct" ? (
                        // Configured, but identical to production — refused at
                        // run time by `resolveSystemEntryUrl`. Stated by name
                        // rather than folded into `none provisioned`, which
                        // would read as "nobody configured a sandbox" when the
                        // true fact is "a sandbox was configured wrong" (unit
                        // F11b finding 2).
                        <TD>
                          <span className={cn(dsText.meta, "whitespace-nowrap text-[color:var(--ds-danger)]")}>
                            provisioned identical to production — refused
                          </span>
                        </TD>
                      ) : (
                        <TD>
                          <span className={cn(dsText.meta, "whitespace-nowrap text-[color:var(--ds-fg-faint)]")}>
                            none provisioned
                          </span>
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </>
          )}
        </FactsPane>
      </PanelBody>
    </Panel>
  );
}
