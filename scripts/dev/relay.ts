import { spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, linkSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { applicationDataWorkspace, rebuildRuntimeIsolation } from "../../src/backend/app/config/runtime-isolation.js";
import { noSymlinkAncestry, readPrivateFile, removeExactPath, sameDirectory, statDirectory } from "../../src/backend/storage/configuration/credential-safe-file.js";
import { createPrivateDirectory, writePrivateStage } from "../../src/backend/storage/private-path.js";
import { observeProcessIdentity, ProcessStartIdentitySchema } from "../../src/backend/storage/sqlite/runtime-process-locks.js";
import { DashboardFailedSchema, DashboardStopSchema, DashboardStoppedSchema } from "../../src/models/runtime/dashboard-control.js";
import { windowsProgramFilesRoots } from "../../src/models/config/secrets.js";
import { publishWindowsPrivateFile } from "../../src/backend/storage/windows-private-path.js";
import { hasUnprovedSourceClosure } from "../../src/backend/storage/source-closure.js";
import { RelayPublicFailure, relayFailureReason } from "./relay-backend.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const TokenSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const BrokerSchema = z.strictObject({ port: z.number().int().positive().max(65535), token: TokenSchema,
  pid: z.number().int().positive(), identity: ProcessStartIdentitySchema });
const RequestSchema = z.strictObject({ action: z.enum(["stop", "open"]), nonce: TokenSchema, proof: TokenSchema });
const ResponseSchema = z.union([DashboardStoppedSchema, z.strictObject({ type: z.literal("relay-window-opened") }),
  z.strictObject({ type: z.literal("relay-launcher-failed"), reason: z.string().min(1).max(1024) })]);
const ReplySchema = z.strictObject({ nonce: TokenSchema, proof: TokenSchema, result: ResponseSchema });
type StopResult = z.infer<typeof ResponseSchema>;
type Phase = "starting" | "stop-pending" | "running" | "stopping" | "stopped";

function controlDirectory(): string { return join(applicationDataWorkspace(), "launcher"); }

function proof(token: string, message: readonly unknown[]): string {
  return createHmac("sha256", Buffer.from(token, "hex")).update(JSON.stringify(message)).digest("hex");
}

function equalProof(left: string, right: string): boolean { return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex")); }

function readBroker(directory: string) {
  if (!noSymlinkAncestry(directory, new Map())) return undefined;
  statDirectory(directory, "launcher", 0o700);
  const file = readPrivateFile(join(directory, "broker.json"), { label: "launcher", maxBytes: 4096,
    allowedLinkCounts: process.platform === "win32" ? [1] : [1, 2] });
  if (file === undefined) return undefined;
  try { return { ...file, value: BrokerSchema.parse(JSON.parse(file.bytes.toString("utf8"))) }; }
  catch (error) { throw new Error("relay-launcher-control-invalid", { cause: error }); }
}

function publishBroker(directory: string, bytes: Buffer): void {
  const stage = join(directory, `broker.${randomBytes(16).toString("hex")}.stage`);
  writePrivateStage(stage, bytes);
  const staged = readPrivateFile(stage, { label: "launcher", maxBytes: 4096 });
  if (staged === undefined) throw new Error("relay-launcher-control-unpublished");
  let releaseStage = true;
  try {
    const target = join(directory, "broker.json");
    if (process.platform === "win32") {
      try {
        publishWindowsPrivateFile(stage, target);
      } catch (error) { releaseStage = !hasUnprovedSourceClosure(error); throw new Error("relay-launcher-publication-failed", { cause: error }); }
    } else linkSync(stage, target);
  } finally { if (releaseStage) removeExactPath(stage, staged.identity, true, "relay-launcher-control-changed"); }
}

function removeBroker(directory: string, original: NonNullable<ReturnType<typeof readBroker>>): void {
  const current = readBroker(directory);
  if (current === undefined || !sameDirectory(current.identity, original.identity) || !current.bytes.equals(original.bytes)) throw new Error("relay-launcher-control-changed");
  removeExactPath(join(directory, "broker.json"), original.identity, false, "relay-launcher-control-changed");
}

function readFrame(socket: Socket, receive: (value: unknown) => void): void {
  let bytes = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    bytes = Buffer.concat([bytes, chunk]);
    if (bytes.length > 4096) { socket.destroy(new Error("relay-control-frame-too-large")); return; }
    const end = bytes.indexOf(10);
    if (end === -1) return;
    socket.removeAllListeners("data");
    if (end !== bytes.length - 1) { socket.destroy(new Error("relay-control-frame-invalid")); return; }
    try { receive(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end)))); }
    catch (error) { socket.destroy(error instanceof Error ? error : new Error("relay-control-frame-invalid")); }
  });
}

