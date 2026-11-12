import { expect } from "@playwright/test";
import { test } from "./fixtures.js";
import { gotoAppState,type AppRoute } from "./app-driver.js";
import {
PARITY_THEMES,
PARITY_VIEWPORTS,
assertThemeApplied,
installTheme,
type ParityTheme,
} from "./capture.js";
import { type FixtureServer } from "../../support/helpers/dashboard/fixture-bff.js";
import { assertShellGeometry } from "./geometry.js";
import { dismissWorkflowWindow,failOnPageErrors } from "./reference-harness.js";
export interface ReferenceScene { readonly id: string; readonly route: AppRoute }
export type SceneAnchors = Readonly<Record<string, (page: import("@playwright/test").Page) => Promise<void>>>;
export function registerReferenceScenes(states: readonly ReferenceScene[], server: () => FixtureServer, anchors: SceneAnchors) {

for (const viewport of PARITY_VIEWPORTS) {
  for (const theme of PARITY_THEMES) {
    test.describe(`${theme.name} @ ${viewport.name}`, () => {
      for (const state of states) {
        test(state.id, async ({ page }) => {
          const errors = failOnPageErrors(page);
          await page.setViewportSize({ width: viewport.width, height: viewport.height });

          await installTheme(page, theme satisfies ParityTheme);
          await gotoAppState(page, server().baseUrl, state.route);

          if (
            state.route.intake !== undefined
            || state.route.explore !== undefined
            || state.route.archive !== undefined
            || state.route.activity !== undefined
            || state.route.settings !== undefined
          ) await dismissWorkflowWindow(page);
          await assertThemeApplied(page, theme satisfies ParityTheme);
          await page.waitForTimeout(120);


          await assertShellGeometry(page, `${state.id} @ ${viewport.name} ${theme.name}`);

          await anchors[state.id]?.(page);
          expect(errors, `page errors while rendering ${state.id}`).toEqual([]);

        });
      }
    });
  }
}}
