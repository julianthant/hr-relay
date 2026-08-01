import type { SessionProvider } from "./session.js";
import { assertFactoryDefinedTask } from "./task.js";
import type { AnyTask } from "./task.js";
import {
  TaskContractResolutionCorpusSchema,
  assertTaskContractReferences,
} from "../domain/contracts/base.js";
import type { TaskContractResolutionCorpus } from "../domain/contracts/base.js";
import {
  BrowserSystemIdSchema,
  ServiceSystemIdSchema,
  TaskStoreIdSchema,
  WorkflowIdSchema,
} from "../domain/ids.js";
import type { BrowserSystemId, ServiceSystemId } from "../domain/ids.js";
import { deepFreeze } from "../domain/immutability.js";

export interface DriverDeclaration<S extends BrowserSystemId> {
  readonly system: S;
  readonly status: "unwired" | "semantic-ready";
}

export interface BrowserTaskStore<
  S extends BrowserSystemId,
  T extends Readonly<Record<string, AnyTask>>,
> {
  readonly kind: "browser";
  readonly namespace: S;
  readonly driver: DriverDeclaration<S>;
  readonly session: SessionProvider<S>;
  readonly tasks: T;
}

export interface HeadlessTaskStore<
  N extends string,
  T extends Readonly<Record<string, AnyTask>>,
> {
  readonly kind: "headless";
  readonly namespace: N;
  readonly tasks: T;
}

export type RegisteredTaskStore =
  | BrowserTaskStore<BrowserSystemId, Readonly<Record<string, AnyTask>>>
  | HeadlessTaskStore<string, Readonly<Record<string, AnyTask>>>;
const FACTORY_DEFINED_STORES = new WeakSet<object>();

export const EMPTY_TASK_CONTRACT_CORPUS = deepFreeze(TaskContractResolutionCorpusSchema.parse({
  scenarioIds: [],
  tasks: [],
}));

export function declareDriver<S extends BrowserSystemId>(
  system: S,
  status: DriverDeclaration<S>["status"],
): DriverDeclaration<S> {
  BrowserSystemIdSchema.parse(system);
  return Object.freeze({ system, status });
}

function validateStoreTasks(namespace: string, tasks: Readonly<Record<string, AnyTask>>): void {
  const ids = new Set<string>();
  for (const [key, task] of Object.entries(tasks)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(key)) throw new Error(`${namespace} store task key ${key} must be camelCase`);
    assertFactoryDefinedTask(task);
    if (!task.contract.id.startsWith(`${namespace}/`)) {
      throw new Error(`${task.contract.id} cannot be registered in ${namespace} store`);
    }
    if (ids.has(task.contract.id)) throw new Error(`${namespace} store duplicates task id ${task.contract.id}`);
    ids.add(task.contract.id);
  }
}

export function defineBrowserStore<
  S extends BrowserSystemId,
  T extends Readonly<Record<string, AnyTask>>,
>(
  namespace: S,
  driver: DriverDeclaration<S>,
  session: SessionProvider<S>,
  tasks: T,
): BrowserTaskStore<S, T> {
  BrowserSystemIdSchema.parse(namespace);
  if (driver.system !== namespace) throw new Error(`${namespace} store cannot use ${driver.system} driver`);
  if (session.system !== namespace) throw new Error(`${namespace} store cannot use ${session.system} session provider`);
  if (namespace === "onbase" && session.exclusive !== true) {
    throw new Error("onbase store requires an identity-exclusive session provider");
  }
  if (namespace !== "onbase" && session.exclusive === true) {
    throw new Error(`${namespace} store cannot use an identity-exclusive session provider`);
  }
  validateStoreTasks(namespace, tasks);
  const store = Object.freeze({
    kind: "browser",
    namespace,
    driver,
    session,
    tasks: Object.freeze({ ...tasks }),
  });
  FACTORY_DEFINED_STORES.add(store);
  return store;
}

export function defineServiceStore<
  S extends ServiceSystemId,
  T extends Readonly<Record<string, AnyTask>>,
>(namespace: S, tasks: T): HeadlessTaskStore<S, T> {
  ServiceSystemIdSchema.parse(namespace);
  validateStoreTasks(namespace, tasks);
  for (const task of Object.values(tasks)) {
    if (task.contract.effect !== "read" || task.impl.sessions.length !== 0) {
      throw new Error(`${task.contract.id} service-store task must be a sessionless read`);
    }
  }
  const store = Object.freeze({ kind: "headless", namespace, tasks: Object.freeze({ ...tasks }) });
  FACTORY_DEFINED_STORES.add(store);
  return store;
}

export function defineWorkflowStore<
  Id extends string,
  T extends Readonly<Record<string, AnyTask>>,
>(workflowId: Id, tasks: T): HeadlessTaskStore<`workflow:${Id}`, T> {
  WorkflowIdSchema.parse(workflowId);
  const namespace = `workflow:${workflowId}` as const;
  TaskStoreIdSchema.parse(namespace);
  validateStoreTasks(namespace, tasks);
  for (const task of Object.values(tasks)) {
    if (task.contract.effect !== "read" || task.impl.sessions.length !== 0) {
      throw new Error(`${task.contract.id} workflow mini-store task must be a sessionless read`);
    }
    if (task.contract.artifacts !== undefined || task.contract.providers !== undefined) {
      throw new Error(`${task.contract.id} workflow mini-store cannot declare artifacts or providers`);
    }
  }
  const store = Object.freeze({ kind: "headless", namespace, tasks: Object.freeze({ ...tasks }) });
  FACTORY_DEFINED_STORES.add(store);
  return store;
}

export interface TaskStoreRegistry {
  readonly stores: readonly RegisteredTaskStore[];
  readonly corpus: TaskContractResolutionCorpus;
}

export function defineTaskStoreRegistry(
  storesInput: readonly RegisteredTaskStore[],
  corpusInput: unknown,
): TaskStoreRegistry {
  const corpus = deepFreeze(TaskContractResolutionCorpusSchema.parse(corpusInput));
  const namespaces = new Set<string>();
  const registryTasks = new Map<string, AnyTask>();
  for (const store of storesInput) {
    if (!FACTORY_DEFINED_STORES.has(store)) {
      throw new Error("task store registry requires exact stores returned by a define-store factory");
    }
    if (namespaces.has(store.namespace)) throw new Error(`duplicate task store namespace ${store.namespace}`);
    namespaces.add(store.namespace);
    for (const task of Object.values(store.tasks)) {
      if (registryTasks.has(task.contract.id)) throw new Error(`duplicate registry task id ${task.contract.id}`);
      registryTasks.set(task.contract.id, task);
    }
  }
  const corpusTasks = new Map<string, string>();
  for (const task of corpus.tasks) {
    if (corpusTasks.has(task.id)) throw new Error(`contract corpus duplicates task id ${task.id}`);
    corpusTasks.set(task.id, task.effect);
  }
  for (const [id, task] of registryTasks) {
    const effect = corpusTasks.get(id);
    if (effect === undefined) throw new Error(`store task ${id} is absent from the contract corpus`);
    if (effect !== task.contract.effect) throw new Error(`store task ${id} disagrees with corpus effect ${effect}`);
    assertTaskContractReferences(task.contract, corpus);
  }
  for (const id of corpusTasks.keys()) {
    if (!registryTasks.has(id)) throw new Error(`contract corpus task ${id} has no store implementation`);
  }
  return Object.freeze({ stores: Object.freeze([...storesInput]), corpus });
}
