import { z } from "zod";
import type { ContentAddressedArtifactWriter } from "./artifacts.js";
import type { ProviderClientSubset } from "./providers.js";
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  AnyReadTaskContract,
  AnyTaskContract,
} from "../models/task/task-contract.js";
import { assertFactorySealedTaskContract } from "../models/task/task-contract.js";
import { BrowserSystemIdSchema, ServiceSystemIdSchema } from "../rules/identity/ids.js";
import type {
  BrowserSystemId,
  LiteralTaskId,
  ProviderCapabilityId,
  TaskId,
} from "../rules/identity/ids.js";
import { RetryPolicySchema, SessionNeedSchema } from "../models/sessions/session.js";
import type { RetryPolicy, SessionNeed } from "../models/sessions/session.js";
import type { MutationCapability } from "../models/ui/driver.js";
import type { DataPoint } from "../rules/workflow/task-provenance.js";
import type { DeclaredStepResult } from "../models/events/confirmed-action.js";
import type { JsonValue } from "../rules/validation/canonical-json.js";
import type { WorkflowOperationDisplaySnapshot } from "../models/workflow/operation-display-snapshot.js";
import { TaskError } from "./errors.js";

export interface BrowserDriver {
  readonly system: BrowserSystemId;
}

export type SystemOnlyDriver<S extends BrowserSystemId> = Readonly<{ system: S }>;

const driverType: unique symbol = Symbol("task-driver-type");

/** Factory-owned declaration of the concrete system-driver API, without exposing a browser implementation to bundle-safe contracts; the private identity keeps a task bound to one driver API. */
export interface DriverDeclaration<Driver extends BrowserDriver> {
  readonly system: Driver["system"];
  readonly status: "unwired" | "semantic-ready";
  readonly [driverType]: (driver: Driver) => Driver;
}

export interface RuntimeDriverDeclaration {
  readonly system: BrowserSystemId;
  readonly status: DriverDeclaration<BrowserDriver>["status"];
}

const FACTORY_DECLARED_DRIVERS = new WeakSet<object>();

function isFactoryDeclaredDriver(input: object): input is RuntimeDriverDeclaration {
  return FACTORY_DECLARED_DRIVERS.has(input);
}

function createDriverDeclaration<Driver extends BrowserDriver>(
  system: Driver["system"],
  status: DriverDeclaration<Driver>["status"],
): DriverDeclaration<Driver> {
  BrowserSystemIdSchema.parse(system);
  const declaration: DriverDeclaration<Driver> = Object.freeze({
    system,
    status,
    [driverType]: (driver: Driver): Driver => driver,
  });
  FACTORY_DECLARED_DRIVERS.add(declaration);
  return declaration;
}

/** Declares an empty/unwired driver surface for stores that do not have semantic operations yet. */
export function declareDriver<const S extends BrowserSystemId>(
  system: S,
  status: DriverDeclaration<SystemOnlyDriver<S>>["status"],
): DriverDeclaration<SystemOnlyDriver<S>> {
  return createDriverDeclaration<SystemOnlyDriver<S>>(system, status);
}

/** Declares the concrete typed driver surface owned by a browser store. */
export function declareDriverFor<Driver extends BrowserDriver>(): (
  system: Driver["system"],
  status: DriverDeclaration<Driver>["status"],
) => DriverDeclaration<Driver> {
  return createDriverDeclaration;
}

export function assertFactoryDeclaredDriver(input: unknown): asserts input is RuntimeDriverDeclaration {
  if (input === null || typeof input !== "object" || !isFactoryDeclaredDriver(input)) {
    throw new Error("browser task/store requires the exact declaration returned by a driver declaration factory");
  }
}

export interface TaskLogger {
  readonly debug: (message: string, fields?: Readonly<Record<string, string | number | boolean>>) => void;
  readonly info: (message: string, fields?: Readonly<Record<string, string | number | boolean>>) => void;
  readonly warn: (message: string, fields?: Readonly<Record<string, string | number | boolean>>) => void;
}

export type ConfirmedActionRef = Readonly<{ id: string; targetId: string }>;
export type ConfirmedOutcomeReference = WorkflowOperationDisplaySnapshot["invocations"][number]["outcomes"][number]["when"]["value"];
export type ConfirmedVerification = Readonly<{
  action: ConfirmedActionRef;
  purpose: "read-validation" | "readback" | "interaction-effect" | "saved-effect";
  observe: () => Promise<JsonValue>;
  matches: (observed: JsonValue) => boolean;
}>;
export type ConfirmedOutcomeObservation = Readonly<{ state: "value"; value: JsonValue }>
  | Readonly<{ state: "empty" }>
  | Readonly<{ state: "unavailable" }>;