async function prepareBackend(): Promise<void> {
  const child = spawn(process.execPath, ["--import", "tsx", join(repositoryRoot, "scripts", "build", "windows-observer-policy.ts")],
    { cwd: repositoryRoot, stdio: "inherit" });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error("relay-build-preparation-failed"));
    });
  });
}

export async function openRelayWindow(directory: string, port: number = rebuildRuntimeIsolation.backendPort): Promise<void> {
  if (process.platform !== "win32") throw new Error("relay-edge-window-requires-windows");
  const bases = windowsProgramFilesRoots().filter((base): base is string => base !== undefined);
  if (bases.some(base => !isAbsolute(base))) throw new Error("relay-program-files-root-invalid");
  const edge = bases
    .map(base => join(base, "Microsoft", "Edge", "Application", "msedge.exe")).find(path => existsSync(path));
  if (edge === undefined) throw new Error("relay-microsoft-edge-not-found");
  const child = spawn(edge, [`--user-data-dir=${join(directory, "edge")}`, "--no-first-run", `--app=http://127.0.0.1:${port}`],
    { stdio: "ignore", detached: true });
  await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("spawn", resolve); });
  child.unref();
}

export interface RelayLauncherOptions {
  readonly directory?: string;
  readonly backendArguments?: readonly string[];
  readonly prepare?: () => Promise<void>;
  readonly openWindow?: (directory: string) => Promise<void>;
  readonly signals?: EventEmitter;
  readonly write?: (message: string) => void;
  readonly writeError?: (message: string) => void;
}

