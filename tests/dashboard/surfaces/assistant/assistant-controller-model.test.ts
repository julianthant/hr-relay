import { AssistantReplyPartsSchema, ASSISTANT_MODEL_COMMAND, ASSISTANT_DEFAULT_MODEL, ASSISTANT_DEFAULT_EFFORT, AssistantModelPreferenceViewSchema, type AssistantModelPreferenceView, type AssistantM1Request, type AssistantM1RespondEnvelope, AssistantSessionViewSchema } from '../../../../src/models/dashboard/assistant.js';
import { CommandExecutor, type CommandExecutionScope, type CommandOutcome } from '../../../../src/dashboard/app/commands/command-executor.js';
import { AssistantModelPreferenceCommandRequestSchema, CommandResultSchema, type CommandResult } from '../../../../src/rules/commands/commands.js';
import { LOCAL_OPERATOR_ACTOR_ID } from '../../../../src/rules/identity/ids.js';
import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { createAssistantController } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { assistantModelLabel } from '../../../../src/models/config/assistant-model-preference.js';
import { resultClient, scriptedEnvelope, type ScriptedReply } from '../../../support/helpers/dashboard/assistant-served-client.js';
import type { AssistantState, AssistantMessage } from '../../../../src/dashboard/surfaces/assistant/assistant-model.js';
import { createAssistantHistory } from '../../../../src/dashboard/surfaces/assistant/assistant-history-model.js';
import { assistantHistoryServer } from '../../../support/helpers/dashboard/assistant-history-server.js';


function pending() {
  let settle: (result: ScriptedReply) => void = () => { throw new Error('pending-uninitialized'); };
  const promise = new Promise<ScriptedReply>(resolve => { settle = resolve; });
  return { promise, settle };
}

it('keeps monotonic identity across New Chat and ignores late replies after cancellation, edits and authority changes', async () => {
  for (const action of ['new-chat', 'cancel', 'edit', 'binding'] as const) {
    const reply = pending(); let signal: AbortSignal | undefined;
    const c = createAssistantController(resultClient({ assistantRespond: async (_request, abort) => { signal = abort; return reply.promise; } }), { authority: 'a', subjectRef: 'one' });
    c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
    if (action === 'binding') c.bind({ authority: 'b', subjectRef: 'two' });
    else c.action(action === 'edit' ? { type: 'edit', value: 'Changed' } : { type: action });
    assert.equal(signal?.aborted, true);
    if (action !== 'new-chat') {
      assert.equal(c.snapshot().turn.state, 'unknown');
      const sequence = c.snapshot().sequence; c.action({ type: 'retry' }); c.action({ type: 'send' }); assert.equal(c.snapshot().sequence, sequence);
    }
    reply.settle({ state: 'answered', text: 'Late' }); await reply.promise; await Promise.resolve();
    assert.equal(c.snapshot().messages.some(message => message.text === 'Late'), false);
    assert.equal(c.snapshot().sequence, 1);
    if (action === 'new-chat') assert.deepEqual(c.snapshot().messages, []);
    c.action({ type: 'new-chat' }); c.action({ type: 'edit', value: 'Next' }); c.action({ type: 'send' }); assert.equal(c.snapshot().sequence, 2);
    c.abort();
  }
});
it('settles a served reply as its parts and a refusal as its catalog line', async () => {
  const replies: ScriptedReply[] = [{ state: 'answered', text: 'Explanation' }, { state: 'no-reply', reason: 'ASSISTANT_RESPONSE_REFUSED' }];
  const c = createAssistantController(resultClient({ async assistantRespond() { const reply = replies.shift(); assert.ok(reply); return reply; } }), { authority: 'a' });
  c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'idle'));
  assert.equal(c.snapshot().messages.at(-1)?.text, 'Explanation');
  assert.deepEqual(c.snapshot().messages.at(-1)?.parts, [{ kind: 'text', runs: [{ kind: 'plain', text: 'Explanation' }] }]);
  c.action({ type: 'edit', value: 'yes' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().messages.at(-1)?.code, 'ASSISTANT_RESPONSE_REFUSED'));
  assert.equal(c.snapshot().messages.at(-1)?.parts, undefined);
});
it('fails a lost chat reply retryably, resends only the kept prompt and never lets an edited draft retry it', async () => {
  let calls = 0;
  const c = createAssistantController(resultClient({ async assistantRespond() { calls++; throw new Error('private transport reason'); } }), { authority: 'a' });
  c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'failed'));
  assert.equal(calls, 1); assert.equal(c.snapshot().sequence, 1);
  c.action({ type: 'retry' });
  await vi.waitFor(() => assert.equal(calls, 2));
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'failed'));
  assert.equal(c.snapshot().sequence, 2);
  c.action({ type: 'edit', value: 'Changed' }); c.action({ type: 'retry' }); assert.equal(calls, 2); assert.equal(c.snapshot().sequence, 2);
  assert.equal(JSON.stringify(c.snapshot()).includes('private transport'), false);
  assert.equal(JSON.stringify(c.snapshot()).includes('actionId'), false);
});

