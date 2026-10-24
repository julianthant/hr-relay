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
}>;
const retainedSourceClosures = new WeakMap<AuthoritySourceClosureUnprovedError, RetainedSourceOwners>();

export function retainAuthoritySourceClosure(errors: readonly unknown[], owners: RetainedSourceOwners): AuthoritySourceClosureUnprovedError {
  const failure = new AuthoritySourceClosureUnprovedError(errors);
  retainedSourceClosures.set(failure, owners);
  return failure;
}
