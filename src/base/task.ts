import { z } from "zod";
import type { ContentAddressedArtifactWriter } from "./artifacts.js";
import type { ProviderClientSubset } from "./providers.js";
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  AnyReadTaskContract,
  AnyTaskContract,
} from "../domain/contracts/base.js";
import { assertFactorySealedTaskContract } from "../domain/contracts/base.js";
import { BrowserSystemIdSchema, ServiceSystemIdSchema } from "../domain/ids.js";
import type {
  BrowserSystemId,
  LiteralTaskId,
  ProviderCapabilityId,
  TaskId,
} from "../domain/ids.js";
import { RetryPolicySchema, SessionNeedSchema } from "../domain/session.js";
import type { RetryPolicy, SessionNeed } from "../domain/session.js";
import type { MutationCapability } from "../domain/ui/driver.js";
import { TaskError } from "./errors.js";

export interface TaskLogger {
  readonly debug: (message: string, fields?: Readonly<Record<string, string | number | boolean>>) => void;
  readonly info: (message: string, fields?: Readonly<Record<string, string | number | boolean>>) => void;
  readonly warn: (message: string, fields?: Readonly<Record<string, string | number | boolean>>) => void;
}

export interface TaskCtxCommon<Codes extends readonly string[]> {
  readonly signal: AbortSignal;
  readonly log: TaskLogger;
  readonly fail: (
    code: Codes[number],
    message: string,
    options?: Readonly<{ subject?: string; transient?: boolean; cause?: unknown }>,
  ) => never;
}

export type PureTaskCtx<Codes extends readonly string[]> = TaskCtxCommon<Codes>;

export interface ServiceTaskCtx<
  Codes extends readonly string[],
  Capabilities extends ProviderCapabilityId,
> extends TaskCtxCommon<Codes> {
  readonly providers: ProviderClientSubset<Capabilities>;
}

export interface BrowserTaskCtx<
  Driver extends { readonly system: BrowserSystemId },
  Codes extends readonly string[],
> extends TaskCtxCommon<Codes> {
  readonly driver: Driver;
}

export type ReadTaskCtx<
  Driver extends { readonly system: BrowserSystemId },
  Codes extends readonly string[],
> = BrowserTaskCtx<Driver, Codes>;

export type PrepareTaskCtx<
  Driver extends { readonly system: BrowserSystemId },
  Codes extends readonly string[],
> = BrowserTaskCtx<Driver, Codes>;

export interface CommitTaskCtx<
  Driver extends { readonly system: BrowserSystemId },
  Codes extends readonly string[],
> extends BrowserTaskCtx<Driver, Codes> {
  readonly mutation: MutationCapability;
}

type LiteralValueOfTaskId<Id> = Id extends LiteralTaskId<infer Value> ? Value : Id;
export type NamespaceOf<C extends AnyTaskContract> = LiteralValueOfTaskId<C["id"]> extends
  `${infer Namespace}/${string}` ? Namespace : never;
export type BrowserSystemOf<C extends AnyTaskContract> = Extract<NamespaceOf<C>, BrowserSystemId>;
export type ProviderNeedsOf<C extends AnyTaskContract> =
  C extends { readonly providers: readonly (infer Capability extends ProviderCapabilityId)[] }
    ? Capability
    : never;
type SystemSessionNeed<S extends BrowserSystemId> = Omit<SessionNeed<S>, "exclusive"> &
  (S extends "onbase" ? Readonly<{ exclusive: true }> : Readonly<{ exclusive?: never }>);
type ReadSessionNeed<C extends AnyReadTaskContract> = SystemSessionNeed<BrowserSystemOf<C>> &
  Readonly<{ access: "read" }> &
  (C extends { readonly artifacts: "content-addressed" }
    ? Readonly<{ acceptDownloads?: true }>
    : Readonly<{ acceptDownloads?: never }>);
type TransactionSessionNeed<C extends AnyPrepareTaskContract | AnyCommitTaskContract> =
  SystemSessionNeed<BrowserSystemOf<C>> & Readonly<{
    access: "transaction";
    acceptDownloads?: never;
  }>;
