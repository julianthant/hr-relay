/**
 * Fetching exactly the sections the open panel needs — no more.
 *
 * The context rail always wants its three ledgers; the tab wants its own
 * section; a failed run additionally wants its failure pointer, because the
 * Logs stream renders the failure inline rather than behind a tab. Every one of
 * those is requested ONLY if the detail advertised it, so an absence stays an
 * absence instead of becoming a 404 the operator has to interpret.
 */
import { useEffect, useState } from "react";
import type { RunDetailSectionResponse, RunDetailWire } from "../../domain/dashboard/run-detail.js";
import { DashboardClientError } from "../client/index.js";
import type { PanelSections } from "../surfaces/log-panel.js";
import type { PanelTab } from "../surfaces/log-panel-model.js";
import { useDashboardClient } from "../state/client-context.js";

const CONTEXT_SECTIONS = ["context-data", "context-evidence", "context-attempts"] as const;

function sectionsWanted(detail: RunDetailWire, tab: PanelTab): string[] {
  const advertised = new Set(detail.availableSections);
  const wanted = new Set<string>();
  for (const section of CONTEXT_SECTIONS) if (advertised.has(section)) wanted.add(section);
  if (advertised.has(tab)) wanted.add(tab);
  // The inline failure record lives in the Logs stream, so the pointer is
  // needed whenever the run failed — not only when a "failure" tab is open.
  if (advertised.has("failure")) wanted.add("failure");
  // The parked write is the OTHER surface that renders inline in the stream
  // (DESIGN.md names `Waiting on you` and `Write parked` as the two decisions),
  // so it is fetched for the same reason and on the same terms: whenever the
  // run advertises it, never only when some tab is open.
  if (advertised.has("parked-write")) wanted.add("parked-write");
  // Doc 09 §14.4's identity gate is the THIRD inline decision, on exactly the
  // same terms — and it was an orphan until this line: the server has projected
  // it (packet, options, approval shape, both `resolve-gate` descriptors) since
  // the gate landed, nothing ever asked for it, and `merge()` below would have
  // thrown if anything had. A run held at a gate therefore drew a decision card
  // with no way to answer it. R5's escalation on the audit's queue/run-action
  // ledger row (`docs/plans/2026-08-13-detail-fidelity-audit.md`).
  if (advertised.has("identity-gate")) wanted.add("identity-gate");
  return [...wanted];
}

function merge(into: PanelSections, response: RunDetailSectionResponse): PanelSections {
  switch (response.section) {
    case "logs":
      return { ...into, logs: response.payload };
    case "receipt":
      return { ...into, receipt: response.payload };
    case "failure":
      return { ...into, failure: response.payload };
    case "context-data":
      return { ...into, "context-data": response.payload };
    case "context-evidence":
      return { ...into, "context-evidence": response.payload };
    case "context-attempts":
      return { ...into, "context-attempts": response.payload };
    case "parked-write":
      return { ...into, "parked-write": response.payload };
    case "identity-gate":
      return { ...into, "identity-gate": response.payload };
    default:
      // A section the server serves and this build does not know how to place
      // is dropped rather than guessed at — but it must not be silent.
      throw new Error(`run section "${response.section}" has no panel placement in this build`);
  }
}

export interface PanelSectionsState {
  readonly sections: PanelSections;
  readonly error?: DashboardClientError;
}

export function usePanelSections(
  detail: RunDetailWire | undefined,
  tab: PanelTab,
): PanelSectionsState {
  const client = useDashboardClient();
  const [state, setState] = useState<PanelSectionsState>({ sections: {} });
  const runId = detail?.runId;
  // The revision is a fetch dependency on purpose: an applied Data correction
  // refetches the detail at a bumped rowRevision, and the sections it served
  // (editing.expectedVersion, pending corrections) must move with it.
  const revision = detail?.rowRevision;
  const wanted = detail === undefined ? [] : sectionsWanted(detail, tab);
  const wantedKey = wanted.join(",");

  useEffect(() => {
    if (runId === undefined || wantedKey.length === 0) {
      setState({ sections: {} });
      return;
    }
    let live = true;
    setState({ sections: {} });
    const names = wantedKey.split(",");
    void Promise.all(names.map(async (name) => client.runSection(runId, name))).then(
      (responses) => {
        if (!live) return;
        setState({ sections: responses.reduce<PanelSections>(merge, {}) });
      },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) {
          // The panel keeps rendering its header and timeline; the sections it
          // could not read say so rather than looking empty.
          setState({ sections: {}, error });
          return;
        }
        throw error;
      },
    );
    return () => {
      live = false;
    };
  }, [client, runId, wantedKey, revision]);

  return state;
}