function preferenceControls() {
  let view = AssistantModelPreferenceViewSchema.parse({ profileId: crypto.randomUUID(), epoch: 2, revision: 3,
    preference: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT } });
  const sent: unknown[] = [], replies: AssistantM1Request[] = [], signals: (AbortSignal | undefined)[] = [], feedback: CommandOutcome[] = [];
  let reads = 0, lostResponse = false, gate: Promise<void> | undefined, answer = 'Done';
  let reader: (signal?: AbortSignal) => Promise<AssistantModelPreferenceView> = async () => view;
  const client = {
    async assistantRespond(input: AssistantM1Request): Promise<AssistantM1RespondEnvelope> { replies.push(input); return scriptedEnvelope(input, { state: 'answered', text: answer }); },
    async assistantModelPreference(signal?: AbortSignal) { reads++; signals.push(signal); return reader(signal); },
    async executeCommand(input: unknown): Promise<CommandResult> {
      const command = AssistantModelPreferenceCommandRequestSchema.parse(input); sent.push(command);
      await gate;
      view = AssistantModelPreferenceViewSchema.parse({ ...view, revision: command.target.expectedRevision + 1, preference: command.payload });
      if (lostResponse) throw new Error('lost-after-commit');
      return CommandResultSchema.parse({ state: 'applied', commandId: command.commandId,
        affectedTargets: [{ family: "assistant-model-preference", profileId: command.target.profileId, revision: view.revision }] });
    },
    async executeBulkCommand(): Promise<never> { throw new Error('unexpected-bulk'); },
  };
  const scope: CommandExecutionScope = { actorId: LOCAL_OPERATOR_ACTOR_ID, client, authority: {}, dayRequest: {} };
  let currentScope = scope;
  const executor = new CommandExecutor(() => currentScope);
  const commands = { executor, scope, feedback: (value: CommandOutcome) => { feedback.push(value); } };
  const binding = { authority: 'selected', subjectRef: 'fixture-subject', commands };
  const c = createAssistantController(client, binding);
  return { c, binding, commands, executor, sent, replies, signals, feedback, scope,
    get view() { return view; }, get reads() { return reads; },
    setReader(value: typeof reader) { reader = value; }, setGate(value: Promise<void>) { gate = value; },
    loseResponse() { lostResponse = true; }, changeScope() { currentScope = { ...scope, authority: {} }; },
    answer(value: string) { answer = value; },
  };
}
function sendControl(c: ReturnType<typeof createAssistantController>, text: string) {
  c.action({ type: "edit", value: text }); c.action({ type: "send" });
}
it('shows the served preference and dispatches the explicit choice through the shared executor', async () => {
  const f = preferenceControls(), initial = f.view;
  sendControl(f.c, ASSISTANT_MODEL_COMMAND);
  await vi.waitFor(() => assert.notEqual(f.c.snapshot().turn.state, "waiting"));
  assert.ok(f.c.snapshot().messages.at(-1)?.text.includes(assistantModelLabel(initial.preference.slug)));
  assert.equal(f.sent.length, 0); assert.equal(f.replies.length, 0);
  sendControl(f.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  await vi.waitFor(() => assert.equal(f.feedback.length, 1));
  const command = AssistantModelPreferenceCommandRequestSchema.parse(f.sent[0]);
  assert.deepEqual(command.target, { profileId: initial.profileId, epoch: initial.epoch, expectedRevision: initial.revision });
  assert.deepEqual(command.payload, { slug: 'fixture-selected', effort: ASSISTANT_DEFAULT_EFFORT });
  assert.equal(command.requestedBy, LOCAL_OPERATOR_ACTOR_ID); assert.equal(command.source, 'dashboard-assistant-model-preference');
  assert.equal(f.feedback[0]?.kind, "confirmed"); assert.equal(f.reads, 3);
  assert.ok(f.c.snapshot().messages.at(-1)?.text.includes(assistantModelLabel(f.view.preference.slug)));
  assert.equal(f.executor.retainedAttempts()[0]?.scope.client, f.scope.client);
});
it('saves a picker choice through the shared executor without a chat turn', async () => {
  const f = preferenceControls(), initial = f.view;
  await f.c.choose({ slug: initial.preference.slug, effort: 'max' });
  const command = AssistantModelPreferenceCommandRequestSchema.parse(f.sent[0]);
  assert.deepEqual(command.target, { profileId: initial.profileId, epoch: initial.epoch, expectedRevision: initial.revision });
  assert.deepEqual(command.payload, { slug: initial.preference.slug, effort: 'max' });
  assert.equal(f.feedback[0]?.kind, "confirmed"); assert.equal(f.view.preference.effort, 'max');
  assert.deepEqual(f.c.snapshot().messages, []); assert.equal(f.replies.length, 0);
});
it('rejects malformed setup arguments without an inference call or command', async () => {
  for (const text of [ASSISTANT_MODEL_COMMAND + ' fixture-selected', ASSISTANT_MODEL_COMMAND + ' fixture-selected unsupported', ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT + ' extra']) {
    const f = preferenceControls(); sendControl(f.c, text);
    await vi.waitFor(() => assert.notEqual(f.c.snapshot().turn.state, "waiting"));
    assert.equal(f.reads, 0); assert.equal(f.sent.length, 0); assert.equal(f.replies.length, 0);
  }
});
it('keeps an after-dispatch loss unknown without automatic retry or invented success', async () => {
  const f = preferenceControls(); f.loseResponse();
  sendControl(f.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  await vi.waitFor(() => assert.equal(f.c.snapshot().turn.state, "unknown"));
  assert.equal(f.sent.length, 1); assert.equal(f.view.preference.slug, 'fixture-selected');
  assert.equal(f.executor.retainedAttempts()[0]?.outcome?.kind, "uncertain");
  f.c.action({ type: "retry" }); await Promise.resolve();
  assert.equal(f.sent.length, 1); assert.equal(f.reads, 1);
});
it('discards a superseded preference read before any command and rejects a foreign readback', async () => {
  const f = preferenceControls(), held = Promise.withResolvers<AssistantModelPreferenceView>();
  f.setReader(() => held.promise);
  sendControl(f.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  assert.equal(f.reads, 1); f.c.bind({ authority: 'next', commands: f.commands });
  held.resolve(f.view); await held.promise; await Promise.resolve();
  assert.equal(f.sent.length, 0); assert.equal(f.signals[0]?.aborted, true);
  const foreign = preferenceControls();
  foreign.setReader(async () => foreign.reads === 1 ? foreign.view : { ...foreign.view, profileId: crypto.randomUUID() });
  sendControl(foreign.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  await vi.waitFor(() => assert.equal(foreign.c.snapshot().turn.state, "unknown"));
  assert.equal(foreign.sent.length, 1); assert.equal(foreign.feedback[0]?.kind, "uncertain");
});
it('retains a command whose scope changes after dispatch and never runs returned model text as an operator command', async () => {
  const f = preferenceControls(), held = Promise.withResolvers<void>(); f.setGate(held.promise);
  sendControl(f.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  await vi.waitFor(() => assert.equal(f.sent.length, 1)); f.changeScope(); f.c.bind({ authority: 'next', commands: f.commands });
  held.resolve(); await vi.waitFor(() => assert.equal(f.executor.retainedAttempts()[0]?.outcome?.kind, "uncertain"));
  assert.equal(f.c.snapshot().messages.some(message => message.text.includes('Assistant model:')), false);
  const model = preferenceControls(); model.answer(ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  sendControl(model.c, 'ordinary request'); await vi.waitFor(() => assert.notEqual(model.c.snapshot().turn.state, "waiting"));
  assert.equal(model.replies.length, 1); assert.equal(model.reads, 0); assert.equal(model.sent.length, 0);
});

it('preserves an in-flight read when only the outer command binding container changes', async () => {
  const f = preferenceControls(), held = Promise.withResolvers<AssistantModelPreferenceView>();
  f.setReader(() => held.promise);
  sendControl(f.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  f.c.bind({ ...f.binding, commands: { ...f.commands } });
  assert.equal(f.signals[0]?.aborted, false);
  f.setReader(async () => f.view); held.resolve(f.view);
  await vi.waitFor(() => assert.equal(f.feedback.length, 1));
  assert.equal(f.sent.length, 1); assert.equal(f.feedback[0]?.kind, "confirmed");
});

it('does not infer or choose a local default when the preference query is not wired', async () => {
  let inferences = 0;
  const c = createAssistantController(resultClient({ async assistantRespond(): Promise<ScriptedReply> { inferences++; return { state: 'answered', text: 'Unexpected' }; } }), { authority: 'selected' });
  sendControl(c, ASSISTANT_MODEL_COMMAND);
  await vi.waitFor(() => assert.notEqual(c.snapshot().turn.state, "waiting"));
  assert.equal(inferences, 0); assert.equal(c.snapshot().messages.length, 2);
});
it('retries a lost reply under the same message id whether its history read throws or finds nothing, so an accepted turn is replayed, never run twice', async () => {
  for (const outcome of [async () => { throw new Error('history offline'); }, async () => undefined]) {
    const ids: string[] = [];
    const client = resultClient({ async assistantRespond(input): Promise<ScriptedReply> {
      ids.push(input.messageId); if (ids.length === 1) throw new Error('connection dropped'); return { state: 'answered', text: 'Replayed' }; } });
    let kept: AssistantState | undefined;
    const c = createAssistantController(client, { authority: 'a' }, { conversationId: crypto.randomUUID(), read: () => kept,
      retain: state => { kept = state; }, revision: () => 1, receipt() {}, async local() {}, async refresh() {}, outcome, unsaved() {} });
    sendControl(c, 'start a lookup for Avery');
    await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'failed'));
    c.action({ type: 'retry' });
    await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'idle'));
    assert.equal(ids.length, 2); assert.equal(ids[1], ids[0]);
    sendControl(c, 'another question');
    await vi.waitFor(() => assert.equal(ids.length, 3)); assert.notEqual(ids[2], ids[0]);
  }
});
const RUN_ID = '00000000-0000-4000-8000-000000000004';
function sessionView(rowRevision: number, stoppable: boolean) {
  return AssistantSessionViewSchema.parse({ runId: RUN_ID, label: 'Sample, Avery', meta: 'Running', rowRevision, state: stoppable ? 'running' : 'cancelled',
    stop: stoppable ? { runId: RUN_ID, descriptor: { kind: 'command', key: 'cancel', command: 'cancel', label: 'Cancel', intent: 'neutral', placement: ['footer'], expectedVersion: rowRevision } } : null });
}
it('re-reads session chips after a session reply, and Stop sends the run\'s Cancel once and proves it by re-reading the chip', async () => {
  let refreshes = 0, served = sessionView(3, true);
  const sent: unknown[] = [], feedback: CommandOutcome[] = [];
  const client = resultClient({
    async assistantRespond(): Promise<ScriptedReply> { return { state: 'answered', parts: [{ kind: 'session', runId: RUN_ID, label: 'Sample, Avery', meta: 'Running' }] }; },
    async executeCommand(input: unknown): Promise<CommandResult> {
      sent.push(input); served = sessionView(4, false);
      return CommandResultSchema.parse({ state: 'applied', commandId: (input as { commandId: string }).commandId, affectedTargets: [{ family: 'run', runId: RUN_ID }] });
    },
    async executeBulkCommand(): Promise<never> { throw new Error('unexpected-bulk'); },
  });
  const scope: CommandExecutionScope = { actorId: LOCAL_OPERATOR_ACTOR_ID, client, authority: {}, dayRequest: {} };
  const commands = { executor: new CommandExecutor(() => scope), scope, feedback: (value: CommandOutcome) => { feedback.push(value); } };
  let kept: AssistantState | undefined;
  const c = createAssistantController(client, { authority: 'a', commands }, { conversationId: crypto.randomUUID(), read: () => kept && { ...kept, sessions: [served] },
    retain: state => { kept = state; }, revision: () => 1, receipt() {}, async local() {}, async refresh() { refreshes++; }, async outcome() { return undefined; }, unsaved() {} });
  sendControl(c, 'look up Avery');
  await vi.waitFor(() => assert.equal(c.snapshot().sessions?.[0]?.rowRevision, 3));
  assert.equal(refreshes, 1);
  const stop = c.snapshot().sessions?.[0]?.stop; assert.ok(stop);
  await c.stop(stop);
  assert.equal(sent.length, 1); assert.equal((sent[0] as { type: string }).type, 'cancel');
  assert.equal(feedback.at(-1)?.kind, 'confirmed'); assert.equal(refreshes, 3);
  assert.equal(c.snapshot().sessions?.[0]?.stop, null);
});
it('a same-id Retry answered by a delivery receipt restores the started session with its Stop, and the session starts once', async () => {
  const ids: string[] = [], session = { kind: 'session' as const, runId: RUN_ID, label: 'Sample, Avery', meta: 'Running' };
  let starts = 0, stored = false;
  const client = { ...resultClient({ async assistantRespond(): Promise<ScriptedReply> { throw new Error('replaced below'); } }), async assistantRespond(input: AssistantM1Request): Promise<AssistantM1RespondEnvelope> {
    ids.push(input.messageId);
    // The server starts once per accepted message id; the resend replays the stored turn as a delivery receipt.
    if (!stored) { stored = true; starts++; throw new Error('connection dropped after the session started'); }
    const answered = scriptedEnvelope(input, { state: 'answered', parts: [session] });
    assert.ok(answered.kind === 'result' && answered.result.state === 'answered' && answered.receipt !== undefined);
    return { kind: 'delivery', receipt: answered.receipt, acceptedTurn: answered.result.reply.acceptedTurn, usage: answered.result.reply.usage, history: { state: 'observed' } };
  } };
  let kept: AssistantState | undefined, reads = 0;
  const c = createAssistantController(client, { authority: 'a' }, { conversationId: crypto.randomUUID(), read: () => kept && { ...kept, sessions: [sessionView(3, true)] },
    retain: state => { kept = state; }, revision: () => 1, receipt() {}, async local() {}, async refresh() {}, unsaved() {},
    // The first read-back fails; after the resend the stored reply carries the session.
    async outcome(): Promise<AssistantMessage | undefined> { reads++; if (reads === 1) throw new Error('history offline'); return { id: 'stored', role: 'assistant', text: '', parts: AssistantReplyPartsSchema.parse([session]) }; } });
  sendControl(c, 'start a lookup for Avery');
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'failed'));
  assert.equal(c.snapshot().sessions?.length ?? 0, 0);
  c.action({ type: 'retry' });
  await vi.waitFor(() => assert.ok(c.snapshot().sessions?.[0]?.stop));
  assert.equal(c.snapshot().turn.state, 'idle');
  assert.deepEqual(ids, [ids[0], ids[0]]); assert.equal(starts, 1);
});
it('Stop re-reads the chip first and sends the run\'s current Cancel when the run moved from queued to running', async () => {
  let served = sessionView(3, true);
  const sent: unknown[] = [];
  const client = resultClient({
    async assistantRespond(): Promise<ScriptedReply> { return { state: 'answered', parts: [{ kind: 'session', runId: RUN_ID, label: 'Sample, Avery', meta: 'Running' }] }; },
    async executeCommand(input: unknown): Promise<CommandResult> {
      sent.push(input); served = sessionView(6, false);
      return CommandResultSchema.parse({ state: 'applied', commandId: (input as { commandId: string }).commandId, affectedTargets: [{ family: 'run', runId: RUN_ID }] });
    },
    async executeBulkCommand(): Promise<never> { throw new Error('unexpected-bulk'); },
  });
  const scope: CommandExecutionScope = { actorId: LOCAL_OPERATOR_ACTOR_ID, client, authority: {}, dayRequest: {} };
  const commands = { executor: new CommandExecutor(() => scope), scope, feedback() {} };
  let kept: AssistantState | undefined;
  const c = createAssistantController(client, { authority: 'a', commands }, { conversationId: crypto.randomUUID(), read: () => kept && { ...kept, sessions: [served] },
    retain: state => { kept = state; }, revision: () => 1, receipt() {}, async local() {}, async refresh() {}, async outcome() { return undefined; }, unsaved() {} });
  sendControl(c, 'look up Avery');
  await vi.waitFor(() => assert.equal(c.snapshot().sessions?.[0]?.rowRevision, 3));
  const stale = c.snapshot().sessions?.[0]?.stop; assert.ok(stale);
  served = sessionView(5, true);
  await c.stop(stale);
  assert.equal(sent.length, 1); assert.equal((sent[0] as { target: { expectedVersion: number } }).target.expectedVersion, 5);
  assert.equal(c.snapshot().sessions?.[0]?.stop, null);
});

it('stores a setup reply before publishing it, so the first automatic rename of a New chat uses the current revision', async () => {
  const server = assistantHistoryServer();
  try {
    const store = await createAssistantHistory(server.client, { getItem: () => null, removeItem() {} }, server.profileId, new AbortController().signal);
    const [chat] = store.chats.read(); assert.ok(chat); assert.equal(chat.title, 'New chat');
    const view = AssistantModelPreferenceViewSchema.parse({ profileId: server.profileId, epoch: 1, revision: 0, preference: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT } });
    const client = resultClient({ async assistantRespond(): Promise<ScriptedReply> { throw new Error('setup commands send nothing to the model'); } });
    const c = createAssistantController({ ...client, ...server.client, async assistantModelPreference() { return view; } }, { authority: 'selected' }, {
      conversationId: chat.id, read: () => store.read(chat.id), retain: state => { store.retain(chat.id, state); }, revision: () => store.revision(chat.id),
      receipt: receipt => { store.receipt(receipt); }, local: text => store.local(chat.id, text), outcome: id => store.outcome(chat.id, id),
      refresh: () => store.refresh(chat.id), unsaved: () => { store.unsaved(); } });
    // The panel renames as soon as the first reply is published; do the same here.
    let rename: Promise<void> | undefined;
    c.subscribe(() => { if (rename === undefined && c.snapshot().messages.some(message => message.role === 'assistant')) rename = store.chats.rename(chat.id, ASSISTANT_MODEL_COMMAND); });
    c.action({ type: 'edit', value: ASSISTANT_MODEL_COMMAND }); c.action({ type: 'send' });
    await vi.waitFor(() => assert.ok(rename));
    await rename;
    assert.equal(store.chats.read().find(row => row.id === chat.id)?.title, ASSISTANT_MODEL_COMMAND);
    assert.equal(store.notice(), '');
  } finally { server.close(); }
});
