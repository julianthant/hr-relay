import type { Clock } from "../../rules/time/clock.js";
import type { BrowserSystemId } from "../../rules/identity/ids.js";
import type { ConfirmedTaskActions } from "../../workflow-kit/task.js";
import type { BrowserAction } from "../systems/browser-shared/action-notes.js";
import { withBrowserActionBinding, withBrowserActionNotes } from "../systems/browser-shared/action-notes.js";
import { createDeclaredActionBinder, type DeclaredActionBinderInput } from "../runtime/writes/operation-action-binding.js";
import type { ConfirmedActionPublisher } from "./confirmed-action-publisher.js";
import { createConfirmedTaskActions } from "./confirmed-actions.js";
import { registeredUiEffect, registeredUiSensitivity } from "./semantic-ui-effect.js";

/** The executor's one invocation factory: frozen binding, registered source and early notes share identity. */
export function createConfirmedInvocation(input: Readonly<{
  binding: DeclaredActionBinderInput;
  clock: Clock;
  publisher?: ConfirmedActionPublisher;
  registeredDriverSystem?: BrowserSystemId;
  headlessSystem?: "service" | "workflow";
  traceId: string;
  runSessionId?: string;
}>): Readonly<{
  binder: ReturnType<typeof createDeclaredActionBinder>;
  observingBinder: ReturnType<typeof createDeclaredActionBinder>;
  actions?: ConfirmedTaskActions;
  bind<T>(operation: () => Promise<T>): Promise<T>;
  withNotes<T>(operation: () => Promise<T>, drain: (actions: readonly BrowserAction[]) => void): Promise<T>;
}> {
  if (input.registeredDriverSystem === undefined && input.headlessSystem === undefined) throw new Error("confirmed-invocation-source-missing");
  if (input.registeredDriverSystem !== undefined && input.headlessSystem !== undefined) throw new Error("confirmed-invocation-source-ambiguous");
  const invocation = input.binding.snapshot.invocations.find(candidate => candidate.entryId === input.binding.nodeId
    && candidate.taskId === input.binding.taskId && candidate.contractRole === input.binding.contractRole);
  if (invocation === undefined) throw new Error("confirmed-invocation-frozen-role-missing");
  if (input.registeredDriverSystem === undefined) {
    if (invocation.operation.system !== "local" || invocation.operation.session.kind !== "local") throw new Error("confirmed-invocation-headless-source-mismatch");
  } else if (invocation.operation.system !== input.registeredDriverSystem
    || invocation.operation.session.kind !== "browser"
    || invocation.operation.session.system !== input.registeredDriverSystem) throw new Error("confirmed-invocation-browser-source-mismatch");
  const binder = createDeclaredActionBinder({ ...input.binding,
    allowPublishedValue: (targetId, value) => input.registeredDriverSystem !== undefined
      && registeredUiSensitivity(input.registeredDriverSystem, targetId) === "public"
      && (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"),
  });
  const confirmed = input.publisher === undefined ? undefined : createConfirmedTaskActions({
    publisher: input.publisher, snapshot: input.binding.snapshot, clock: input.clock,
    source: input.registeredDriverSystem === undefined
      ? { kind: "headless", system: input.headlessSystem! }
      : { kind: "browser", system: input.registeredDriverSystem },
    ...(input.runSessionId === undefined ? {} : { runSessionId: input.runSessionId }),
    runId: input.binding.runId, traceId: input.traceId, attempt: input.binding.attempt,
    claimGeneration: input.binding.claimGeneration, taskAttempt: input.binding.taskAttempt,
    nodeId: input.binding.nodeId, taskId: input.binding.taskId, contractRole: input.binding.contractRole,
    effectFor: targetId => input.registeredDriverSystem === undefined ? undefined
      : registeredUiEffect(input.registeredDriverSystem, targetId),
  });
  return {
    binder,
    observingBinder: note => {
      const bound = binder(note);
      confirmed?.observe(bound);
      return bound;
    },
    ...(confirmed === undefined ? {} : { actions: confirmed.actions }),
    bind: operation => withBrowserActionBinding(binder, operation),
    withNotes: (operation, drain) => withBrowserActionNotes(input.clock, operation, drain, confirmed?.observe),
  };
}