export async function startRelay(options: RelayLauncherOptions = {}): Promise<number> {
  const directory = options.directory ?? controlDirectory();
  const prior = readBroker(directory);
  if (prior !== undefined) {
    const observed = observeProcessIdentity(prior.value.pid);
    if (observed.state === "alive" && observed.identity.platform === prior.value.identity.platform
      && observed.identity.startToken === prior.value.identity.startToken) {
      const response = await requestBroker(directory, "open");
      if (response.type !== "relay-window-opened") throw new Error("relay-window-not-ready");
      return 0;
    }
    removeBroker(directory, prior);
  }
  if (!noSymlinkAncestry(dirname(directory), new Map())) createPrivateDirectory(dirname(directory), { recursive: true, mode: 0o700 });
  createPrivateDirectory(directory, { recursive: true, mode: 0o700 });
  statDirectory(directory, "launcher", 0o700);
  const self = observeProcessIdentity(process.pid);
  if (self.state !== "alive") throw new Error("relay-launcher-identity-unavailable");
  const token = randomBytes(32).toString("hex");
  const write = options.write ?? (message => { process.stdout.write(`${message}\n`); });
  const writeError = options.writeError ?? (message => { process.stderr.write(`${message}\n`); });
  const sockets = new Set<Socket>();
  const failures: unknown[] = [];
  const printedFailures = new Set<unknown>();
  let stop = (): void => { throw new Error("relay-launcher-not-initialized"); };
  let reopen = (): Promise<void> => Promise.reject(new Error("relay-window-not-ready"));
  let complete: ((result: StopResult) => void) | undefined;
  const outcome = new Promise<StopResult>(resolve => { complete = resolve; });
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => { sockets.delete(socket); });
    socket.on("error", () => { socket.destroy(); });
    socket.setTimeout(5000, () => { socket.destroy(new Error("relay-control-request-timeout")); });
    readFrame(socket, value => {
      const request = RequestSchema.safeParse(value);
      if (!request.success || !equalProof(request.data.proof, proof(token, ["relay-control", request.data.action, request.data.nonce]))) {
        socket.destroy(new Error("relay-control-refused")); return;
      }
      socket.setTimeout(0);
      const { action, nonce } = request.data;
      if (action === "stop") stop();
      const response: Promise<StopResult> = action === "stop" ? outcome : reopen().then(() => ({ type: "relay-window-opened" as const }), error => {
        const reason = relayFailureReason(error); writeError(reason); return { type: "relay-launcher-failed" as const, reason };
      });
      void response.then(result => { socket.end(`${JSON.stringify({ nonce, result, proof: proof(token, ["relay-result", action, nonce, result]) })}\n`, () => { socket.destroy(); }); });
    });
  });
  server.maxConnections = 16;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  server.on("error", error => { failures.push(error); stop(); });
  let owned: ReturnType<typeof readBroker>;
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("relay-launcher-listener-unproved");
    publishBroker(directory, Buffer.from(JSON.stringify(BrokerSchema.parse({
      port: address.port, token, pid: process.pid, identity: self.identity,
    }))));
    owned = readBroker(directory);
    if (owned === undefined) throw new Error("relay-launcher-control-unpublished");
    let phase: Phase = "starting";
    let report: z.infer<typeof DashboardStoppedSchema> | undefined;
    let windowOpened: Promise<void> | undefined;
    const windowFailures: unknown[] = [];
    let ready: ((ready: boolean) => void) | undefined;
    const readiness = new Promise<boolean>(resolve => { ready = resolve; });
    reopen = async () => {
      if (!await readiness || phase !== "running") throw new Error("relay-window-not-ready");
      await (options.openWindow ?? openRelayWindow)(directory);
      if (phase !== "running") throw new Error("relay-window-not-ready");
    };
    let child: ReturnType<typeof spawn> | undefined;
    stop = (): void => {
      if (phase === "starting") { phase = "stop-pending"; write("Relay is still starting; stop is queued."); return; }
      if (phase !== "running") return;
      phase = "stopping";
      if (child === undefined || !child.connected) { failures.push(new Error("relay-backend-ipc-disconnected")); return; }
      child.send(DashboardStopSchema.parse({ type: "relay-dashboard-stop" }), error => { if (error !== null) failures.push(error); });
      write("Relay is stopping; waiting for active work to drain.");
    };
    const signals = options.signals ?? process;
    signals.on("SIGINT", stop);
    signals.on("SIGTERM", stop);
    try {
      await (options.prepare ?? prepareBackend)();
      child = spawn(process.execPath, options.backendArguments ?? ["--import", "tsx", join(repositoryRoot, "scripts", "dev", "relay-backend.ts")],
        { cwd: repositoryRoot, stdio: ["ignore", "ignore", "ignore", "ipc"], detached: process.platform === "win32", windowsHide: true });
      const backend = child;
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
        backend.once("error", error => { failures.push(error); });
        backend.once("close", (code, signal) => {
          phase = "stopped";
          ready?.(false);
          resolve({ code, signal });
        });
      });
      backend.on("message", (message: unknown) => {
        const failed = DashboardFailedSchema.safeParse(message);
        if (failed.success) {
          ready?.(false); phase = "stopping";
          const failure = new RelayPublicFailure(failed.data.reason);
          failures.push(failure); printedFailures.add(failure); writeError(failed.data.reason); return;
        }
        const stopped = DashboardStoppedSchema.safeParse(message);
        if (stopped.success) {
          if (phase === "starting" || phase === "stop-pending") failures.push(new Error("relay-backend-stopped-before-readiness"));
          if (report !== undefined) failures.push(new Error("relay-backend-duplicate-stop-report"));
          report = stopped.data; return;
        }
        if (!z.strictObject({ type: z.literal("hrauto-dashboard-ready") }).safeParse(message).success) return;
        const pending = phase === "stop-pending";
        if (phase !== "starting" && !pending) return;
        phase = "running";
        ready?.(true);
        if (pending) { stop(); return; }
        windowOpened = Promise.resolve().then(() => (options.openWindow ?? openRelayWindow)(directory)).then(() => { write("Relay is ready. Use relay.cmd stop to shut down."); }, error => {
          windowFailures.push(error); writeError(`Relay window could not open: ${relayFailureReason(error)}`); stop();
        });
      });
      const exit = await closed;
      await windowOpened;
      if (exit.code !== 0 || exit.signal !== null) failures.push(new RelayPublicFailure(`The backend exited with code ${String(exit.code)}${exit.signal === null ? "" : ` (${exit.signal})`}.`));
      if (report === undefined) failures.push(new RelayPublicFailure("The backend did not provide a verified shutdown receipt."));
      const clean = exit.code === 0 && exit.signal === null && report !== undefined && failures.length === 0;
      const code = clean && windowFailures.length === 0 ? 0 : 1;
      removeBroker(directory, owned);
      owned = undefined;
      complete?.(clean && report !== undefined ? report : { type: "relay-launcher-failed", reason: "Relay did not prove a clean backend stop. Preserve its state and output." });
      for (const failure of failures) if (!printedFailures.has(failure)) writeError(relayFailureReason(failure));
      if (clean) write(windowFailures.length > 0 ? "Relay backend stopped cleanly; the app window could not open."
        : report?.state === "backup-unavailable" ? "Relay stopped. Windows backups are unavailable." : "Relay stopped.");
      else writeError("Relay did not complete a verified clean stop. Preserve its state and output.");
      return code;
    } finally {
      signals.removeListener("SIGINT", stop);
      signals.removeListener("SIGTERM", stop);
    }
  } finally {
    try { if (owned !== undefined) removeBroker(directory, owned); }
    finally {
      complete?.({ type: "relay-launcher-failed", reason: "The launcher operation failed before a verified backend stop." });
      await Promise.resolve();
      for (const socket of sockets) if (!socket.writableEnded) socket.destroy();
      await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(); }); });
    }
  }
}

