import { PNG } from "pngjs";
import { WorkflowBootstrapPrimitiveSchema } from "../../src/models/dashboard/bootstrap.js";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { chooseSelect } from "./helpers/select-choice.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { WORKFLOW_MODULES } from "../../src/backend/app/registries/workflow-registry.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";

for (const attribute of ["light", "dark"] as const) for (const width of [1024, 1280, 1440]) for (const workflow of ["person-lookup", "separations"]) {
  const name = `explorer-${workflow}-${attribute}-${width}`;
  const evidence = `${name}.a11y.yml`;
  test(`served Explorer matches mock ${workflow} @ ${attribute} ${width}`, { annotation: [{ type: "required-a11y-evidence", description: evidence }] }, async ({ page }, info) => {
    const bootstrap = { ...FIXTURE_START_PICKER_BOOTSTRAP, workflows: FIXTURE_START_PICKER_BOOTSTRAP.workflows.map(value => { const item = WorkflowBootstrapPrimitiveSchema.parse(value); return { ...item, start: { ...item.start, version: WORKFLOW_MODULES.find(module => module.descriptor.id === item.id)!.descriptor.version } }; }) };
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: { bootstrap, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH } });
    try {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, attribute);
      const writes: string[] = [];
      page.on("request", request => { if (request.method() !== "GET") writes.push(request.method() + " " + new URL(request.url()).pathname); });
      const cases = workflow === "separations" ? [
        { id: "default", choices: [] },
        { id: "review", choices: [["Identity check preview", "review"]] },
        { id: "rejected", choices: [["Identity check preview", "rejected"]] },
        { id: "pending", choices: [["Read result preview", "some"]] },
        { id: "pending-unknown", choices: [["Read result preview", "unknown"]] },
        { id: "existing", choices: [["Existing termination preview", "present"]] },
        { id: "existing-unknown", choices: [["Existing termination preview", "unknown"]] },
        { id: "source", choices: [] },
      ] : [
        { id: "default", choices: [] },
        { id: "match", choices: [["Lookup path preview", "match"]] },
        { id: "crm-off", choices: [["CRM cross-check preview", "off"]] },
        { id: "eid", choices: [["Search identifier preview", "eid"]] },
        { id: "dates", choices: [["Caller CRM dates preview", "requested"]] },
        { id: "source", choices: [] },
      ];
      for (const preview of cases) {
        const captures = [];
        for (const served of [false, true]) {
          await page.goto(`${server.baseUrl}/?${served ? "fixture=workflow-catalog&" : ""}explore=${served ? workflow : `fixture-${workflow}`}`);
          const surface = page.getByRole("region", { name: "Workflow explorer preview", exact: true });
          await chooseSelect(surface.getByRole("combobox", { name: "Explorer workflow", exact: true }), served ? workflow : `fixture-${workflow}`);
          await expect(surface.getByRole("heading", { name: workflow === "separations" ? "Open browser sessions" : "Person Lookup", exact: true })).toBeVisible();
          await expect(page.locator("[data-app-root]")).toHaveAttribute("data-demo-theme", attribute);
          if (preview.id === "dates" && !served) await chooseSelect(surface.getByRole("combobox", { name: "Lookup path preview", exact: true }), "delegated");
          for (const [label, value] of preview.choices) await chooseSelect(surface.getByRole("combobox", { name: label, exact: true }), value);
          if (preview.id === "source") await surface.getByRole("button", { name: `Show source for ${workflow === "separations" ? "Department" : "Campus"}`, exact: true }).click();
          if (preview.id === "dates") {
            await expect(surface.locator("li[data-step-number]")).toHaveCount(served ? 5 : 8);
            if (served) for (const title of ["Accept delegation", "Member fan-out", "Report back"]) await expect(surface.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
          }
          const target = preview.id === "dates" ? surface.locator("details").filter({ has: page.getByText("Caller-requested CRM dates", { exact: true }) }) : surface;
          const tree = await target.ariaSnapshot();
          const state = served ? "served" : "mock";
          const screenshotName = `${name}-${preview.id}-${state}.png`;
          const screenshotPath = info.outputPath(screenshotName);
          const screenshot = await target.screenshot({ path: screenshotPath, animations: "disabled" });
          await info.attach(screenshotName, { path: screenshotPath, contentType: "image/png" });
          const treeName = `${name}-${preview.id}-${state}.a11y.yml`;
          const treePath = info.outputPath(treeName);
          writeFileSync(treePath, tree);
          captures.push({ tree, screenshot });
        }
        if (preview.id === "default") {
          info.annotations.push({ type: `a11y-attachment-sha256:${evidence}`, description: createHash("sha256").update(captures[1].tree).digest("hex") });
          await info.attach(evidence, { body: captures[1].tree, contentType: "text/yaml" });
        }
        expect(writes).toEqual([]);
        expect(captures[1].tree).toEqual(captures[0].tree);
        const expected = PNG.sync.read(captures[0].screenshot), actual = PNG.sync.read(captures[1].screenshot);
        expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
        // Chromium repeated captures differ by one color level at antialiased edges.
        const changed = actual.data.reduce((count, value, index) => count + Number(Math.abs(value - expected.data[index]) > 1), 0);
        expect(changed, preview.id).toBe(0);
      }
    } finally { await server.close(); }
  });
}