export type SessionsFor<C extends AnyTaskContract> = [BrowserSystemOf<C>] extends [never]
  ? readonly []
  : C extends AnyReadTaskContract
    ? readonly [ReadSessionNeed<C>]
    : C extends AnyPrepareTaskContract | AnyCommitTaskContract
      ? readonly [TransactionSessionNeed<C>]
      : never;

type DriverFor<C extends AnyTaskContract> = Readonly<{ system: BrowserSystemOf<C> }>;
type ReadCtxFor<C extends AnyReadTaskContract> = [BrowserSystemOf<C>] extends [never]
  ? NamespaceOf<C> extends `workflow:${string}`
    ? PureTaskCtx<C["errorCodes"]>
    : ServiceTaskCtx<C["errorCodes"], ProviderNeedsOf<C>>
  : ReadTaskCtx<DriverFor<C>, C["errorCodes"]>;
type ArtifactCtxFor<C extends AnyReadTaskContract> = C extends { readonly artifacts: "content-addressed" }
  ? Readonly<{ artifacts: ContentAddressedArtifactWriter }>
  : Readonly<{ artifacts?: never }>;

export interface ReadTaskImpl<C extends AnyReadTaskContract> {
  readonly sessions: SessionsFor<C>;
  readonly retry?: RetryPolicy;
  readonly run: (args: Readonly<{
    input: z.output<C["input"]>;
    ctx: ReadCtxFor<C> & ArtifactCtxFor<C>;
  }>) => Promise<z.input<C["output"]>>;
}

export interface PrepareTaskImpl<C extends AnyPrepareTaskContract> {
  readonly sessions: SessionsFor<C>;
  readonly retry?: never;
  readonly run: (args: Readonly<{
    input: z.output<C["input"]>;
    ctx: PrepareTaskCtx<DriverFor<C>, C["errorCodes"]>;
  }>) => Promise<z.input<C["output"]>>;
}

export interface CommitTaskImpl<C extends AnyCommitTaskContract> {
  readonly sessions: SessionsFor<C>;
  readonly retry?: never;
  readonly run: (args: Readonly<{
    input: z.output<C["input"]>;
    ctx: CommitTaskCtx<DriverFor<C>, C["errorCodes"]>;
  }>) => Promise<z.input<C["output"]>>;
}

export type ImplFor<C extends AnyTaskContract> =
  C extends AnyReadTaskContract ? ReadTaskImpl<C>
    : C extends AnyPrepareTaskContract ? PrepareTaskImpl<C>
      : C extends AnyCommitTaskContract ? CommitTaskImpl<C>
        : never;

export type Task<C extends AnyTaskContract> = Readonly<{
  contract: C;
  impl: ImplFor<C>;
  __task: true;
}>;
export type AnyTask = Task<AnyTaskContract>;
const FACTORY_DEFINED_TASKS = new WeakSet<object>();

type RuntimeTaskImpl = Readonly<{
  sessions: readonly SessionNeed[];
  retry?: RetryPolicy;
  run: (args: never) => Promise<unknown>;
}>;
const RuntimeTaskRunSchema = z.custom<RuntimeTaskImpl["run"]>(
  (value) => typeof value === "function",
  "task implementation requires run",
);

function namespaceOf(taskIdValue: string): string {
  return taskIdValue.slice(0, taskIdValue.lastIndexOf("/"));
}

