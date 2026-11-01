import { privatePathRejects } from "../../storage/private-path.js";
import type { ProfileBrowserClosure, RetainedBrowserProfile } from "../../storage/maintenance/profile-inventory.js";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext } from "playwright";
import { z } from "zod";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { AbsolutePathSchema } from "../../../models/config/schema.js";
import { BrowserSystemIdSchema, PositiveIntSchema, type BrowserSystemId } from "../../../rules/identity/ids.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";
import type { BrowserSessionCloseReason } from "../../../workflow-kit/session.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../../storage/source-closure.js";
import { createTimeoutDeadlineScheduler } from "../scheduling/timeout-deadline-scheduler.js";

export class NativeBrowserClosureUnprovedError extends AuthoritySourceClosureUnprovedError {
  readonly code = "BROWSER_CLOSURE_UNPROVED";
  constructor(errors: readonly unknown[]) { super(errors); this.name = "NativeBrowserClosureUnprovedError"; this.message = ERROR_CATALOG.BROWSER_CLOSURE_UNPROVED.text; }
}

// Keep the acquisition scheduler structural so both ports use the same timer without a module cycle.
export interface BrowserDeadlineScheduler {
  schedule(deadlineMonotonicMs: number, onDeadline: () => void): { cancel: () => void };
}

/** The Playwright launch seam, so a unit test can drive open/close without a real browser. */
export interface PersistentContextLauncher {
  launch(input: Readonly<{
    profileDirectory: string;
    headless: boolean;
    extensionDirectory: string;
    acceptDownloads: boolean;
    downloadsPath: string;
    viewport: Readonly<{ width: number; height: number }>;
    timeoutMs?: number;
    nativeOnly?: true;
    disablePasswordManager?: true;
    defaultContextOptions?: true;
  }>): Promise<BrowserContext>;
}

export class BrowserProfileStillClosingError extends Error {
  readonly code = "BROWSER_PROFILE_STILL_CLOSING";
  constructor(cause: unknown) { super(ERROR_CATALOG.BROWSER_PROFILE_STILL_CLOSING.text, { cause }); this.name = "BrowserProfileStillClosingError"; }
}

export const PROFILE_CUSTODY_UNAVAILABLE_TEXT = "Browser profile custody is unavailable. The browser cannot open until its current profile revision is admitted.";
export class ProfileCustodyUnavailableError extends Error {
  readonly code = "browser-profile-custody-unavailable";
  constructor() { super(PROFILE_CUSTODY_UNAVAILABLE_TEXT); this.name = "ProfileCustodyUnavailableError"; }
}

export const DEFAULT_BROWSER_LAUNCHER: PersistentContextLauncher = {
  async launch(input) {
    return chromium.launchPersistentContext(input.profileDirectory, {
      // The extension requires the full bundled Chromium; the headless shell
      // cannot load one (duo-autopilot/README.md).
      channel: "chromium",
      headless: input.headless,
      ...(input.timeoutMs === undefined ? {} : { timeout: input.timeoutMs }),
      acceptDownloads: input.acceptDownloads,
      ...(input.defaultContextOptions === true && input.nativeOnly !== true ? {} : { downloadsPath: input.downloadsPath, viewport: input.viewport }),
      args: [
        ...(input.nativeOnly === true ? ["--disable-extensions"] : [`--disable-extensions-except=${input.extensionDirectory}`, `--load-extension=${input.extensionDirectory}`]),
        ...(input.disablePasswordManager === true ? ["--disable-features=PasswordManagerOnboarding,PasswordImport,PasswordManagerEnabled"] : []),
      ],
    });
  },
};

export interface ContextLifecycle {
  readonly closed: () => boolean;
}

export function observeContextLifecycle(context: BrowserContext): ContextLifecycle {
  let closed = false;
  context.on("close", () => {
    closed = true;
  });
  return { closed: () => closed };
}

