/**
 * Whether the storage summary owes the operator attention, and the Settings
 * page's own navigation fold.
 *
 * It lives beside `settings.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import { useEffect, useState } from "react";
import type { z } from "zod";
import type {
  SettingsSectionPrimitiveSchema,
  StorageHealthSummaryWireSchema,
} from "../../domain/dashboard/bootstrap.js";
import {
  SETTINGS_SYSTEM_HOSTS_SECTION_ID,
  SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID,
  type SettingsFactsWire,
  type SystemHostWire,
  type WorkflowCapabilityRowWire,
} from "../../domain/dashboard/settings.js";
import { useDashboardClient } from "../state/client-context.js";
import type { BrowserSystemId } from "./system-chip-model.js";

export type StorageHealthSummary = z.infer<typeof StorageHealthSummaryWireSchema>;
export type SettingsSection = z.infer<typeof SettingsSectionPrimitiveSchema>;

/** True when the top-bar gear should carry the attention dot. */
export function storageNeedsAttention(storage: StorageHealthSummary): boolean {
  return storage.authority !== "healthy" || storage.backup !== "current";
}

/**
 * Which glyph a nav entry draws. A KEY rather than the component itself,
 * because this module may not export a component (see the boundary note above)
 * and the surface owns the mapping.
 */
export type SettingsNavIcon =
  | "storage"
  | "system-hosts"
  | "capabilities"
  | "keyboard"
  | "unrendered";

/**
 * The glyph for each SERVED section this build renders, keyed by the id the
 * server lists. A served id that is not here draws `unrendered` and the pane
 * says so by name — the list stays the server's, and this map only decides what
 * the entry looks like once it has arrived.
 */
const SERVED_NAV_ICON: Readonly<Record<string, SettingsNavIcon>> = Object.freeze({
  storage: "storage",
  [SETTINGS_SYSTEM_HOSTS_SECTION_ID]: "system-hosts",
  [SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID]: "capabilities",
});

export interface SettingsNavEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: SettingsNavIcon;
  /**
   * `served` — the server listed this section; `client` — it is a page of the
   * bundle itself with nothing behind it on the wire. Help is the only `client`
   * entry today, and the ledger row that asked for it (SE7) says exactly why:
   * a keyboard legend is a fact about THIS build's bindings, so a served
   * section for it would be the server describing the client to itself.
   */
  readonly source: "served" | "client";
}

export interface SettingsNavGroup {
  readonly heading: string;
  readonly entries: readonly SettingsNavEntry[];
}

/** The Help group's one entry — the destination the top bar's deleted keyboard glyph was traded for. */
export const SETTINGS_KEYBOARD_SECTION_ID = "keyboard";

/**
 * The gear's stable DOM id, and the app shell's main region behind the
 * takeover — the two focus-restoration targets on close (unit F4b finding 1).
 *
 * Settings was a `Dialog`, and Radix restores focus to the element that opened
 * it when a dialog closes. As a routed page it has no such trigger ref — the
 * takeover can be reached from two doors (the gear, and the storage band's
 * `Storage health`) and can survive a reload — so the target is looked up by
 * id the same way `WORKFLOW_PANEL_TOGGLE_ID` is (`shell.tsx`), rather than
 * held as a React ref threaded down through `TopBar`.
 */
export const SETTINGS_GEAR_ID = "settings-gear";
export const DASHBOARD_MAIN_REGION_ID = "dashboard-main-region";

/**
 * Which id to focus when the takeover closes: the gear it was opened from, or
 * — if the gear is not mounted — the main region the takeover was covering.
 * The gear is part of the persistent `TopBar` and is always mounted while
 * `SettingsPage` is, so `gearMounted` is normally `true`; the fallback exists
 * because the id lookup happens through the DOM rather than through a prop the
 * type system can prove present.
 */
export function settingsCloseFocusTargetId(gearMounted: boolean): string {
  return gearMounted ? SETTINGS_GEAR_ID : DASHBOARD_MAIN_REGION_ID;
}

/**
 * The demo's three nav groups, minus the ones this build has no member for.
 *
 * The demo draws `Settings` (editable leaves) · `Status` · `Help`. Editable
 * settings are a deferred command family (`apply-settings`, doc 04) and the
 * server lists none, so the first heading is not drawn over an empty list —
 * a group heading with nothing under it reads as a section that failed to
 * load. Every section the server DOES list is read-only status today, which is
 * the heading they get.
 */