function validateTaskBinding(contract: AnyTaskContract, implInput: unknown): RuntimeTaskImpl {
  assertFactorySealedTaskContract(contract);
  if (implInput === null || typeof implInput !== "object") {
    throw new Error(`${contract.id} task implementation must be an object`);
  }
  const run = RuntimeTaskRunSchema.parse(Reflect.get(implInput, "run"));
  const expectedKeys = new Set(["sessions", "run", ...(contract.effect === "read" ? ["retry"] : [])]);
  for (const key of Object.keys(implInput)) {
    if (!expectedKeys.has(key)) throw new Error(`${contract.id} task implementation has unknown field ${key}`);
  }
  const sessionsInput: unknown = Reflect.get(implInput, "sessions");
  if (!Array.isArray(sessionsInput)) throw new Error(`${contract.id} task implementation requires sessions`);
  const sessions = sessionsInput.map((need) => Object.freeze(SessionNeedSchema.parse(need)));
  const namespace = namespaceOf(contract.id);
  const browser = BrowserSystemIdSchema.safeParse(namespace);
  const service = ServiceSystemIdSchema.safeParse(namespace);
  if (browser.success) {
    if (sessions.length !== 1) throw new Error(`${contract.id} browser task requires exactly one session`);
    const need = sessions[0];
    if (need === undefined || need.system !== browser.data) {
      throw new Error(`${contract.id} session system must match store ${browser.data}`);
    }
    const expectedAccess = contract.effect === "read" ? "read" : "transaction";
    if (need.access !== expectedAccess) {
      throw new Error(`${contract.id} ${contract.effect} task requires ${expectedAccess} session access`);
    }
    if (browser.data === "onbase" && need.exclusive !== true) {
      throw new Error(`${contract.id} OnBase task session must declare exclusive:true`);
    }
    if (browser.data !== "onbase" && need.exclusive === true) {
      throw new Error(`${contract.id} cannot declare exclusive:true outside OnBase`);
    }
    if (need.acceptDownloads === true
      && (contract.effect !== "read" || contract.artifacts !== "content-addressed")) {
      throw new Error(`${contract.id} download sessions require a content-addressed read contract`);
    }
  } else {
    if (!service.success && !namespace.startsWith("workflow:")) {
      throw new Error(`${contract.id} has an unknown task-store namespace`);
    }
    if (contract.effect !== "read") throw new Error(`${contract.id} headless task must be read-only`);
    if (sessions.length !== 0) throw new Error(`${contract.id} headless task must be sessionless`);
    if (namespace.startsWith("workflow:") && contract.artifacts !== undefined) {
      throw new Error(`${contract.id} workflow mini-store cannot declare artifacts`);
    }
  }
  const retryInput: unknown = Reflect.get(implInput, "retry");
  const retry = retryInput === undefined ? undefined : Object.freeze(RetryPolicySchema.parse(retryInput));
  if (contract.effect !== "read" && retry !== undefined) {
    throw new Error(`${contract.id} ${contract.effect} task cannot declare generic retry`);
  }
  return Object.freeze({
    sessions: Object.freeze(sessions),
    ...(retry === undefined ? {} : { retry }),
    run,
  });
}

export function defineTask<C extends AnyReadTaskContract>(contract: C, impl: ReadTaskImpl<C>): Task<C>;
export function defineTask<C extends AnyPrepareTaskContract>(contract: C, impl: PrepareTaskImpl<C>): Task<C>;
export function defineTask<C extends AnyCommitTaskContract>(contract: C, impl: CommitTaskImpl<C>): Task<C>;
export function defineTask(
  contract: AnyTaskContract,
  impl: unknown,
): Readonly<{ contract: AnyTaskContract; impl: RuntimeTaskImpl; __task: true }> {
  const parsedImpl = validateTaskBinding(contract, impl);
  const task = Object.freeze({ contract, impl: parsedImpl, __task: true as const });
  FACTORY_DEFINED_TASKS.add(task);
  return task;
}

export function assertFactoryDefinedTask(input: unknown): asserts input is AnyTask {
  if (input === null || typeof input !== "object" || !FACTORY_DEFINED_TASKS.has(input)) {
    throw new Error("task store requires the exact task object returned by defineTask");
  }
}

export function taskFailer<const Codes extends readonly [string, ...string[]]>(
  contract: Readonly<{ id: TaskId; errorCodes: Codes }>,
) {
  return (
    code: Codes[number],
    message: string,
    options?: Readonly<{ subject?: string; transient?: boolean; cause?: unknown }>,
  ): never => {
    throw new TaskError(contract.id, code, message, options);
  };
}
