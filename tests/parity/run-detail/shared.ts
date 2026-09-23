import { expect,type Page } from "@playwright/test";
import { gotoAppState } from "../helpers/app-driver.js";
import {
  PARITY_THEMES,
  PARITY_VIEWPORTS,
  assertThemeApplied,
  captureParityPair,
  installTheme,
  type ParityTheme,
} from "../helpers/capture.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "../helpers/fixture-identity.js";
import { assertShellGeometry } from "../helpers/geometry.js";
import { REFERENCES,dismissWorkflowWindow,failOnPageErrors,registerReferenceServers } from "../helpers/reference-harness.js";
import type { ReferenceScene } from "../helpers/reference-scenes.js";
import { ANCHORS } from "../helpers/reference-detail-scenes.js";

export function registerRunDetailServer() {
  return registerReferenceServers(["server"]);
}

export function registerSeededServer() {
  return registerReferenceServers(["seeded"]);
}

export function referenceSceneGroups(
  scenes: readonly ReferenceScene[],
  serverBaseUrl: () => string,
): readonly Readonly<{
  title: string;
  tests: readonly Readonly<{ title: string; run(input: { page: Page }): Promise<void> }>[];
}>[] {
  const groups = [];
  for (const viewport of PARITY_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      groups.push({
        title: `${theme.name} @ ${viewport.name}`,
        tests: scenes.map((scene) => ({
          title: scene.id,
          run: async ({ page }: { page: Page }) => {
            const errors = failOnPageErrors(page);
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await installTheme(page, theme satisfies ParityTheme);
            await gotoAppState(page, serverBaseUrl(), scene.route);
            if (
              scene.route.intake !== undefined
              || scene.route.explore !== undefined
              || scene.route.archive !== undefined
              || scene.route.activity !== undefined
              || scene.route.settings !== undefined
            ) await dismissWorkflowWindow(page);
            await assertThemeApplied(page, theme satisfies ParityTheme);
            await page.waitForTimeout(120);
            await assertShellGeometry(page, `${scene.id} @ ${viewport.name} ${theme.name}`);
            await ANCHORS[scene.id]?.(page);
            expect(errors, `page errors while rendering ${scene.id}`).toEqual([]);
            await captureParityPair(page, REFERENCES, {
              stateId: scene.id,
              viewport: viewport.name,
              theme: theme.name,
              adapter: "fixture",
              fixtureId: scene.id,
              descriptorHash: FIXTURE_DESCRIPTOR_HASH,
              appVersion: FIXTURE_APP_VERSION,
              capturedAt: FIXTURE_DAY,
              variant: "default",
            });
          },
        })),
      });
    }
  }
  return groups;
}
