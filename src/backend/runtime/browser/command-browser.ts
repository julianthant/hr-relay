import { mkdirSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BrowserContext } from 'playwright';
import { z } from 'zod';
import { ERROR_CATALOG } from '../../../models/failures/error-catalog.js';
import { requireSecret } from '../../../models/config/secrets.js';
import { FingerprintSchema } from '../../../rules/identity/ids.js';
import type { Clock } from '../../../rules/time/clock.js';
import { assertDuoCeremonyLeaseToken, type DuoCeremonyLeaseToken } from '../../../workflow-kit/duo-ceremony-lease.js';
import type { CommandBrowserInput, CommandBrowserContext, CommandBrowserScope } from '../../systems/browser-shared/command-session.js';
import type { RuntimeAdmission } from '../../storage/admission/admission.js';
import { requireRuntimeAdmission } from '../../storage/admission/admission-identity.js';
import { admitCommandBrowser, commandProfileDirectory, createBrowserRoots, profileReservations, assertPrivateProfilePath, type BrowserRootLaunchInput } from '../../storage/browser-roots.js';
import { fsyncPath } from '../../storage/private-path.js';
import { hasUnprovedSourceClosure, retainAuthoritySourceClosure } from '../../storage/source-closure.js';
import type { DuoCeremonyLeaseRepository } from '../../storage/sqlite/authority-database.js';
import { composeDuoCeremonyGateFactory } from '../gates/duo-ceremony-gate.js';
import type { DuoCeremonyGateHandle } from '../gates/duo-ceremony-gate.js';
import { assertFastDuoReady, browserSignInFingerprint } from './browser-session-factory.js';
import { createNativeBrowserProbe, DEFAULT_BROWSER_LAUNCHER, closeContextWithProof, observeContextLifecycle, chromiumProfileInUse, type BrowserDeadlineScheduler, type PersistentContextLauncher } from './native-browser.js';
import { stageFastDuoExtension } from './fast-duo-extension.js';
import { provisionWorkflowDuo } from './workflow-duo-provider.js';

export class CommandBrowserError extends Error {
  constructor(readonly code: 'COMMAND_BROWSER_BUSY' | 'COMMAND_BROWSER_CANCELLED' | 'COMMAND_BROWSER_UNAVAILABLE', options?: ErrorOptions) {
    super(ERROR_CATALOG[code].text, options); this.name = 'CommandBrowserError';
  }
}
export class CommandBrowserClosureError extends AggregateError {
  readonly code = 'COMMAND_BROWSER_CLOSURE_UNPROVED';
  constructor(errors: readonly unknown[]) { super(errors, ERROR_CATALOG.COMMAND_BROWSER_CLOSURE_UNPROVED.text); this.name = 'CommandBrowserClosureError'; }
}
type NativeLaunchOutcome = Readonly<{ state: 'opened'; context: BrowserContext }>
  | Readonly<{ state: 'profile-in-use'; error: unknown }>
  | Readonly<{ state: 'rejected-uncertain'; error: unknown }>;
type NativeLaunchState = NativeLaunchOutcome | Readonly<{ state: 'not-attempted' }> | Readonly<{ state: 'launching' }>;

