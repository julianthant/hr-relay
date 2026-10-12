import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { SettingsPage } from "../../../../src/dashboard/surfaces/settings/settings.js";
import type { StorageHealthSummaryWireSchema } from "../../../../src/models/dashboard/bootstrap.js";

export async function mountSettingsEditorFixtures(
  DOCUMENT: Awaited<ReturnType<DashboardClient["editableSettings"]>>,
  STORAGE: ReturnType<typeof StorageHealthSummaryWireSchema.parse>,
  applied: unknown[],
  setHost: (host: HTMLElement) => void,
  setRoot: (root: Root) => void,
  onExitGuardChange: (guard: ((proceed: () => void) => void) | undefined) => void,
) {
  const client = {
        editableSettings: () => Promise.resolve(DOCUMENT),
        applySettings: (command: unknown) => {
          applied.push(command);
          return Promise.resolve({ state: "applied", commandId: "00000000-0000-4000-8000-000000000001", affectedTargets: [{ family: "settings", revision: 2 }], restartRequired: true });
        },
      } as unknown as DashboardClient;
  const host = document.createElement("div");
      setHost(host);
      document.body.append(host);
      await act(async () => {
        const root = createRoot(host);
        setRoot(root);
        root.render(createElement(DashboardClientProvider, {
          client,
          children: createElement(SettingsPage, { onClose: () => undefined,
            storage: STORAGE,
            sections: [],
            workflowLabels: new Map<string, string>(),
            section: "performance",
            actorId: "local-operator",
            descriptorFingerprint: "d".repeat(64),
            preflight: [],
            onSection: () => undefined,
            onExitGuardChange,
          }),
        }));
      });
      await act(async () => undefined);
  return host;
}
