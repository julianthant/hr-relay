import { admitWorkerPoolRoster } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { workerPoolMember } from "../../../../src/models/run/worker-slot.js";
import { randomUUID } from "node:crypto";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { NOW } from "../../fixtures/phase1c-contract-fixtures.js";
import { WORKFLOW_ID } from "../../fixtures/phase1f-run-fixtures.js";
import { openAuthorityHarness } from "../phase1f-executor-harness.js";



export function createPoolRuntimeTestWorld() {
  const disposers: (() => void | Promise<void>)[] = [];

  function workerBrowserCommand(request: unknown) {
    const parsed = CommandRequestSchema.parse(request);
    if (parsed.family !== "worker-browser") throw new Error("fixture must be a worker-browser command");
    return parsed;
  }

  async function admittedAdapterRoster(workflowId = WORKFLOW_ID) {
    const authority = await openAuthorityHarness();
    disposers.push(authority.dispose);
    const command = workerBrowserCommand({ commandId: randomUUID(), requestedBy: "local-operator", requestedAt: NOW,
      source: "dashboard", family: "worker-browser", type: "plan-worker-count",
      target: { workflowId, expectedVersion: 0 }, payload: { desiredWorkers: 3 } });
    if (command.type !== "plan-worker-count") throw new Error("fixture roster command required");
    const roster = authority.database.withAuthorityTransaction(repositories => {
      repositories.commands.insert(command);
      return admitWorkerPoolRoster(repositories, command, NOW);
    });
    return { authority, roster, members: roster.selected.map(workerPoolMember) };
  }

  function admitAdapterPlan(native: Awaited<ReturnType<typeof admittedAdapterRoster>>, command: ReturnType<typeof workerBrowserCommand>) {
    if (command.type !== "plan-worker-count") throw new Error("fixture plan command required");
    return native.authority.database.withAuthorityTransaction(repositories => {
      repositories.commands.insert(command);
      return admitWorkerPoolRoster(repositories, command, NOW);
    });
  }

  const OBSERVED_GRACEFUL = [{ stage: "graceful-stop-requested", at: NOW }] as const;

  const STOP_ESCALATION = [
    { stage: "graceful-stop-requested", timeoutMs: 120_000 },
    { stage: "sigterm-sent", timeoutMs: 30_000 },
    { stage: "sigkill-sent" },
  ] as const;
  const cleanup = async () => {
    for (const dispose of disposers.splice(0)) await dispose();
  };
  return { disposers, workerBrowserCommand, admittedAdapterRoster, admitAdapterPlan, OBSERVED_GRACEFUL, STOP_ESCALATION, cleanup };
}