export function createCommandBrowserManager(options: Readonly<{
  admission: RuntimeAdmission; leases: DuoCeremonyLeaseRepository; clock: Clock; scheduler: BrowserDeadlineScheduler;
  recordEvidence: (event: Readonly<{ commandId: string; system: 'sharepoint'; phase: 'authenticated' }>) => void;
  launcher?: PersistentContextLauncher;
}>) {
  const admission = requireRuntimeAdmission(options.admission), profileId = admission.profileBinding.profileId;
  admission.assertProfileRuntime();
  const lifetime = admission.lifetime, roots = createBrowserRoots(admission), launcher = options.launcher ?? DEFAULT_BROWSER_LAUNCHER;
  type Active = { controller: AbortController; completion: Promise<void>; failure?: CommandBrowserClosureError };
  let active: Active | undefined, closing = false;
  const owner = (id: string) => { if (id !== profileId) throw new CommandBrowserError('COMMAND_BROWSER_UNAVAILABLE'); };
  async function withCommand<T>(input: CommandBrowserInput, body: (scope: CommandBrowserScope) => Promise<T>): Promise<T> {
    z.uuid().parse(input.commandId); FingerprintSchema.parse(input.requestDigest);
    if (closing || active !== undefined) throw new CommandBrowserError('COMMAND_BROWSER_BUSY');
    input.signal.throwIfAborted(); input.assertCurrent(); admission.assertProfileRuntime();
    const controller = new AbortController();
    let finished: () => void = () => { throw new CommandBrowserError('COMMAND_BROWSER_UNAVAILABLE'); };
    const entry: Active = { controller, completion: new Promise<void>(resolve => { finished = resolve; }) };
    const cancel = () => controller.abort(new CommandBrowserError('COMMAND_BROWSER_CANCELLED', { cause: input.signal.reason }));
    input.signal.addEventListener('abort', cancel, { once: true });
    active = entry;
    const assertCurrent = () => { input.signal.throwIfAborted(); controller.signal.throwIfAborted(); input.assertCurrent(); admission.assertProfileRuntime(); };
    let acquired = false, browserCompletion: Promise<void> | undefined, browserFailure: { error: unknown } | undefined;
    const executeBrowser = async <Result>(use: (browser: CommandBrowserContext) => Promise<Result>): Promise<Result> => {
        assertCurrent();
        if (acquired) throw new CommandBrowserError('COMMAND_BROWSER_BUSY');
        acquired = true;
        const config = input.config, { clock, scheduler } = options;
        const capability = admitCommandBrowser(admission, { commandId: input.commandId, requestDigest: input.requestDigest, profileRoot: config.paths.browserProfileRoot });
        const directory = commandProfileDirectory(config.paths.browserProfileRoot);
        let rootInput: BrowserRootLaunchInput = { profileId, profileRoot: config.paths.browserProfileRoot, profileDirectory: directory,
          owner: { kind: 'command', capability }, credentialFingerprint: null };
        const deadline = clock.monotonicMs() + config.timeouts.sessionAcquireMs;
        const timer = scheduler.schedule(deadline, () => controller.abort(new CommandBrowserError('COMMAND_BROWSER_CANCELLED')));
        let context: BrowserContext | undefined, lifecycle: ReturnType<typeof observeContextLifecycle> | undefined;
        let launch: ReturnType<typeof roots.beginLaunch> | undefined, broker: Awaited<ReturnType<typeof provisionWorkflowDuo>> | undefined;
        let gate: DuoCeremonyGateHandle | undefined, signing: DuoCeremonyLeaseToken | undefined;
        let closePromise: Promise<void> | undefined, proven = false, reserved = false, setupReady = false;
        let nativeLaunch: NativeLaunchState = { state: 'not-attempted' };
        const retain = (errors: readonly unknown[]): never => {
          const failure = retainAuthoritySourceClosure(errors, { admission, directory: { directory, context, lifecycle, nativeLaunch, broker, launch, capability, entry } });
          admission.retainSourceClosure(failure); lifetime.retainSourceClosure(failure);
          entry.failure = new CommandBrowserClosureError([...errors, failure]); throw entry.failure;
        };
        const close = (): Promise<void> => closePromise ??= (async () => {
          const errors: unknown[] = [], nativeErrors: unknown[] = [];
          try { launch?.closing(); } catch (error) { nativeErrors.push(error); }
          const closeDeadline = clock.monotonicMs() + config.browser.closeProofMs;
          if (broker !== undefined) {
            let timeout: ReturnType<BrowserDeadlineScheduler['schedule']> | undefined;
            try { await Promise.race([broker.stop(), new Promise<never>((_resolve, reject) => {
              timeout = scheduler.schedule(closeDeadline, () => reject(new CommandBrowserClosureError([new Error('command-duo-close-unproved')])));
            })]); } catch (error) { errors.push(error); }
            finally { timeout?.cancel(); }
          }
          if (context !== undefined && lifecycle !== undefined) {
            try { await closeContextWithProof({ clock, scheduler, closeProofMs: Math.max(0, closeDeadline - clock.monotonicMs()) }, context, lifecycle, 'sharepoint', 'poisoned'); }
            catch (error) { nativeErrors.push(error); }
          } else if (nativeLaunch.state === 'launching' || nativeLaunch.state === 'rejected-uncertain' || nativeLaunch.state === 'opened')
            nativeErrors.push(new Error('command-native-launch-unproved'));
          try { gate?.dispose(); } catch (error) { errors.push(error); }
          if (nativeErrors.length === 0) {
            try { launch?.closed(); proven = true; if (reserved) { profileReservations.delete(directory); reserved = false; } } catch (error) { nativeErrors.push(error); }
          }
          if (nativeErrors.length > 0) {
            try { launch?.uncertain(new CommandBrowserClosureError(nativeErrors)); } catch (error) { nativeErrors.push(error); }
          }
          if (errors.length || nativeErrors.length) retain([...errors, ...nativeErrors]);
        })();
        const interrupted = () => { if (context !== undefined && setupReady) void close().catch((error: unknown) => { entry.failure = error instanceof CommandBrowserClosureError ? error : new CommandBrowserClosureError([error]); }); };
        controller.signal.addEventListener('abort', interrupted, { once: true });
        let result: { value: Result } | undefined, primary: { error: unknown } | undefined, callbackStarted = false;
        try {
          assertFastDuoReady(config, input.duo); assertCurrent();
          const fingerprint = browserSignInFingerprint(config, input.protectedSecrets, 'sharepoint', 'prod', input.duo);
          const known = roots.inventory().roots.find(row => join(admission.captureBrowserRegistryContext().machineRoot, row.directory) === directory && row.profileId === profileId);
          if (known !== undefined) {
            assertCurrent();
            const cleanupSignal = new AbortController().signal;
            await roots.withUnused(directory, createNativeBrowserProbe({ launcher, clock, scheduler, closeProofMs: config.browser.closeProofMs,
              launchTimeoutMs: config.timeouts.sessionAcquireMs, signal: cleanupSignal }), async unused => {
                unused.remove(); unused.assertCurrent();
                const parent = dirname(directory);
                assertPrivateProfilePath(config.paths.browserProfileRoot, parent);
                rmdirSync(parent); fsyncPath(config.paths.browserProfileRoot);
              }, rootInput);
            assertCurrent();
          }
          rootInput = { ...rootInput, credentialFingerprint: fingerprint };
          launch = roots.beginLaunch(rootInput); profileReservations.add(directory); reserved = true;
          assertPrivateProfilePath(config.paths.browserProfileRoot, directory);
          mkdirSync(dirname(directory), { recursive: true, mode: 0o700 });
          const extensionDirectory = join(directory, 'relay-extension');
          if (config.features.duoWebAuthn) { mkdirSync(directory, { recursive: true, mode: 0o700 }); stageFastDuoExtension(config.paths.duoExtensionDir, extensionDirectory, 'workflow'); }
          assertCurrent(); nativeLaunch = { state: 'launching' };
          const outcome = await launcher.launch({ profileDirectory: directory, headless: config.browser.headless, extensionDirectory,
            ...(config.features.duoWebAuthn ? {} : { nativeOnly: true }), acceptDownloads: true, downloadsPath: config.paths.downloadsDir,
            viewport: { width: config.display.screenWidth, height: config.display.screenHeight }, timeoutMs: Math.max(1, deadline - clock.monotonicMs()) }).then(
            (opened): NativeLaunchOutcome => ({ state: 'opened', context: opened }),
            (error: unknown): NativeLaunchOutcome => chromiumProfileInUse(error)
              ? { state: 'profile-in-use', error } : { state: 'rejected-uncertain', error },
          );
          nativeLaunch = outcome;
          if (outcome.state !== 'opened') throw outcome.error;
          context = outcome.context;
          lifecycle = observeContextLifecycle(context); launch.opened(); assertCurrent();
          gate = composeDuoCeremonyGateFactory({ config, duo: input.duo, leases: options.leases, clock, scheduler }).openGate({
            commandId: input.commandId, system: 'sharepoint', envelopeDeadlineMonotonicMs: deadline,
            cancelCeremony: error => controller.abort(error), signal: controller.signal });
          const credentials = { userId: requireSecret('ucpathUserId', input.protectedSecrets), password: requireSecret('ucpathPassword', input.protectedSecrets) };
          assertCurrent();
          if (config.features.duoWebAuthn) {
            const source = input.duo;
            if (source === undefined) throw new CommandBrowserError('COMMAND_BROWSER_UNAVAILABLE');
            broker = await provisionWorkflowDuo({ context, config, source, accountName: credentials.userId,
              assertOwner: assertCurrent, assertSigningScope: () => {
                assertCurrent(); assertDuoCeremonyLeaseToken(signing, { system: 'sharepoint' });
                if (signing.holder.commandId !== input.commandId || signing.holder.workerId !== undefined || signing.credentialKey !== source.identity()
                  || clock.nowMs() >= Date.parse(signing.expiresAt)) throw new CommandBrowserError('COMMAND_BROWSER_UNAVAILABLE');
              } });
          }
          assertCurrent();
          const page = context.pages()[0] ?? await context.newPage(); setupReady = true; assertCurrent();
          callbackStarted = true;
          result = { value: await use({ page, signal: controller.signal, assertCurrent, credentials, duoCeremony: gate,
            acquisitionRemainingMs: () => Math.max(0, deadline - clock.monotonicMs()),
            assertDuoCurrent: () => { assertCurrent(); broker?.assertCurrent(); },
            recordEvidence: evidence => { assertCurrent(); if (evidence.system !== 'sharepoint') throw new CommandBrowserError('COMMAND_BROWSER_UNAVAILABLE');
              options.recordEvidence({ commandId: input.commandId, system: 'sharepoint', phase: 'authenticated' }); },
            withDuoSigningScope: async (token, operation) => {
              assertCurrent(); assertDuoCeremonyLeaseToken(token, { system: 'sharepoint' });
              if (signing !== undefined || token.holder.commandId !== input.commandId || token.holder.workerId !== undefined) throw new CommandBrowserError('COMMAND_BROWSER_UNAVAILABLE');
              signing = token; try { const value = await operation(); assertCurrent(); return value; } finally { signing = undefined; }
            } }) };
          assertCurrent();
        } catch (error) { primary = { error: callbackStarted || error instanceof CommandBrowserError || error === controller.signal.reason || hasUnprovedSourceClosure(error)
          ? error : new CommandBrowserError('COMMAND_BROWSER_UNAVAILABLE', { cause: error }) }; }
        finally {
          timer.cancel(); controller.signal.removeEventListener('abort', interrupted);
          try { await close(); }
          catch (cleanup) { primary = { error: primary === undefined ? cleanup : new CommandBrowserClosureError([primary.error, cleanup]) }; }
        }
        if (!proven && entry.failure === undefined) retain([primary?.error ?? new Error('command-browser-close-unproved')]);
        if (primary !== undefined) throw primary.error;
        if (result === undefined) throw new CommandBrowserError('COMMAND_BROWSER_UNAVAILABLE');
        return result.value;
    };
    const scope: CommandBrowserScope = { signal: controller.signal, assertCurrent,
      withBrowser: use => {
        if (browserCompletion !== undefined) return Promise.reject(new CommandBrowserError('COMMAND_BROWSER_BUSY'));
        const result = executeBrowser(use);
        browserCompletion = result.then(() => undefined, (error: unknown) => { browserFailure = { error }; });
        return result;
      } };
    let outcome: { value: T } | undefined, failure: { error: unknown } | undefined;
    try { assertCurrent(); outcome = { value: await body(scope) }; assertCurrent(); }
    catch (error) { failure = { error }; }
    finally {
      await browserCompletion;
      if (browserFailure !== undefined && browserFailure.error !== failure?.error) failure = { error: failure === undefined
        ? browserFailure.error : new AggregateError([failure.error, browserFailure.error], 'command-browser-operation-failed') };
      if (failure !== undefined && (hasUnprovedSourceClosure(failure.error) || failure.error instanceof CommandBrowserClosureError)) entry.failure = failure.error instanceof CommandBrowserClosureError ? failure.error : new CommandBrowserClosureError([failure.error]);
      input.signal.removeEventListener('abort', cancel); if (entry.failure === undefined) active = undefined; finished();
    }
    if (failure !== undefined) throw failure.error;
    if (outcome === undefined) throw new CommandBrowserError('COMMAND_BROWSER_UNAVAILABLE');
    return outcome.value;
  }
  return Object.freeze({ withCommand,
    withBrowser: <T>(input: CommandBrowserInput, use: (context: CommandBrowserContext) => Promise<T>) => withCommand(input, scope => scope.withBrowser(use)),
    hasUnquiescedWork(id: string): boolean { owner(id); return active !== undefined; },
    requestCancellation(id: string): void { owner(id); closing = true; active?.controller.abort(new CommandBrowserError('COMMAND_BROWSER_CANCELLED')); },
    async awaitCancellation(): Promise<void> { if (!closing) throw new CommandBrowserError('COMMAND_BROWSER_UNAVAILABLE'); const entry = active;
      if (entry !== undefined) { await entry.completion; if (entry.failure !== undefined) throw entry.failure; } },
  });
}
export type CommandBrowserManager = ReturnType<typeof createCommandBrowserManager>;