export async function closeContextWithProof(
  options: Readonly<{ clock: Clock; scheduler: BrowserDeadlineScheduler; closeProofMs: number }>,
  context: BrowserContext, lifecycle: ContextLifecycle, system: string, reason: BrowserSessionCloseReason,
): Promise<void> {
  const { clock, scheduler, closeProofMs } = options;
  const deadline = clock.monotonicMs() + closeProofMs;
  let expire = (): void => undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    const handle = scheduler.schedule(deadline, () => {
      reject(new Error(
        `${system} browser session close (${reason}) did not complete within its ${String(closeProofMs)}ms proof deadline`,
      ));
    });
    expire = (): void => handle.cancel();
  });
  const pages = context.pages();
  try {
    await Promise.race([
      (async (): Promise<void> => {
        for (const page of pages) await page.close({ runBeforeUnload: false });
        await context.close();
      })(),
      timedOut,
    ]);
  } finally {
    expire();
  }
  const openPages = pages.filter((page) => !page.isClosed());
  if (openPages.length > 0) {
    throw new Error(
      `${system} browser session close (${reason}) left ${String(openPages.length)} page(s) open; closure cannot be proven`,
    );
  }
  if (context.pages().length > 0) {
    throw new Error(
      `${system} browser session close (${reason}) left new pages open; closure cannot be proven`,
    );
  }
  if (!lifecycle.closed()) {
    throw new Error(
      `${system} browser session close (${reason}) never emitted its context close event; closure cannot be proven`,
    );
  }
}

export function workerProfileDirectory(input: Readonly<{ profileRoot: string; slotOrdinal: number; system: BrowserSystemId }>): string {
  return resolve(AbsolutePathSchema.parse(input.profileRoot), `w${String(PositiveIntSchema.parse(input.slotOrdinal))}`, BrowserSystemIdSchema.parse(input.system));
}

export function onboardingProfileDirectory(profileRoot: string, owner: Readonly<{
  operationId: string; profileId: string; accountId: string; generation: number;
}>): string {
  const operationId=z.uuid().parse(owner.operationId),profileId=z.uuid().parse(owner.profileId),accountId=z.uuid().parse(owner.accountId);
  const generation=PositiveIntSchema.parse(owner.generation);
  return resolve(AbsolutePathSchema.parse(profileRoot),`onboarding-${operationId}-${profileId}-${accountId}-g${String(generation)}`);
}

export async function probeClosedBrowserProfile(input: Readonly<{
  profileRoot: string;
  launch: Omit<Parameters<PersistentContextLauncher["launch"]>[0], "headless" | "acceptDownloads">;
  clock: Clock; scheduler: BrowserDeadlineScheduler; closeProofMs: number; signal: AbortSignal;
  launcher?: PersistentContextLauncher;
}>): Promise<void> {
  input.signal.throwIfAborted();
  const root = AbsolutePathSchema.parse(input.profileRoot), directory = AbsolutePathSchema.parse(input.launch.profileDirectory);
  z.number().positive().finite().parse(input.closeProofMs);
  assertPrivateProfilePath(root, directory);
  for (const path of [root, directory]) {
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (info === undefined || !info.isDirectory()) throw new ProfileCustodyUnavailableError();
  }
  if (profileReservations.has(directory)) throw new ProfileCustodyUnavailableError();
  profileReservations.add(directory);
  let context: BrowserContext | undefined;
  try {
    context = await (input.launcher ?? DEFAULT_BROWSER_LAUNCHER).launch({ ...input.launch, headless: true, acceptDownloads: false, nativeOnly: true });
    const lifecycle = observeContextLifecycle(context);
    await closeContextWithProof(input, context, lifecycle, "native profile probe", "profile-reset");
    profileReservations.delete(directory);
  } catch (error) {
    if (error instanceof Error && ["Failed to create a ProcessSingleton for your profile directory.", "Opening in existing browser session."]
      .some(message => error.message.includes(message))) {
      profileReservations.delete(directory);
      throw new BrowserProfileStillClosingError(error);
    }
    throw new NativeBrowserClosureUnprovedError([retainAuthoritySourceClosure([error], { directory: { context, profileDirectory: directory } })]);
  }
  input.signal.throwIfAborted();
}

export const profileReservations = new Set<string>();

