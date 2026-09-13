import {
type SystemHostWire
} from "../../domain/dashboard/settings.js";
import type { BrowserSystemId } from "./system-chip-model.js";


/**
 * SE40's SYSTEM column, as an operator reads it: the system's own name, and one
 * sentence saying why the instance choice matters for THAT system.
 *
 * The table printed the raw wire id (`ucpath`, `new-kronos`) and no sentence at
 * all (UF-SET-25 / UF-SET-26). The demo prints both, off a client constant
 * (legacy `1ec1d870`
 * `src/dashboard/components/dev/rebuild-demo/demo-runstart-wire.ts:88-124`,
 * rendered at `DemoSettings.tsx:837-844`), so the current can too.
 *
 * NOT `SYSTEM_LABEL` from `system-chip-model.ts`: that map is the CHIP's
 * treatment — `UCPATH`, `NEW KRONOS` — a token shouted at chip size in a dense
 * row. This is a name in a table beside prose, and `UCPath` / `OnBase` /
 * `I-9` are what the systems are actually called. One vocabulary, two
 * treatments, and the two are not interchangeable in either direction.
 *
 * **Where a note comes from.** The demo is the design authority for every
 * system it covers, and demo-covered copy is ported BYTE FOR BYTE (operator's
 * ruling, unit U4b) — including `onbase` and `i9`, whose notes restate
 * provisioning state that the served `Test` column also carries. U3 read that
 * restatement as the fail-loud rule's plausible-but-wrong sentence and
 * re-authored both; that was the wrong call. The tension is real — one of these
 * constants could one day contradict the column beside it — but it is an
 * operator question about the demo's copy, not a licence to write new prose in
 * the demo's place. Raise it; do not resolve it here.
 *
 * A system the demo does NOT cover (`new-kronos`, `old-kronos`, `sharepoint` —
 * the demo carried one undifferentiated `kronos` and no SharePoint) has no copy
 * to port, so its note is authored and marked as such at the entry. Every note
 * says why the instance choice matters for that system.
 *
 * `Record<BrowserSystemId, …>` on the CLOSED enum, so a tenth system is a
 * compile error here rather than a row that renders its id again.
 */
export interface SystemHostPresentation {
  /** the system's own name, as it is written everywhere but a chip */
  readonly name: string;
  /** why the instance choice matters for this system */
  readonly note: string;
}


export const SYSTEM_HOST_PRESENTATION: Record<BrowserSystemId, SystemHostPresentation> = {
  // ported from legacy 1ec1d870 src/dashboard/components/dev/rebuild-demo/demo-runstart-wire.ts:89-93
  ucpath: {
    name: "UCPath",
    note: "A UCPath write on the test host files nothing real and reads a stale copy of the roster.",
  },
  // ported from legacy 1ec1d870 src/dashboard/components/dev/rebuild-demo/demo-runstart-wire.ts:94-98
  kuali: {
    name: "Kuali",
    note: "Staging holds its own documents — a doc ID from production will not resolve there.",
  },
  // ported from legacy 1ec1d870 src/dashboard/components/dev/rebuild-demo/demo-runstart-wire.ts:104-108
  crm: {
    name: "CRM",
    note: "Read-only for the download workflow, so the risk of the wrong host here is a wrong answer, not a wrong write.",
  },
  // ported from legacy 1ec1d870 src/dashboard/components/dev/rebuild-demo/demo-runstart-wire.ts:109-113
  servicenow: {
    name: "ServiceNow",
    note: "A ticket filed on the dev host is real and visible — it just goes to nobody.",
  },
  // ported from legacy 1ec1d870 src/dashboard/components/dev/rebuild-demo/demo-runstart-wire.ts:114-118
  onbase: {
    name: "OnBase",
    note: "No test host is provisioned — a test run here is refused at enqueue rather than silently sent to production.",
  },
  // ported from legacy 1ec1d870 src/dashboard/components/dev/rebuild-demo/demo-runstart-wire.ts:119-123
  // The second sentence names a doctor check this build does not serve yet; it
  // is the demo's sentence and stays as written (U4b).
  i9: {
    name: "I-9",
    note: "No test host is provisioned. The doctor's I-9 test-instance check reports the same thing.",
  },
  // authored — no demo counterpart (UI-1 sheet item 6): the demo carried one
  // undifferentiated `kronos` (demo-runstart-wire.ts:99-103), this build
  // resolves two tenants (`stores` catalog, `new-kronos` / `old-kronos`).
  "new-kronos": {
    name: "New Kronos",
    note: "Workforce Dimensions, and where the separation timecard is read — a sandbox keeps its own punches, so the wrong host answers with a plausible wrong total.",
  },
  // authored — no demo counterpart (UI-1 sheet item 6)
  "old-kronos": {
    name: "Old Kronos",
    note: "Workforce Central, kept for the reports the new tenant did not carry across.",
  },
  // authored — no demo counterpart (UI-1 sheet item 6)
  sharepoint: {
    name: "SharePoint",
    note: "A download source, so the wrong host here yields the wrong file rather than the wrong write.",
  },
};


/**
 * `N of M have a test host` — SE40's panel meta. Only `provisioned` counts: a
 * `not-distinct` test host is configured wrong and refused at run time, so it
 * is not a usable test host any more than an unconfigured one is (unit F11b
 * finding 2).
 */
export function systemHostsMeta(hosts: readonly SystemHostWire[]): string {
  const withTest = hosts.filter(({ test }) => test.state === "provisioned").length;
  return `${String(withTest)} of ${String(hosts.length)} have a test host`;
}