export function buildSettingsNav(sections: readonly SettingsSection[]): readonly SettingsNavGroup[] {
  const groups: SettingsNavGroup[] = [];
  if (sections.length > 0) {
    groups.push({
      heading: "Status",
      entries: sections.map((section) => ({
        id: section.id,
        label: section.label,
        icon: SERVED_NAV_ICON[section.id] ?? "unrendered",
        source: "served",
      })),
    });
  }
  groups.push({
    heading: "Help",
    entries: [{ id: SETTINGS_KEYBOARD_SECTION_ID, label: "Keyboard", icon: "keyboard", source: "client" }],
  });
  return groups;
}

/**
 * Which section the page opens on, resolved from `?settings=`.
 *
 * An empty value is the demo's `initialSection` default — the first entry. A
 * value naming a section this build has no entry for resolves to `unknown`
 * rather than quietly falling back to the first one: a link that says
 * `?settings=budgets` and lands on Storage has told the operator they are
 * looking at something they are not.
 */
export type SettingsSectionResolution =
  | { readonly state: "open"; readonly entry: SettingsNavEntry }
  | { readonly state: "unknown"; readonly requested: string }
  | { readonly state: "empty" };

export function resolveSettingsSection(
  groups: readonly SettingsNavGroup[],
  requested: string,
): SettingsSectionResolution {
  const entries = groups.flatMap((group) => group.entries);
  const first = entries[0];
  if (requested.length === 0) {
    return first === undefined ? { state: "empty" } : { state: "open", entry: first };
  }
  const found = entries.find((entry) => entry.id === requested);
  return found === undefined ? { state: "unknown", requested } : { state: "open", entry: found };
}

/* ── the two READ-ONLY status sections (D274 item 6, ledger 3 SE40–SE42) ──── */

export type SettingsFactsState =
  | { readonly state: "loading" }
  | { readonly state: "loaded"; readonly facts: SettingsFactsWire }
  | { readonly state: "failed"; readonly message: string };

/**
 * Reads `GET /api/v1/settings/facts` once, when a section that needs it opens.
 *
 * Three states, all of them drawn (D275 item 4). A refusal is NOT an empty
 * table: "no host is configured" and "we could not ask" are different sentences
 * and only one of them is ever true, so the failed arm carries the transport's
 * own message rather than falling back to a plausible blank page.
 */
export function useSettingsFacts(): SettingsFactsState {
  const client = useDashboardClient();
  const [state, setState] = useState<SettingsFactsState>({ state: "loading" });
  useEffect(() => {
    let live = true;
    client.settingsFacts().then(
      (facts) => { if (live) setState({ state: "loaded", facts }); },
      (caught: unknown) => {
        if (!live) return;
        setState({
          state: "failed",
          message: caught instanceof Error ? caught.message : String(caught),
        });
      },
    );
    return () => { live = false; };
  }, [client]);
  return state;
}

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

export type CapabilityKey =
  | "dry-run"
  | "typed-start"
  | "review-panel"
  | "edit-data"
  | "operator-gates"
  | "browser-systems";

export interface CapabilitySpec {
  readonly key: CapabilityKey;
  readonly label: string;
  /** what the capability means, in the operator's words — lives behind the ⓘ */
  readonly meaning: string;
}

/**
 * The SERVED vocabulary, in the order the page reads it: what starts it, what
 * it will and will not write, then what it touches and who has to be there.
 *
 * Six, not the demo's sixteen. D274 item 4's rule for exactly this case is to
 * build the vocabulary the product actually serves and NAME the absence rather
 * than mint a column with nothing behind it — a matrix that claims a capability
 * no descriptor declares is wrong silently, which is the worst way to be wrong
 * on a page whose whole job is to say what is true.
 */
export const CAPABILITY_SPECS: readonly CapabilitySpec[] = Object.freeze([
  {
    key: "typed-start",
    label: "Typed start",
    meaning: "Whether you can start this by typing subjects into the Run modal. A workflow without one is started as a step of the composition that owns it.",
  },
  {
    key: "dry-run",
    label: "Dry run",
    meaning: "Offers a rehearsal that reads everything for real and writes nothing. A workflow that changes no system of record has nothing to rehearse.",
  },
  {
    key: "edit-data",
    label: "Edit Data",
    meaning: "Which checkpoint values you may correct from the Context rail. The descriptor names the exact paths; anything it does not name is read-only.",
  },
  {
    key: "review-panel",
    label: "Review panel",
    meaning: "Its rows get a Review panel of their own rather than being read from the queue.",
  },
  {
    key: "operator-gates",
    label: "Operator gates",
    meaning: "The points where a run parks and waits for you. A gate resolved by another system or by its own children is not your work and is not listed.",
  },
  {
    key: "browser-systems",
    label: "Systems",
    meaning: "The systems a run signs into and drives. Every one of them needs an authenticated session before the run can move.",
  },
]);