export function assertPrivateProfilePath(root: string, path: string): void {
  if (!path.startsWith(`${root}${sep}`)) throw new ProfileCustodyUnavailableError();
  for (let cursor = path; cursor !== dirname(cursor); cursor = dirname(cursor)) {
    const metadata = lstatSync(cursor, { throwIfNoEntry: false });
    if (metadata !== undefined && (!metadata.isDirectory() || metadata.isSymbolicLink()
      || privatePathRejects(cursor, metadata, "private"))) throw new ProfileCustodyUnavailableError();
    if (cursor === root) return;
  }
  throw new ProfileCustodyUnavailableError();
}

const MAX_PROBE_BYTES = 65_536;
const ProbePathSchema = z.string().min(1).max(4096).refine(path => isAbsolute(path) && resolve(path) === path);
export const NativeProfileProbeRequestSchema = z.strictObject({
  version: z.literal(1), nonce: z.uuid(),
  profiles: z.array(z.strictObject({ profileRoot: ProbePathSchema, profileDirectory: ProbePathSchema })).min(1).max(64),
  launchTimeoutMs: z.number().int().min(1).max(2_147_483_647), closeProofMs: z.number().int().min(1).max(2_147_483_647),
}).superRefine((request, context) => {
  if (new Set(request.profiles.map(profile => profile.profileDirectory)).size !== request.profiles.length) {
    context.addIssue({ code: "custom", message: "native profile request contains duplicate directories" });
  }
});
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const NativeProfileProbeResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ version: z.literal(1), nonce: z.uuid(), requestDigest: DigestSchema,
    state: z.literal("closed"), closedDirectories: z.array(ProbePathSchema).min(1).max(64) }),
  z.strictObject({ version: z.literal(1), nonce: z.uuid(), requestDigest: DigestSchema,
    state: z.literal("busy"), closedDirectories: z.array(ProbePathSchema).max(64), code: z.literal("BROWSER_PROFILE_STILL_CLOSING") }),
  z.strictObject({ version: z.literal(1), nonce: z.uuid().nullable(), requestDigest: DigestSchema.nullable(),
    state: z.literal("closure-unproved"), closedDirectories: z.array(ProbePathSchema).max(64), code: z.literal("BROWSER_CLOSURE_UNPROVED") }),
]);
type ProbeRequest = z.output<typeof NativeProfileProbeRequestSchema>;
function requestDigest(request: ProbeRequest): string { return createHash("sha256").update(JSON.stringify(request)).digest("hex"); }

export async function runNativeProfileProbeChild(): Promise<void> {
  let request: ProbeRequest | undefined;
  const closedDirectories: string[] = [];
  let result: z.output<typeof NativeProfileProbeResultSchema>;
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) {
      const value: unknown = chunk;
      if (!(value instanceof Uint8Array)) throw new Error("native-profile-request-not-bytes");
      size += value.byteLength;
      if (size > MAX_PROBE_BYTES) throw new Error("native-profile-request-oversize");
      chunks.push(Buffer.from(value));
    }
    request = NativeProfileProbeRequestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
    for (const profile of request.profiles) {
      assertPrivateProfilePath(profile.profileRoot, profile.profileDirectory);
      for (const path of [profile.profileRoot, profile.profileDirectory]) if (!lstatSync(path).isDirectory()) throw new ProfileCustodyUnavailableError();
    }
    for (const profile of request.profiles) {
      await probeClosedBrowserProfile({ profileRoot: profile.profileRoot,
        launch: { profileDirectory: profile.profileDirectory, extensionDirectory: "", downloadsPath: profile.profileDirectory,
          viewport: { width: 800, height: 600 }, timeoutMs: request.launchTimeoutMs },
        clock: systemClock, scheduler: createTimeoutDeadlineScheduler(systemClock), closeProofMs: request.closeProofMs,
        signal: new AbortController().signal });
      closedDirectories.push(profile.profileDirectory);
    }
    result = { version: 1, nonce: request.nonce, requestDigest: requestDigest(request), state: "closed", closedDirectories };
  } catch (error) {
    if (request !== undefined && error instanceof BrowserProfileStillClosingError) {
      result = { version: 1, nonce: request.nonce, requestDigest: requestDigest(request), state: "busy", closedDirectories, code: "BROWSER_PROFILE_STILL_CLOSING" };
    } else {
      result = { version: 1, nonce: request?.nonce ?? null, requestDigest: request === undefined ? null : requestDigest(request),
        state: "closure-unproved", closedDirectories, code: "BROWSER_CLOSURE_UNPROVED" };
      process.exitCode = 1;
    }
  }
  await new Promise<void>((done, reject) => process.stdout.write(`${JSON.stringify(NativeProfileProbeResultSchema.parse(result))}\n`, error => error === null || error === undefined ? done() : reject(error)));
}