export type ConfirmedOutcomeVerification = Readonly<{
  action: ConfirmedActionRef;
  purpose: "read-validation";
  observe: () => Promise<unknown>;
  matches: (observed: ConfirmedOutcomeObservation) => boolean;
}>;
export interface ConfirmedTaskActions {
  read<T extends JsonValue>(action: ConfirmedActionRef, perform: () => Promise<T>, verification: ConfirmedVerification): Promise<T>;
  fill(action: ConfirmedActionRef, expected: JsonValue, perform: () => Promise<unknown>, readback: ConfirmedVerification): Promise<void>;
  click(action: ConfirmedActionRef, perform: () => Promise<unknown>, verification: ConfirmedVerification): Promise<void>;
  keypress(action: ConfirmedActionRef, perform: () => Promise<unknown>, verification: ConfirmedVerification): Promise<void>;
  verify(verification: ConfirmedVerification & Readonly<{ purpose: "read-validation" }>): Promise<JsonValue>;
  confirmOutcome(reference: ConfirmedOutcomeReference, verification: ConfirmedOutcomeVerification): Promise<ConfirmedOutcomeObservation>;
  result(): DeclaredStepResult;
}

export interface TaskCtxCommon<Codes extends readonly string[]> {
  readonly signal: AbortSignal;
  readonly log: TaskLogger;
  readonly fail: (
    code: Codes[number],
    message: string,
    options?: Readonly<{ subject?: string; transient?: boolean; cause?: unknown }>,
  ) => never;
  /** Executor-owned, strict task-output provenance collection. */
  readonly recordData: (point: DataPoint | readonly DataPoint[]) => void;
  /** Present for complete frozen operation displays; legacy invocations have no structured action proof. */
  readonly confirmed?: ConfirmedTaskActions;
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
> = BrowserTaskCtx<Driver, Codes> & Readonly<{ captureScreenshot: () => Promise<void> }>;

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
type BrowserSystemOf<C extends AnyTaskContract> = Extract<NamespaceOf<C>, BrowserSystemId>;
type ProviderNeedsOf<C extends AnyTaskContract> =
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

type ContractDriver<C extends AnyTaskContract> = Readonly<{ system: BrowserSystemOf<C> }>;
type ReadCtxFor<
  C extends AnyReadTaskContract,
  Driver extends ContractDriver<C>,
> = [BrowserSystemOf<C>] extends [never]
  ? NamespaceOf<C> extends `workflow:${string}`
    ? PureTaskCtx<C["errorCodes"]>
    : ServiceTaskCtx<C["errorCodes"], ProviderNeedsOf<C>>
  : ReadTaskCtx<Driver, C["errorCodes"]>;
type ArtifactCtxFor<C extends AnyReadTaskContract> = C extends { readonly artifacts: "content-addressed" }
  ? Readonly<{ artifacts: ContentAddressedArtifactWriter }>
  : Readonly<{ artifacts?: never }>;

export interface ReadTaskImpl<
  C extends AnyReadTaskContract,
  Driver extends ContractDriver<C> = ContractDriver<C>,
> {
  readonly sessions: SessionsFor<C>;
  readonly retry?: RetryPolicy;
  readonly screenshots?: [BrowserSystemOf<C>] extends [never] ? never : "task";
  readonly run: (args: Readonly<{
    input: z.output<C["input"]>;
    ctx: ReadCtxFor<C, Driver> & ArtifactCtxFor<C>;
  }>) => Promise<z.input<C["output"]>>;
}

export interface PrepareTaskImpl<
  C extends AnyPrepareTaskContract,
  Driver extends ContractDriver<C> = ContractDriver<C>,
> {
  readonly sessions: SessionsFor<C>;
  readonly retry?: never;
  readonly run: (args: Readonly<{
    input: z.output<C["input"]>;
    ctx: PrepareTaskCtx<Driver, C["errorCodes"]>;
  }>) => Promise<z.input<C["output"]>>;
}

export interface CommitTaskImpl<
  C extends AnyCommitTaskContract,
  Driver extends ContractDriver<C> = ContractDriver<C>,
> {
  readonly sessions: SessionsFor<C>;
  readonly retry?: never;
  readonly run: (args: Readonly<{
    input: z.output<C["input"]>;
    ctx: CommitTaskCtx<Driver, C["errorCodes"]>;
  }>) => Promise<z.input<C["output"]>>;
}

type ImplFor<
  C extends AnyTaskContract,
  Driver extends ContractDriver<C> = ContractDriver<C>,
> = C extends AnyReadTaskContract ? ReadTaskImpl<C, Driver>
    : C extends AnyPrepareTaskContract ? PrepareTaskImpl<C, Driver>
      : C extends AnyCommitTaskContract ? CommitTaskImpl<C, Driver>
        : never;

type TaskDriverBinding<
  C extends AnyTaskContract,
  Driver extends ContractDriver<C>,
> = [BrowserSystemOf<C>] extends [never]
  ? Readonly<{ driver?: never }>
  : Readonly<{ driver: DriverDeclaration<Driver> }>;

export type Task<
  C extends AnyTaskContract,
  Driver extends ContractDriver<C> = ContractDriver<C>,
> = Readonly<{
  contract: C;
  impl: ImplFor<C, Driver>;
  __task: true;
}> & TaskDriverBinding<C, Driver>;
const FACTORY_DEFINED_TASKS = new WeakSet<object>();

type RuntimeTaskImpl = Readonly<{
  sessions: readonly SessionNeed[];
  retry?: RetryPolicy;
  screenshots?: "task";
  run: (args: never) => Promise<unknown>;
}>;
export type AnyTask = Readonly<{
  contract: AnyTaskContract;
  impl: RuntimeTaskImpl;
  __task: true;
  driver?: RuntimeDriverDeclaration;
}>;
const RuntimeTaskRunSchema = z.custom<RuntimeTaskImpl["run"]>(
  (value) => typeof value === "function",
  "task implementation requires run",
);

function namespaceOf(taskIdValue: string): string {
  return taskIdValue.slice(0, taskIdValue.lastIndexOf("/"));
}

function validateTaskBinding(
  contract: AnyTaskContract,
  implInput: unknown,
  driver: RuntimeDriverDeclaration | undefined,
): RuntimeTaskImpl {
  assertFactorySealedTaskContract(contract);
  if (implInput === null || typeof implInput !== "object") {
    throw new Error(`${contract.id} task implementation must be an object`);
  }
  const run = RuntimeTaskRunSchema.parse(Reflect.get(implInput, "run"));
  const expectedKeys = new Set(["sessions", "run", ...(contract.effect === "read" ? ["retry", "screenshots"] : [])]);
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
    if (driver === undefined) throw new Error(`${contract.id} browser task requires a typed driver declaration`);
    assertFactoryDeclaredDriver(driver);
    if (driver.system !== browser.data) {
      throw new Error(`${contract.id} cannot bind ${driver.system} driver`);
    }
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
    if (driver !== undefined) throw new Error(`${contract.id} headless task cannot bind a browser driver`);
    if (!service.success && !namespace.startsWith("workflow:")) {
      throw new Error(`${contract.id} has an unknown task-store namespace`);
    }
    if (contract.effect !== "read") throw new Error(`${contract.id} headless task must be read-only`);
    if (sessions.length !== 0) throw new Error(`${contract.id} headless task must be sessionless`);
    if (namespace.startsWith("workflow:") && contract.artifacts !== undefined) {
      throw new Error(`${contract.id} workflow mini-store cannot declare artifacts`);
    }
  }
  const screenshots: unknown = Reflect.get(implInput, "screenshots");
  if (screenshots !== undefined && (screenshots !== "task" || !browser.success || contract.effect !== "read")) {
    throw new Error(`${contract.id} task-owned screenshots require a browser read`);
  }
  const retryInput: unknown = Reflect.get(implInput, "retry");
  const retry = retryInput === undefined ? undefined : Object.freeze(RetryPolicySchema.parse(retryInput));
  if (contract.effect !== "read" && retry !== undefined) {
    throw new Error(`${contract.id} ${contract.effect} task cannot declare generic retry`);
  }
  return Object.freeze({
    sessions: Object.freeze(sessions),
    ...(retry === undefined ? {} : { retry }),
    ...(screenshots === "task" ? { screenshots } : {}),
    run,
  });
}