async function requestBroker(directory: string, action: "stop" | "open"): Promise<StopResult> {
  const broker = readBroker(directory);
  if (broker === undefined) throw new Error("relay-launcher-not-running");
  const parent = observeProcessIdentity(broker.value.pid);
  if (parent.state !== "alive" || parent.identity.platform !== broker.value.identity.platform
    || parent.identity.startToken !== broker.value.identity.startToken) throw new Error("relay-launcher-owner-gone");
  const nonce = randomBytes(32).toString("hex");
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: broker.value.port });
    let received = false;
    socket.once("error", reject);
    socket.once("close", () => { if (!received) reject(new Error("relay-stop-closure-unproved")); });
    socket.once("connect", () => { socket.write(`${JSON.stringify({ action, nonce, proof: proof(broker.value.token, ["relay-control", action, nonce]) })}\n`); });
    readFrame(socket, value => {
      const reply = ReplySchema.parse(value);
      if (reply.nonce !== nonce || !equalProof(reply.proof, proof(broker.value.token, ["relay-result", action, nonce, reply.result]))) throw new Error("relay-stop-response-unauthenticated");
      received = true;
      const response = reply.result;
      if (response.type === "relay-launcher-failed") reject(new RelayPublicFailure(response.reason));
      else resolve(response);
      socket.end();
    });
  });
}

export async function stopRelay(directory = controlDirectory()): Promise<z.infer<typeof DashboardStoppedSchema>> {
  const result = await requestBroker(directory, "stop");
  if (result.type !== "relay-dashboard-stopped") throw new Error("relay-stop-closure-unproved");
  return result;
}

export async function runRelayCommand(args: readonly string[] = process.argv.slice(2), options: RelayLauncherOptions = {}): Promise<number> {
  const write = options.write ?? (message => { process.stdout.write(`${message}\n`); });
  try {
    if (args.length > 1 || args[0] !== undefined && args[0] !== "start" && args[0] !== "stop") throw new Error("relay-invalid-command");
    if (args[0] !== "stop") return await startRelay(options);
    write("Relay is stopping; waiting for active work to drain.");
    const result = await stopRelay(options.directory);
    write(result.state === "backup-unavailable" ? "Relay stopped. Windows backups are unavailable." : "Relay stopped.");
    return 0;
  } catch (error) {
    (options.writeError ?? (message => { process.stderr.write(`${message}\n`); }))(relayFailureReason(error));
    return 1;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  process.exitCode = await runRelayCommand();
}
