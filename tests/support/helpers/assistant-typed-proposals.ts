import { randomUUID } from "node:crypto";
import { createAssistantTypedProposals, type AssistantTypedProposalPorts, type AssistantTypedProposals } from "../../../src/backend/assistant/typed-proposals.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import type { StartPlanWire } from "../../../src/models/dashboard/start-plan.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { CommandResultSchema, type CommandRequest } from "../../../src/rules/commands/commands.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import type { assistantM1HistoryFixture } from "./assistant-m1-history-fixture.js";
import { personLookupQueuedRun } from "./phase1f-executor-harness.js";

const hex = (digit: string) => digit.repeat(64);

/** The real typed-proposal owner over the real M2 store and fake plan/submit/run ports; `submit` runs the effect hook before its effect, like the command kernel. */
export function typedProposalFixture(storage: ReturnType<typeof assistantM1HistoryFixture>, at: string) {
  const inputs = new Map<string, { input: unknown; rawInput: unknown }[]>(), runs = new Map<string, unknown>(), submitted: { command: CommandRequest; attribution: unknown }[] = [];
  const knobs: { inputFingerprint: string; submit?: (command: CommandRequest) => unknown } = { inputFingerprint: hex("e") };
  let plans = 0;
  const run = () => { const runId = randomUUID(); runs.set(runId, personLookupQueuedRun({ runId, itemId: randomUUID() })); return RunRecordSchema.parse(runs.get(runId)); };
  const ports: AssistantTypedProposalPorts = { store: storage.proposals(), descriptors: { resolve: id => DESCRIPTORS.find(descriptor => descriptor.id === id) }, served: () => true,
    plans: { plan(input) {
      const request = input as { workflowId: StartPlanWire["workflowId"]; dryRun: boolean; submissions: unknown[]; browserMode: "headless" | "headed"; captureBrowserScreenshots: boolean };
      const startPlanId = randomUUID();
      inputs.set(startPlanId, request.submissions.map(rawInput => ({ input: null, rawInput })));
      return { wireVersion: 1, startPlanId, workflowId: request.workflowId, expectedVersion: 1, expiresAt: at, dryRun: request.dryRun, browserMode: request.browserMode,
        captureBrowserScreenshots: request.captureBrowserScreenshots, priority: "interactive", plannedBy: "local-operator", configSnapshotId: randomUUID(), refused: [],
        fingerprints: { descriptorFingerprint: hex("a"), configFingerprint: hex("b"), ingressSchemaHash: hex("c"), canonicalInputSchemaHash: hex("d"), inputFingerprint: knobs.inputFingerprint },
        planned: request.submissions.map(() => ({ logicalKey: `k${String(++plans)}`, title: `Lookup ${String(plans)}`, matchKey: `m${String(plans)}` })) } as unknown as StartPlanWire;
    } },
    plannedInputs: startPlanId => inputs.get(startPlanId),
    runs: { read: runId => ({ state: "present" as const, run: RunRecordSchema.parse(runs.get(runId)), disposition: "live" as const }) },
    rerunValues: () => { throw new Error("unused"); }, attachment: () => undefined, ocrSources: () => { throw new Error("unused"); },
    async submit(command, attribution) {
      owner.assertEffect(command.commandId, command);
      submitted.push({ command, attribution });
      const scripted = knobs.submit?.(command);
      if (scripted !== undefined) return CommandResultSchema.parse(scripted);
      const runIds = command.family === "start" ? [run().envelope.runId] : command.family === "run" ? [command.target.runId] : [];
      return Promise.resolve(CommandResultSchema.parse({ state: "applied", commandId: command.commandId, affectedTargets: runIds.map(runId => ({ family: "run", runId })) }));
    },
    browserMode: () => "headless", current: () => ({ profileId: storage.profileId(), epoch: storage.epoch() }), clock: manualClock(new Date(at)), actorId: "local-operator" };
  const owner: AssistantTypedProposals = createAssistantTypedProposals(ports);
  return { owner, ports, submitted, knobs, run };
}
