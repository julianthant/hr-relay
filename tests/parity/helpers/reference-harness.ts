import { expect,test } from "@playwright/test";
import { resolve } from "node:path";
import { PARITY_DIST_DIR,ensureParityBundle } from "./bundle.js";
import { startFixtureServer,type FixtureServer } from "./fixture-bff.js";
import { FIXTURE_DESCRIPTOR_HASH } from "./fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./fixture-queue.js";
import { FIXTURE_SEPARATIONS_START_PLAN,FIXTURE_START_PICKER_BOOTSTRAP,FIXTURE_START_PICKER_DAY_WIRE,FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./fixture-start.js";
import { FIXTURE_STORAGE_DEGRADED_BOOTSTRAP } from "./fixture-storage.js";
import { startSeededServer,type SeededServer } from "./seeded-bff.js";
export const REFERENCES = resolve(import.meta.dirname, "../references");
export function registerReferenceServers(kinds: readonly ("server" | "startPickerServer" | "separationsStartServer" | "storageServer" | "seeded")[]) {
let server: FixtureServer | undefined;
let startPickerServer: FixtureServer | undefined;
let separationsStartServer: FixtureServer | undefined;
let storageServer: FixtureServer | undefined;
let seeded: SeededServer | undefined;
test.beforeAll(async () => {
  // Build (or prove the reuse of) the bundle under test before anything serves
  // it: a reference captured from a stale `dist/dashboard` documents code that
  // is not in the working tree.
  ensureParityBundle();

  if (kinds.includes("server")) server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });

  if (kinds.includes("startPickerServer")) startPickerServer = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
    profile: {
      bootstrap: FIXTURE_START_PICKER_BOOTSTRAP,
      day: FIXTURE_START_PICKER_DAY_WIRE,
      descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
    },
  });

  if (kinds.includes("separationsStartServer")) separationsStartServer = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
    profile: {
      bootstrap: FIXTURE_START_PICKER_BOOTSTRAP,
      day: FIXTURE_START_PICKER_DAY_WIRE,
      descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
      startPlan: FIXTURE_SEPARATIONS_START_PLAN,
    },
  });

  if (kinds.includes("storageServer")) storageServer = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
    profile: {
      bootstrap: FIXTURE_STORAGE_DEGRADED_BOOTSTRAP,
      day: FIXTURE_DAY_WIRE,
      descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    },
  });

  if (kinds.includes("seeded")) seeded = await startSeededServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });});
test.afterAll(async () => {if (server !== undefined) await server.close();
if (startPickerServer !== undefined) await startPickerServer.close();
if (separationsStartServer !== undefined) await separationsStartServer.close();
if (storageServer !== undefined) await storageServer.close();
if (seeded !== undefined) await seeded.close();});
return {get server() { if (server === undefined) throw new Error("server was not started for this reference spec"); return server; },
get startPickerServer() { if (startPickerServer === undefined) throw new Error("startPickerServer was not started for this reference spec"); return startPickerServer; },
get separationsStartServer() { if (separationsStartServer === undefined) throw new Error("separationsStartServer was not started for this reference spec"); return separationsStartServer; },
get storageServer() { if (storageServer === undefined) throw new Error("storageServer was not started for this reference spec"); return storageServer; },
get seeded() { if (seeded === undefined) throw new Error("seeded was not started for this reference spec"); return seeded; }};
}


/**
 * The workflow panel opens as a FLOATING window that dismisses on the first
 * click outside it, and at these viewports it sits over the intake workspace's
 * left edge — its target-field column and its stage tabs.
 *
 * The queue's references keep the window because the queue is what the window
 * is FOR: you pick a workflow, you read its rows. The intake workspace is a
 * takeover, so the operator's very first act is a click into it, and a
 * reference photographed before that click documents a window rather than the
 * surface under test. The press lands on the panel header — deliberately not
 * the body, where the dropzone would open a file chooser instead.
 */
export async function dismissWorkflowWindow(page: import("@playwright/test").Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("the parity lane always sets a viewport before navigating");
  // Horizontally centred so it lands in the header's empty middle at every
  // reference viewport — at 1024 the trailing controls reach x≈900.
  await page.mouse.click(viewport.width / 2, 100);
  await page.waitForTimeout(120);
}


/**
 * Dismiss the window on a QUEUE view — where `y=100` is a live control.
 *
 * On a takeover the queue and its bands are gone, so the press above lands in
 * empty chrome. On the queue view it lands on the STATUS FILTER ROW, and the
 * first `panel-dismissed` reference minted with it photographed the queue
 * filtered to `Done 2` while claiming to be the day queue — a harness that
 * changed the state it was supposed to reveal. (`run-receipt-populated` already
 * found this once and worked around it locally; this is the same finding with a
 * post-condition attached so it cannot happen a third time.)
 *
 * The press goes into the panel region instead, which is inert on both views:
 * the `No run open` empty state with nothing selected, the log stream with a
 * run open. And it ASSERTS its own post-condition — the window gone AND the
 * status filter untouched — because a dismissal that quietly changes the
 * subject is exactly the check that cannot fail.
 */
export async function dismissWorkflowWindowOverQueue(page: import("@playwright/test").Page): Promise<void> {
  const filters = page.getByRole("group", { name: "Filter the queue by status" });
  const pressedBefore = await filters.getByRole("button", { pressed: true }).allInnerTexts();
  await page.mouse.click(500, 500);
  await page.waitForTimeout(120);
  await expect(
    page.getByRole("region", { name: "Workflow Panel" }),
    "the workflow window is still on screen; the reference would photograph it",
  ).toHaveCount(0);
  expect(
    await filters.getByRole("button", { pressed: true }).allInnerTexts(),
    "dismissing the window changed the queue's status filter — the reference would show a different queue",
  ).toEqual(pressedBefore);
}


/** A page that logged an uncaught error did not render the state under test. */
export function failOnPageErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}
