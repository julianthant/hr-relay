import { AsyncLocalStorage } from "node:async_hooks";

export class AuthoritySourceClosureUnprovedError extends AggregateError {
  constructor(errors: readonly unknown[]) {
    super(errors, "authority-source-closure-unproved", { cause: errors[0] });
    this.name = "AuthoritySourceClosureUnprovedError";
  }
}

type RetainedSourceOwners = Readonly<{
  snapshot?: Readonly<{ path: string; assertUnchanged(): void; dispose(): void }>;
  database?: object;
  directory?: object;
  descriptor?: Readonly<{ descriptor: number; identity?: object }>;
  backupSource?: Readonly<{ close(): void }>;
  admission?: object;
  restore?: object;
  restoreCreation?: object;
  processLock?: object;
  operationProof?: object;
  nativeResource?: object;
}>;
const retainedSourceClosures = new WeakMap<AuthoritySourceClosureUnprovedError, readonly RetainedSourceOwners[]>();
const provedClosures = new WeakSet<AuthoritySourceClosureUnprovedError>();
const retainedSnapshots = new WeakSet<object>();
const recoveringClosures = new AsyncLocalStorage<{ active: boolean; failures: ReadonlySet<AuthoritySourceClosureUnprovedError> }>();

export function createBrowserSourceRecovery() {
  const failures = new Set<AuthoritySourceClosureUnprovedError>(), sources = new Set<unknown>();
  return Object.freeze({
    retain(failure: AuthoritySourceClosureUnprovedError): void { failures.add(failure); },
    observeSource(error: unknown): void { sources.add(error); },
    async recoverSources(recover: (error: unknown) => Promise<void>): Promise<void> { for (const failure of new Set([...failures, ...sources])) await recover(failure); },
    async prove<T>(proof: () => Promise<T>): Promise<T> {
      const scope = { active: true, failures: new Set(failures) };
      return recoveringClosures.run(scope, async () => {
        try {
          const result = await proof();
          for (const failure of scope.failures) provedClosures.add(failure);
          return result;
        } finally { scope.active = false; }
      });
    },
  });
}

export function retainAuthoritySourceClosure(errors: readonly unknown[], owners: RetainedSourceOwners): AuthoritySourceClosureUnprovedError {
  const failure = new AuthoritySourceClosureUnprovedError(errors);
  retainedSourceClosures.set(failure, [owners]);
  if (owners.snapshot !== undefined) retainedSnapshots.add(owners.snapshot);
  return failure;
}

function sourceClosures(error: unknown, all = false): Set<AuthoritySourceClosureUnprovedError> {
  const pending: unknown[] = [error], seen = new Set<unknown>(), closures = new Set<AuthoritySourceClosureUnprovedError>();
  while (pending.length !== 0) {
    const value = pending.pop();
    if (seen.has(value)) continue;
    seen.add(value);
    const recovery = recoveringClosures.getStore();
    if (value instanceof AuthoritySourceClosureUnprovedError && (all || !provedClosures.has(value) && !(recovery?.active && recovery.failures.has(value)))) closures.add(value);
    if (value instanceof AggregateError) { const errors: readonly unknown[] = value.errors; pending.push(...errors); }
    if (value instanceof Error && value.cause !== undefined) pending.push(value.cause);
  }
  return closures;
}

/** True when a closure failure retained this snapshot, so its files must outlive the code that made it. */
export function isRetainedSnapshot(snapshot: object): boolean { return retainedSnapshots.has(snapshot); }

export function hasUnprovedSourceClosure(error: unknown): boolean { return sourceClosures(error).size !== 0; }

export function rememberUnprovedSourceClosure(failures: Set<unknown>, error: unknown): boolean {
  const closures = sourceClosures(error);
  if (closures.size === 0) return false;
  const retained = new Set([...failures].flatMap(failure => [...sourceClosures(failure)]));
  if ([...closures].every(closure => retained.has(closure))) return false;
  failures.add(error); return true;
}

export function assertSourceClosuresProved(failures: ReadonlySet<unknown>): void {
  const values = [...failures].filter(error => sourceClosures(error, true).size === 0 || hasUnprovedSourceClosure(error));
  if (values.length === 0) return;
  if (values.length === 1) throw values[0];
  throw new AggregateError(values, "authority-source-closure-unproved", { cause: values[0] });
}

export function retainUnprovedSourceOwners(error: unknown, owners: RetainedSourceOwners): void {
  for (const closure of sourceClosures(error)) {
    retainedSourceClosures.set(closure, [...(retainedSourceClosures.get(closure) ?? []), owners]);
    if (owners.snapshot !== undefined) retainedSnapshots.add(owners.snapshot);
  }
}
