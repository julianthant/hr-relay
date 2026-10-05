/**
 * Fetching exactly the sections the open panel needs — no more.
 *
 * Attempts and the active tab request their served sections; a failed run
 * additionally requests its failure pointer, because the
 * Logs stream renders the failure inline rather than behind a tab. Every one of
 * those is requested ONLY if the detail advertised it, so an absence stays an
 * absence instead of becoming a 404 the operator has to interpret.
 */
import { useEffect, useState } from "react";
import type { RunDetailWire } from "../../../domain/dashboard/run-detail.js";
import { DashboardClientError } from "../../client/index.js";
import type { PanelSections } from "./sections.js";
import { mergeSection, sectionsWanted } from "./section-registration.js";
import type { PanelTab } from "./log-panel-model.js";
import { useDashboardClient } from "../../state/client-context.js";

export interface PanelSectionsState {
  readonly sections: PanelSections;
  readonly error?: DashboardClientError;
}

export function usePanelSections(
  detail: RunDetailWire | undefined,
  tab: PanelTab,
): PanelSectionsState {
  const client = useDashboardClient();
  const [state, setState] = useState<PanelSectionsState & { readonly runId?: string }>({ sections: {} });
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
    // The SAME run re-read (D257 — its revision moved, so the panel is
    // following it) keeps what it already had on screen; a DIFFERENT run
    // clears, because the previous run's sections beside this run's header
    // would be the wrong answer rather than a stale one.
    setState((current) => (
      current.runId === String(runId) ? current : { runId: String(runId), sections: {} }
    ));
    const names = wantedKey.split(",");
    void Promise.all(names.map(async (name) => client.runSection(runId, name))).then(
      (responses) => {
        if (!live) return;
        setState({ runId: String(runId), sections: responses.reduce<PanelSections>(mergeSection, {}) });
      },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) {
          // The panel keeps rendering its header and timeline; the sections it
          // could not read say so rather than looking empty.
          setState({ runId: String(runId), sections: {}, error });
          return;
        }
        throw error;
      },
    );
    return () => {
      live = false;
    };
  }, [client, runId, wantedKey, revision]);

  // Effects run after render. Mask the previous run synchronously so its
  // sections never sit beside a newly selected run's header for one frame.
  return runId !== undefined && state.runId === String(runId) ? state : { sections: {} };
}
