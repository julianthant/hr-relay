import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createChatGptAccountService } from "../../../src/backend/accounts/chatgpt-account-service.js";
import { AssistantToolRefusal, referenceSchema, type AssistantReadTool } from "../../../src/backend/assistant/plugins/plugin.js";
import { ASSISTANT_TOOL_NAMESPACE } from "../../../src/backend/assistant/plugins/registry.js";
import { assistantWorkflowFacts } from "../../../src/backend/assistant/plugins/workflows/facts.js";
import { composeAssistant } from "../../../src/backend/app/composition/dashboard/assistant.js";
import { CommandResultSchema, type CommandRequest } from "../../../src/rules/commands/commands.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { createChatGptCredentialRepository } from "../../../src/backend/storage/configuration/chatgpt-credential-repository.js";
import { AssistantInferenceRequestSchema, AssistantM1RespondEnvelopeSchema, type AssistantM1Request, type AssistantM1RespondEnvelope, type AssistantSessionClaim, type AssistantSessionOutcome } from "../../../src/models/dashboard/assistant.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../src/models/config/settings.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import type { JsonValue } from "../../../src/rules/validation/canonical-json.js";
import { createBoundProfileFixture } from "./admission-fixture.js";
import { createSettingsAuthorityTestWorld } from "./backend/settings-authority-world.js";
import { assistantM1HistoryFixture } from "./assistant-m1-history-fixture.js";
import { typedProposalFixture } from "./assistant-typed-proposals.js";
import { completedResponseStream, partialTextStream } from "./chatgpt-response-stream.js";
import { EXECUTOR_EID, personLookupQueuedRun } from "./phase1f-executor-harness.js";

const MODEL = "gpt-6.1-sol";
const DAY = "2026-10-12";
export const SCENARIO_PERSON = { eid: EXECUTOR_EID, name: "Synthetic Scenario Person" } as const;

const ProviderBody = AssistantInferenceRequestSchema.safeExtend({
  store: z.literal(false), stream: z.literal(true), parallel_tool_calls: z.literal(false), include: z.tuple([z.literal("reasoning.encrypted_content")]),
});
type ProviderBody = z.infer<typeof ProviderBody>;
type ProviderStep = string | { readonly tool: string; readonly args: JsonValue } | null;
type Budget = Readonly<{ largestRequest: number; total: number }>;
type Measurement = Budget & { readonly contributors: readonly Readonly<{ label: string; tokens: number }>[] };

interface TurnObservation {
  readonly envelope: AssistantM1RespondEnvelope;
  readonly requests: readonly ProviderBody[];
  readonly proposalStarts: number;
  readonly sessionStarts: number;
  readonly sessionClaim: Readonly<{ claim: AssistantSessionClaim; outcome: AssistantSessionOutcome }> | undefined;
}

export interface AssistantScenario {
  readonly name: string;
  readonly budget: Budget;
  readonly turns: readonly Readonly<{
    message: string;
    provider: readonly ProviderStep[];
    changePlan?: boolean;
    approvalMode?: AssistantM1Request["approvalMode"];
    fullAccess?: boolean;
    revokeAtEffect?: boolean;
    check(observation: TurnObservation): void;
  }>[];
}

function providerStream(step: ProviderStep, requestNumber: number): string {
  if (step === null) return partialTextStream("Incomplete synthetic reply");
  const item = typeof step === "string"
    ? { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: step }] }
    : { type: "function_call", namespace: ASSISTANT_TOOL_NAMESPACE, name: step.tool, arguments: JSON.stringify(step.args), call_id: `call-${requestNumber}`, status: "completed" };
  return completedResponseStream([item], MODEL, `response-${requestNumber}`, { input_tokens: 4, output_tokens: 2, total_tokens: 6 });
}

const tokens = (bytes: number): number => Math.ceil(bytes / 4);

function measure(requests: readonly { raw: string; body: ProviderBody }[]): Measurement {
  let largestRequest = 0, total = 0;
  const bytesByContributor = new Map<string, number>();
  const add = (label: string, component: unknown) => {
    bytesByContributor.set(label, (bytesByContributor.get(label) ?? 0) + Buffer.byteLength(JSON.stringify(component), "utf8"));
  };
  for (const { raw, body } of requests) {
    const requestTokens = tokens(Buffer.byteLength(raw, "utf8"));
    largestRequest = Math.max(largestRequest, requestTokens);
    total += requestTokens;
    for (const toolNamespace of body.tools) add("tool namespace", toolNamespace);
    for (const item of body.input) {
      if (!("type" in item) && item.role === "developer") add("fixed prompt", item);
      if ("type" in item && item.type === "function_call_output") add(`tool result ${item.namespace}.${item.name} (${item.call_id})`, item);
    }
  }
  const contributors = [...bytesByContributor].sort(([, left], [, right]) => right - left).slice(0, 3)
    .map(([label, bytes]) => ({ label, tokens: tokens(bytes) }));
  return { largestRequest, total, contributors };
}

