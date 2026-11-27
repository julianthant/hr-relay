import { DashboardDayWireSchema, WorkerCardWireSchema } from "../../src/models/dashboard/projection.js";
import { DashboardStreamEnvelopeSchema } from "../../src/models/dashboard/subscription.js";
import { ERROR_CATALOG } from "../../src/models/failures/error-catalog.js";
import { workerPoolMember, WorkerSlotRecordSchema } from "../../src/models/run/worker-slot.js";
import { CommandRequestSchema, CommandResultSchema } from "../../src/rules/commands/commands.js";
import { SEEDED_NOW } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { expect, SEEDED_PREFERENCE_WRITE, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

test.use({ actionTimeout: 10_000 });

test("worker add and remove settle after delayed or refused replies and clear on workflow switch", async ({ dashboard, page, seeded, failures }) => {
  failures.allow(SEEDED_PREFERENCE_WRITE, "The seeded server does not implement the selected workflow preference.");
  const slot = WorkerSlotRecordSchema.parse({
    workerId: "separations-worker-99", workflow: "separations", ordinal: 99, poolIndex: 1,
    paused: false, retiredAt: null, createdAt: SEEDED_NOW, updatedAt: SEEDED_NOW,
  });
  const card = WorkerCardWireSchema.parse({
    workerId: slot.workerId, member: workerPoolMember(slot), workflowId: slot.workflow, state: "idle",
    controls: { basis: { state: "present", value: { lifetimeId: "00000000-0000-4000-8000-000000000099", version: 1 } } },
    directive: "run", startedAt: SEEDED_NOW, currentRun: { state: "absent", reason: "no current run" }, browsers: [], revision: 1,
  });
  let added = false;
  let version = 0;
  let reply: ReturnType<typeof Promise.withResolvers<boolean>> | undefined;
  const readSeededDay = async () => {
    const source = await page.request.get(new URL(`/api/v1/dashboard?day=${seeded.day}`, seeded.baseUrl).href);
    expect(source.ok()).toBe(true);
    return DashboardDayWireSchema.parse(await source.json());
  };
  const initialDay = await readSeededDay();
  const workerDay = (day = initialDay) => version === 0 ? day : DashboardDayWireSchema.parse({
      ...day,
      workerAuthority: { state: "present", members: [...day.workerAuthority.members, ...(added ? [slot] : [])] },
      workerCards: [...day.workerCards, ...(added ? [card] : [])],
      workerPools: [...day.workerPools, { workflowId: slot.workflow, desiredWorkers: added ? 1 : 0, version, plannedBy: "local-operator", plannedAt: SEEDED_NOW }],
  });
  await page.route("**/api/v1/dashboard?day=*", route => route.fulfill({ json: workerDay() }));
  await page.addInitScript(() => {
    const fetchFromServer = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await fetchFromServer(input, init);
      if (!response.headers.get("content-type")?.startsWith("text/event-stream") || response.body === null) return response;
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        start(controller) {
          window.addEventListener("seeded-worker-snapshot", event => {
            if (event instanceof MessageEvent && typeof event.data === "string") controller.enqueue(new TextEncoder().encode(event.data));
          }, { signal: init?.signal ?? undefined });
        },
      }));
      return new Response(body, { status: response.status, headers: response.headers });
    };
  });
  // A new stream connection advances the server cursor, so overlay the worker change on a fresh day.
  const publishWorkers = async () => {
    const snapshot = workerDay(await readSeededDay());
    const envelope = DashboardStreamEnvelopeSchema.parse({
      type: "snapshot", topic: "dashboard-day", rows: [], cursor: snapshot.snapshotCursor, position: 0, payload: snapshot,
    });
    return page.evaluate(data => window.dispatchEvent(new MessageEvent("seeded-worker-snapshot", { data })),
      `data: ${JSON.stringify(envelope)}\n\n`);
  };
  await page.route("**/api/v1/commands", async route => {
    const request = CommandRequestSchema.parse(route.request().postDataJSON());
    if (request.family !== "worker-browser") { await route.fallback(); return; }
    expect(request.type).toBe(added ? "remove-worker" : "plan-worker-count");
    if (request.type === "plan-worker-count") {
      expect(request.target).toEqual({ workflowId: slot.workflow, expectedVersion: version });
      expect(request.payload.desiredWorkers).toBe(1);
    } else if (request.type === "remove-worker") {
      expect(request.target.workerId).toBe(slot.workerId);
    } else throw new Error(`Unexpected worker command ${request.type}`);
    if (reply === undefined) throw new Error("Unexpected extra worker command");
    const accepted = await reply.promise;
    if (accepted) { added = request.type === "plan-worker-count"; version += 1; }
    await route.fulfill({ json: CommandResultSchema.parse(accepted
      ? { state: "applied", commandId: request.commandId, affectedTargets: request.type === "plan-worker-count"
        ? [{ family: "worker-pool", workflowId: slot.workflow }] : [{ family: "worker-browser", workerId: slot.workerId }] }
      : { state: "rejected", commandId: request.commandId, code: "invalid-state", message: "Fixture refused this worker command." }) });
  });

  await dashboard.open();
  const add = page.getByRole("navigation", { name: "Workflows" }).locator("xpath=ancestor::aside").getByRole("button", { name: "Add workers" });
  const dialog = page.getByRole("dialog", { name: "Add workers" });
  const worker = page.getByRole("article", { name: "Worker 99 · Separations" });
  const remove = worker.getByRole("button", { name: "Remove worker" });
  const toasts = page.locator('[data-slot="toast-title"]');
  const adding = page.locator("li[aria-busy]");
  const failedAdd = toasts.filter({ hasText: "Couldn't add workers" });
  const failedRemove = toasts.filter({ hasText: ERROR_CATALOG.COMMAND_REFUSED.text });
  const progress = page.getByRole("region", { name: "Session Panel" }).getByRole("status");
  const success = toasts.filter({ hasText: "Workers added" });

  async function startAdd() {
    reply = Promise.withResolvers<boolean>();
    await add.click();
    await dialog.getByRole("combobox", { name: "Workflow" }).click();
    await page.getByRole("option", { name: /^Separations/ }).click();
    await expect(dialog.getByRole("spinbutton", { name: "Workers" })).toHaveValue("1");
    await dialog.getByRole("button", { name: /^Add \d+ workers?$/ }).click();
    await expect(adding).toBeVisible();
    await expect(progress).toHaveText("Starting a worker for Separations.");
    await expect(add).toBeDisabled();
    await expect(worker).toBeHidden();
  }

  try {
    await startAdd();
    reply?.resolve(false);
    await expect(failedAdd).toBeVisible();
    await expect(failedAdd).toHaveCount(1);
    await expect(adding).toBeHidden();
    await expect(add).toBeEnabled();
    await expect(worker).toBeHidden();

    await startAdd();
    reply?.resolve(true);
    await expect(worker).toBeVisible();
    await expect(success).toBeVisible();
    await expect(adding).toBeHidden();
    await publishWorkers();

    reply = Promise.withResolvers<boolean>();
    await remove.click();
    await expect(remove).toBeDisabled();
    await expect(worker).toContainText("Removing");
    await expect(worker.getByRole("status")).toHaveCount(0);
    await expect(progress).toHaveText("Removing Worker 99, Separations.");
    reply.resolve(false);
    await expect(failedRemove).toBeVisible();
    await expect(failedRemove).toHaveCount(1);
    await expect(worker).toContainText("Idle");
    await expect(progress).toBeEmpty();
    await expect(remove).toBeEnabled();

    reply = Promise.withResolvers<boolean>();
    await remove.click();
    await expect(worker).toContainText("Removing");
    await expect(worker.getByRole("status")).toHaveCount(0);
    await expect(progress).toHaveText("Removing Worker 99, Separations.");
    reply.resolve(true);
    await expect(worker).toBeHidden();
    await publishWorkers();

    await startAdd();
    const late = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/commands"
      && CommandRequestSchema.parse(response.request().postDataJSON()).family === "worker-browser");
    await dashboard.openWorkflow("Separations");
    await expect(adding).toBeHidden();
    await expect(failedAdd).toBeHidden();
    await expect(add).toBeEnabled();
    reply?.resolve(false);
    await late;
    await dashboard.settleReads();
    await expect(failedAdd).toBeHidden();
    await expect(worker).toBeHidden();
    await expect(page.getByText(/outcome uncertain/i)).toBeHidden();
  } finally {
    reply?.resolve(false);
  }
});