type HeadlessReadContract<C extends AnyReadTaskContract> = [BrowserSystemOf<C>] extends [never]
  ? C
  : never;

export function defineTask<
  C extends AnyReadTaskContract,
  Driver extends ContractDriver<C>,
>(driver: DriverDeclaration<Driver>, contract: C, impl: ReadTaskImpl<C, Driver>): Task<C, Driver>;
export function defineTask<
  C extends AnyPrepareTaskContract,
  Driver extends ContractDriver<C>,
>(driver: DriverDeclaration<Driver>, contract: C, impl: PrepareTaskImpl<C, Driver>): Task<C, Driver>;
export function defineTask<
  C extends AnyCommitTaskContract,
  Driver extends ContractDriver<C>,
>(driver: DriverDeclaration<Driver>, contract: C, impl: CommitTaskImpl<C, Driver>): Task<C, Driver>;
export function defineTask<C extends AnyReadTaskContract>(
  contract: HeadlessReadContract<C>,
  impl: ReadTaskImpl<C>,
): Task<C>;
export function defineTask(
  driverOrContract: RuntimeDriverDeclaration | AnyTaskContract,
  contractOrImpl: unknown,
  browserImpl?: unknown,
): AnyTask {
  const driver = isFactoryDeclaredDriver(driverOrContract) ? driverOrContract : undefined;
  const contractInput = driver === undefined ? driverOrContract : contractOrImpl;
  assertFactorySealedTaskContract(contractInput);
  const implInput = driver === undefined ? contractOrImpl : browserImpl;
  const parsedImpl = validateTaskBinding(contractInput, implInput, driver);
  const task = driver === undefined
    ? Object.freeze({ contract: contractInput, impl: parsedImpl, __task: true as const })
    : Object.freeze({ contract: contractInput, impl: parsedImpl, driver, __task: true as const });
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
