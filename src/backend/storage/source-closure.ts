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
}>;
const retainedSourceClosures = new WeakMap<AuthoritySourceClosureUnprovedError, RetainedSourceOwners>();

export function retainAuthoritySourceClosure(errors: readonly unknown[], owners: RetainedSourceOwners): AuthoritySourceClosureUnprovedError {
  const failure = new AuthoritySourceClosureUnprovedError(errors);
  retainedSourceClosures.set(failure, owners);
  return failure;
}

function sourceClosures(error: unknown): Set<AuthoritySourceClosureUnprovedError> {
  const pending: unknown[] = [error], seen = new Set<unknown>(), closures = new Set<AuthoritySourceClosureUnprovedError>();
  while (pending.length !== 0) {
    const value = pending.pop();
    if (seen.has(value)) continue;
    seen.add(value);
    if (value instanceof AuthoritySourceClosureUnprovedError) closures.add(value);
    if (value instanceof AggregateError) { const errors: readonly unknown[] = value.errors; pending.push(...errors); }
    if (value instanceof Error && value.cause !== undefined) pending.push(value.cause);
  }
  return closures;
}

export function hasUnprovedSourceClosure(error: unknown): boolean { return sourceClosures(error).size !== 0; }

export function rememberUnprovedSourceClosure(failures: Set<unknown>, error: unknown): boolean {
  const closures = sourceClosures(error);
  if (closures.size === 0) return false;
  const retained = new Set([...failures].flatMap(failure => [...sourceClosures(failure)]));
  if ([...closures].every(closure => retained.has(closure))) return false;
  failures.add(error); return true;
}

export function assertSourceClosuresProved(failures: ReadonlySet<unknown>): void {
  if (failures.size === 0) return;
  const values = [...failures];
  if (values.length === 1) throw values[0];
  throw new AggregateError(values, "authority-source-closure-unproved", { cause: values[0] });
}

export function retainUnprovedSourceOwners(error: unknown, owners: RetainedSourceOwners): void {
  for (const closure of sourceClosures(error)) retainedSourceClosures.set(closure, { ...retainedSourceClosures.get(closure), ...owners });
}