/**
 * ONE cell. Three shapes, told apart by SHAPE and by WORD, never by colour:
 * available carries the thing itself, `not-applicable` carries the decision, and
 * `not-built` carries the gap with its named offender. Collapsing the last two
 * into one grey dash is how "we chose not to" and "we have not got to it" become
 * indistinguishable, and an operator plans differently depending on which it is.
 */
export type CapabilityCell =
  | { readonly state: "available"; readonly detail: string }
  | { readonly state: "not-applicable"; readonly reason: string }
  | { readonly state: "not-built"; readonly reason: string };

export interface CapabilityRow {
  readonly workflowId: string;
  /** the bootstrap's label, or the id itself when this document does not list it */
  readonly label: string;
  readonly labelServed: boolean;
  readonly cells: Readonly<Record<CapabilityKey, CapabilityCell>>;
  /** SE41's posture table reads the same served arm this row's `dry-run` cell does */
  readonly dryRunPosture: string;
}

function dryRunCell(row: WorkflowCapabilityRowWire): CapabilityCell {
  if (row.dryRun.state === "supported") {
    return { state: "available", detail: `stops at ${String(row.dryRun.stopsAt)}` };
  }
  if (row.dryRun.reason === "no-transaction-node") {
    return { state: "not-applicable", reason: "writes to no system of record" };
  }
  return { state: "not-built", reason: `${String(row.dryRun.nodeId)} declares no preview arm` };
}

/**
 * The one fact that is NOT a yes/no, so it also gets its own table: a workflow
 * can honour a rehearsal, have nothing to rehearse, or write and refuse one —
 * and the third is the answer worth reading before a real HR transaction.
 */
export function dryRunPostureSentence(row: WorkflowCapabilityRowWire): string {
  if (row.dryRun.state === "supported") {
    return `Stops after the prepare of ${String(row.dryRun.stopsAt)} — nothing is committed.`;
  }
  if (row.dryRun.reason === "no-transaction-node") {
    return "Nothing to stop at: this graph commits to no system of record, so a rehearsal of it is an ordinary run.";
  }
  return `Refused: ${String(row.dryRun.nodeId)} commits and declares no preview arm, so a rehearsal cannot reach the end.`;
}

function editDataCell(row: WorkflowCapabilityRowWire): CapabilityCell {
  if (row.editData.state === "read-only") {
    return { state: "not-applicable", reason: "no correctable path is declared" };
  }
  if (row.editData.editableFields === 0) {
    return { state: "not-applicable", reason: "declared, and no path is correctable" };
  }
  const count = row.editData.editableFields;
  return { state: "available", detail: `${String(count)} correctable field${count === 1 ? "" : "s"}` };
}

/**
 * The served rows, joined to the bootstrap's labels.
 *
 * The label is the BOOTSTRAP's — the capability wire deliberately carries none,
 * so one page cannot hold two names for one workflow. A row this document does
 * not list falls back to the workflow's own id, which is its identity and not an
 * invented name, and says so through `labelServed` rather than reading as a
 * badly-cased label.
 */
export function capabilityMatrix(
  rows: readonly WorkflowCapabilityRowWire[],
  labels: ReadonlyMap<string, string>,
): readonly CapabilityRow[] {
  return rows.map((row) => {
    const id = String(row.workflowId);
    const served = labels.get(id);
    const gates = row.operatorGates.map((gate) => String(gate));
    const systems = row.browserSystems.map((system) => String(system));
    return Object.freeze({
      workflowId: id,
      label: served ?? id,
      labelServed: served !== undefined,
      dryRunPosture: dryRunPostureSentence(row),
      cells: Object.freeze({
        "typed-start": row.typedStart
          ? { state: "available" as const, detail: "typed input" }
          : { state: "not-applicable" as const, reason: "no typed start surface is declared" },
        "dry-run": dryRunCell(row),
        "edit-data": editDataCell(row),
        "review-panel": row.reviewPanel
          ? { state: "available" as const, detail: "Review panel" }
          : { state: "not-applicable" as const, reason: "read from the queue" },
        "operator-gates": gates.length > 0
          ? { state: "available" as const, detail: gates.join(", ") }
          : { state: "not-applicable" as const, reason: "parks on no operator gate" },
        "browser-systems": systems.length > 0
          ? { state: "available" as const, detail: systems.join(", ") }
          : { state: "not-applicable" as const, reason: "drives no browser system" },
      }),
    });
  });
}

/** `N of M` per capability — how many workflows answer it at all. */
export function capabilityAvailableCount(
  matrix: readonly CapabilityRow[],
  key: CapabilityKey,
): number {
  return matrix.filter((row) => row.cells[key].state === "available").length;
}