export function assertNativeBrowserProfilesClosed(
  profiles: readonly Readonly<{ profileRoot: string; profileDirectory: string }>[],
  deadlines: Readonly<{ launchTimeoutMs: number; closeProofMs: number }>,
): void {
  if (profiles.length === 0) return;
  let request: ProbeRequest;
  try { request=NativeProfileProbeRequestSchema.parse({ version: 1, nonce: randomUUID(), profiles, ...deadlines }); }
  catch(error) { throw new NativeBrowserClosureUnprovedError([error]); }
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > MAX_PROBE_BYTES) throw new NativeBrowserClosureUnprovedError([new Error("native-profile-request-oversize")]);
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", join(repoRoot, "scripts", "dev", "secure-env-bootstrap.ts"), "native-profile-probe"], {
    cwd: repoRoot, input, encoding: "utf8", maxBuffer: MAX_PROBE_BYTES,
    timeout: Math.min(2_147_483_647, 10_000 + request.profiles.length * (request.launchTimeoutMs + request.closeProofMs)),
  });
  const unproved = () => new NativeBrowserClosureUnprovedError([new Error("native-profile-child-completion-unproved")]);
  if (result.error !== undefined || result.status !== 0 || result.signal !== null) throw unproved();
  let reply: z.output<typeof NativeProfileProbeResultSchema>;
  try { reply = NativeProfileProbeResultSchema.parse(JSON.parse(result.stdout)); } catch { throw unproved(); }
  const directories = request.profiles.map(profile => profile.profileDirectory);
  if (reply.nonce !== request.nonce || reply.requestDigest !== requestDigest(request)
    || reply.closedDirectories.some((directory, index) => directory !== directories[index])) throw unproved();
  if (reply.state === "busy") throw new BrowserProfileStillClosingError(new Error("native-profile-child-busy"));
  if (reply.state !== "closed" || reply.closedDirectories.length !== directories.length) throw unproved();
}

function nativeProbeProfiles(profiles: readonly RetainedBrowserProfile[]) {
  return profiles.filter(profile => {
    assertPrivateProfilePath(profile.profileRoot, profile.profileDirectory);
    if (lstatSync(profile.profileDirectory, { throwIfNoEntry: false }) !== undefined) return true;
    if (!profile.cleanupCompleted) throw new NativeBrowserClosureUnprovedError([new Error("retained-browser-profile-missing-without-owned-cleanup")]);
    return false;
  }).map(({ profileRoot, profileDirectory }) => ({ profileRoot, profileDirectory }));
}

export const profileBrowserClosure: ProfileBrowserClosure = {
  workerDirectory: workerProfileDirectory,
  assertClosed(profiles, timing) {
    assertNativeBrowserProfilesClosed(nativeProbeProfiles(profiles), timing);
  },
  async probeClosed(profiles, timing, clock, signal) {
    for (const profile of nativeProbeProfiles(profiles)) {
      await probeClosedBrowserProfile({ profileRoot: profile.profileRoot,
        launch: { profileDirectory: profile.profileDirectory, extensionDirectory: "", downloadsPath: profile.profileDirectory,
          viewport: { width: 800, height: 600 }, timeoutMs: timing.launchTimeoutMs },
        clock, scheduler: createTimeoutDeadlineScheduler(clock), closeProofMs: timing.closeProofMs, signal });
    }
  },
};