export function assertScenarioBudget(name: string, budget: Budget, measured: Measurement): void {
  const exceeded = (["largestRequest", "total"] as const).filter(limit => measured[limit] > budget[limit]);
  if (exceeded.length === 0) return;
  const contributors = measured.contributors.map(({ label, tokens: count }) => `${label} (${count})`).join(", ");
  throw new Error(`${name} exceeded ${exceeded.join(" and ")}: largest request ${measured.largestRequest} (budget ${budget.largestRequest}), `
    + `scenario total ${measured.total} (budget ${budget.total}). Largest contributors in estimated tokens: ${contributors}`);
}

export async function runAssistantScenario(scenario: AssistantScenario): Promise<Measurement> {
  const profile = await createBoundProfileFixture();
  const world = createSettingsAuthorityTestWorld();
  try {
    const clock = manualClock(new Date(`${DAY}T12:00:00.000Z`)), at = clock.now().toISOString();
    const { admission, stateRoot } = profile;
    const credentials = createChatGptCredentialRepository({ admission, stateRoot });
    // Seed the test account directly so the scenario never opens an OAuth callback socket.
    await credentials.withLock(async transaction => transaction.replace({
      schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`, clientId: "oaiapp_fixture",
      registration: { subject: "synthetic-subject", name: "Synthetic", email: "synthetic@example.com" },
      session: { accessToken: "fixture-access", refreshToken: null, idToken: "fixture-id", expiresAt: IsoInstantSchema.parse(`${DAY}T13:00:00.000Z`),
        earliestRefreshAt: null, scopes: ["offline_access", "resource.invoke", "chatgpt.tokens.use.direct"], usePlan: true, usage: "available" },
    }, null));

    const requests: { raw: string; body: ProviderBody }[] = [];
    let pending: ProviderStep[] = [], transportError: unknown;
    const account = createChatGptAccountService({ admission, stateRoot, clock, async fetch(url, init) {
      try {
        if (url === "https://api.openai.com/v1/models") {
          return Response.json({ models: [{ slug: MODEL, display_name: "Synthetic", visibility: "list" }] });
        }
        assert.equal(url, "https://api.openai.com/v1/responses", "unexpected synthetic provider URL");
        assert.equal(init?.method, "POST");
        const raw = init?.body;
        assert.ok(typeof raw === "string", "provider request must have a JSON body");
        requests.push({ raw, body: ProviderBody.parse(JSON.parse(raw)) });
        const step = pending.shift();
        assert.ok(step !== undefined, "provider received a request without an answer in the turn script");
        return new Response(providerStream(step, requests.length), { headers: { "content-type": "text/event-stream" } });
      } catch (error) {
        transportError = error;
        throw error;
      }
    } });
    try {
      const store = assistantM1HistoryFixture({ now: at, acceptedAt: at, profileId: admission.profileBinding.profileId });
      try {
        const owner = () => ({ profileId: store.profileId(), epoch: store.epoch() });
        const proposals = typedProposalFixture(store, at), proposalStore = store.proposals();
        const settings = scenario.turns.some(turn => turn.approvalMode === "full-access") ? await world.fixture() : undefined;
        const saveFullAccess = (enabled: boolean) => {
          assert.ok(settings);
          const patch = { "preferences.assistantFullAccess": { set: enabled } };
          assert.equal(settings.execute({ family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: at, requestedBy: "local-operator",
            source: "settings-surface", target: { expectedRevision: settings.database.authority.settingsCurrent.get()?.revision ?? 1 },
            payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }).state, "applied");
        };
        let revokeAtEffect = false;
        const personRun = RunRecordSchema.parse(personLookupQueuedRun({ runId: randomUUID(), itemId: randomUUID() }));
        const personQuery = z.strictObject({ query: z.string().min(1) });
        const readPerson: AssistantReadTool = {
          kind: "read", tier: "read", name: "read_person", description: "Look up the person referenced in the operator's request.",
          parameters: personQuery, output: z.strictObject({ person: referenceSchema("P") }),
          privacy: [{ path: "person", origin: "repository-authored" }],
          async invoke(input, context) {
            const { query } = personQuery.parse(input);
            if (context.references.expandArgument(query, ["E"]) !== SCENARIO_PERSON.eid) throw new AssistantToolRefusal("ASSISTANT_READ_UNAVAILABLE");
            const person = context.references.issue("P", personRun.envelope.runId, SCENARIO_PERSON.name, SCENARIO_PERSON.eid, personRun.version);
            return { person };
          },
        };
        // The Full access scenarios join the assistant fixture to a real Settings command store.
        const authority = { assistantProposals: proposalStore, assistantHistory: store.history,
          startPlans: { get: (id: string) => { const planned = proposals.ports.plannedInputs(id); return planned === undefined ? undefined : { plannedAt: planned.capturedAt, planned: planned.runs }; } },
          settingsCurrent: settings?.database.authority.settingsCurrent, commands: settings?.database.authority.commands, commandAudits: settings?.database.authority.commandAudits,
          runtimeConfig: settings?.database.authority.runtimeConfig ?? { get: () => ({ configSnapshotId: "scenario", configFingerprint: "scenario" }) },
          configSnapshots: settings?.database.authority.configSnapshots ?? { get: () => ({ fingerprint: "scenario", config: { browser: { headless: true } } }) } };
        const starts = { ...proposals.ports, submit(command: CommandRequest, attribution: unknown) {
          if (revokeAtEffect) saveFullAccess(false);
          composed.assertEffect(command.commandId, command);
          proposals.submitted.push({ command, attribution });
          const dryRun = proposalStore.sessions.byCommand(command.commandId)?.claim.dryRun;
          const runIds = command.family === "start" ? [proposals.run(dryRun).envelope.runId] : command.family === "run" ? [command.target.runId] : [];
          return Promise.resolve(CommandResultSchema.parse({ state: "applied", commandId: command.commandId, affectedTargets: runIds.map(runId => ({ family: "run", runId })) }));
        } };
        const composed = composeAssistant({ database: { authority, withAuthorityReadSnapshot: (work: () => unknown) => work(), withAuthorityTransaction: (work: (repositories: unknown) => unknown) => work(authority) } as unknown as Parameters<typeof composeAssistant>[0]["database"], starts,
          readPlugins: () => [{ domain: "people", tools: [readPerson] }],
          service: { account, clock, actorId: "local-operator", owner,
            selectedModel: () => ({ preference: { slug: MODEL, effort: "medium" }, assertCurrent() {} }),
            facts: () => assistantWorkflowFacts(DESCRIPTORS.filter(descriptor => descriptor.id === "person-lookup" || settings !== undefined && descriptor.id === "separations")),
            runReferenceLabel: () => "Lookup", debugEvents: { emit() {} } } });
        const service = composed.assistant;
        const conversationId = randomUUID(), signal = new AbortController().signal;
        assert.equal(service.history({ operation: "create", conversationId, title: scenario.name }).state, "saved");
        const respond = (request: Pick<AssistantM1Request, "expectedRevision" | "messageId" | "message" | "approvalMode">) =>
          service.respond({ ...request, conversationId }, signal);
        const privateValues = new Set<string>([SCENARIO_PERSON.name, SCENARIO_PERSON.eid, personRun.envelope.runId]);

        for (const turn of scenario.turns) {
          const view = service.conversation(conversationId);
          assert.ok(view);
          if (turn.changePlan) proposals.knobs.configFingerprint = "f".repeat(64);
          if (turn.fullAccess !== undefined) saveFullAccess(turn.fullAccess);
          revokeAtEffect = turn.revokeAtEffect ?? false;
          pending = [...turn.provider];
          const firstRequest = requests.length;
          const envelope = AssistantM1RespondEnvelopeSchema.parse(await respond({
            expectedRevision: view.revision, messageId: randomUUID(), message: turn.message, approvalMode: turn.approvalMode,
          }));
          if (transportError !== undefined) throw new Error("Synthetic provider transport failed", { cause: transportError });
          assert.equal(pending.length, 0, `${scenario.name} has unused provider answers for a turn`);
          if (envelope.kind === "result" && envelope.result.state === "answered") {
            for (const part of envelope.result.reply.parts) if (part.kind === "session") privateValues.add(part.runId);
          }
          const sessionCommands = proposals.submitted.filter(({ command }) => proposalStore.sessions.byCommand(command.commandId) !== undefined);
          const lastSession = sessionCommands.at(-1);
          turn.check({ envelope, requests: requests.slice(firstRequest).map(({ body }) => body), proposalStarts: proposals.submitted.length - sessionCommands.length,
            sessionStarts: sessionCommands.length, sessionClaim: lastSession === undefined ? undefined : proposalStore.sessions.byCommand(lastSession.command.commandId) });
        }

        for (const [index, { raw }] of requests.entries()) {
          for (const value of privateValues) assert.equal(raw.includes(value), false, `${scenario.name} request ${index + 1} exposed fixture data`);
        }
        return measure(requests);
      } finally { store.database.close(); }
    } finally { await account.close(); }
  } finally { await world.cleanup(); await profile.close(); }
}
