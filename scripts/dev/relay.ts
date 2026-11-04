import { spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { applicationDataWorkspace, rebuildRuntimeIsolation } from "../../src/backend/app/config/runtime-isolation.js";
import { noSymlinkAncestry, readPrivateFile, removeExactPath, sameDirectory, statDirectory } from "../../src/backend/storage/configuration/credential-safe-file.js";
import { createPrivateDirectory, writePrivateStage } from "../../src/backend/storage/private-path.js";
import { observeProcessIdentity, ProcessStartIdentitySchema } from "../../src/backend/storage/sqlite/runtime-process-locks.js";
import { DashboardStopSchema, DashboardStoppedSchema } from "../../src/models/runtime/dashboard-control.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const TokenSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const BrokerSchema = z.strictObject({ port: z.number().int().positive().max(65535), token: TokenSchema,
  pid: z.number().int().positive(), identity: ProcessStartIdentitySchema });
const RequestSchema = z.strictObject({ action: z.literal("stop"), nonce: TokenSchema, proof: TokenSchema });
const ResponseSchema = z.union([DashboardStoppedSchema, z.strictObject({ type: z.literal("relay-launcher-failed") })]);
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
  const file = readPrivateFile(join(directory, "broker.json"), { label: "launcher", maxBytes: 4096 });
  return file === undefined ? undefined : { ...file, value: BrokerSchema.parse(JSON.parse(file.bytes.toString("utf8"))) };
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
  const child = spawn(process.execPath, ["--import", "tsx", join(repositoryRoot, "scripts", "build", "generate-workflow-manifest.ts")],
    { cwd: repositoryRoot, stdio: "inherit" });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error("relay-build-preparation-failed"));
    });
  });
}

export async function openRelayWindow(directory: string): Promise<void> {
  if (process.platform !== "win32") throw new Error("relay-edge-window-requires-windows");
  const bases = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles];
  const edge = bases.filter((base): base is string => base !== undefined && isAbsolute(base))
    .map(base => join(base, "Microsoft", "Edge", "Application", "msedge.exe")).find(path => existsSync(path));
  if (edge === undefined) throw new Error("relay-microsoft-edge-not-found");
  const child = spawn(edge, [`--user-data-dir=${join(directory, "edge")}`, "--no-first-run", `--app=http://127.0.0.1:${rebuildRuntimeIsolation.backendPort}`],
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
}

export async function startRelay(options: RelayLauncherOptions = {}): Promise<number> {
  const directory = options.directory ?? controlDirectory();
  const prior = readBroker(directory);
  if (prior !== undefined) {
    const observed = observeProcessIdentity(prior.value.pid);
    if (observed.state === "alive" && observed.identity.platform === prior.value.identity.platform
      && observed.identity.startToken === prior.value.identity.startToken) throw new Error("relay-already-running-use-relay-stop");
    removeBroker(directory, prior);
  }
  if (!noSymlinkAncestry(dirname(directory), new Map())) createPrivateDirectory(dirname(directory), { recursive: true, mode: 0o700 });
  createPrivateDirectory(directory, { recursive: true, mode: 0o700 });
  statDirectory(directory, "launcher", 0o700);
  const self = observeProcessIdentity(process.pid);
  if (self.state !== "alive") throw new Error("relay-launcher-identity-unavailable");
  const token = randomBytes(32).toString("hex");
  const write = options.write ?? (message => { process.stdout.write(`${message}\n`); });
  const sockets = new Set<Socket>();
  const failures: unknown[] = [];
  let stop = (): void => { throw new Error("relay-launcher-not-initialized"); };
  let complete: ((result: StopResult) => void) | undefined;
  const outcome = new Promise<StopResult>(resolve => { complete = resolve; });
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => { sockets.delete(socket); });
    socket.on("error", () => { socket.destroy(); });
    socket.setTimeout(5000, () => { socket.destroy(new Error("relay-control-request-timeout")); });
    readFrame(socket, value => {
      const request = RequestSchema.safeParse(value);
      if (!request.success || !equalProof(request.data.proof, proof(token, ["relay-stop", request.data.nonce]))) {
        socket.destroy(new Error("relay-control-refused")); return;
      }
      socket.setTimeout(0);
      stop();
      const nonce = request.data.nonce;
      void outcome.then(result => { socket.end(`${JSON.stringify({ nonce, result, proof: proof(token, ["relay-stopped", nonce, result]) })}\n`, () => { socket.destroy(); }); });
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
    writePrivateStage(join(directory, "broker.json"), Buffer.from(JSON.stringify(BrokerSchema.parse({
      port: address.port, token, pid: process.pid, identity: self.identity,
    }))));
    owned = readBroker(directory);
    if (owned === undefined) throw new Error("relay-launcher-control-unpublished");
    let phase: Phase = "starting";
    let report: z.infer<typeof DashboardStoppedSchema> | undefined;
    let windowOpened: Promise<void> | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    stop = (): void => {
      if (phase === "starting") { phase = "stop-pending"; return; }
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
        { cwd: repositoryRoot, stdio: ["ignore", "inherit", "inherit", "ipc"] });
      const backend = child;
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
        backend.once("error", error => { failures.push(error); });
        backend.once("close", (code, signal) => {
          phase = "stopped";
          resolve({ code, signal });
        });
      });
      backend.on("message", (message: unknown) => {
        const stopped = DashboardStoppedSchema.safeParse(message);
        if (stopped.success) {
          if (report !== undefined) failures.push(new Error("relay-backend-duplicate-stop-report"));
          report = stopped.data; return;
        }
        if (!z.strictObject({ type: z.literal("hrauto-dashboard-ready") }).safeParse(message).success) return;
        const pending = phase === "stop-pending";
        if (phase !== "starting" && !pending) return;
        phase = "running";
        if (pending) { stop(); return; }
        windowOpened = Promise.resolve().then(() => (options.openWindow ?? openRelayWindow)(directory)).then(() => { write("Relay is ready. Use relay.cmd stop to shut down."); }, error => {
          failures.push(error); stop();
        });
      });
      const exit = await closed;
      await windowOpened;
      const code = exit.code === 0 && exit.signal === null && report !== undefined && failures.length === 0 ? 0 : 1;
      removeBroker(directory, owned);
      owned = undefined;
      complete?.(code === 0 && report !== undefined ? report : { type: "relay-launcher-failed" });
      if (code === 0) write(report?.state === "backup-unavailable" ? "Relay stopped. Windows backups are unavailable." : "Relay stopped.");
      else write("Relay did not complete a verified clean stop. Preserve its state and logs.");
      return code;
    } finally {
      signals.removeListener("SIGINT", stop);
      signals.removeListener("SIGTERM", stop);
    }
  } finally {
    try { if (owned !== undefined) removeBroker(directory, owned); }
    finally {
      complete?.({ type: "relay-launcher-failed" });
      await Promise.resolve();
      for (const socket of sockets) if (!socket.writableEnded) socket.destroy();
      await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(); }); });
    }
  }
}

export async function stopRelay(directory = controlDirectory()): Promise<z.infer<typeof DashboardStoppedSchema>> {
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
    socket.once("connect", () => { socket.write(`${JSON.stringify({ action: "stop", nonce, proof: proof(broker.value.token, ["relay-stop", nonce]) })}\n`); });
    readFrame(socket, value => {
      const reply = ReplySchema.parse(value);
      if (reply.nonce !== nonce || !equalProof(reply.proof, proof(broker.value.token, ["relay-stopped", nonce, reply.result]))) throw new Error("relay-stop-response-unauthenticated");
      received = true;
      const response = reply.result;
      if (response.type === "relay-launcher-failed") reject(new Error("relay-stop-closure-unproved"));
      else resolve(response);
      socket.end();
    });
  });
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args[0] !== undefined && args[0] !== "start" && args[0] !== "stop") throw new Error("usage: relay.cmd [start|stop]");
  if (args[0] === "stop") {
    const result = await stopRelay();
    process.stdout.write(result.state === "backup-unavailable" ? "Relay stopped. Windows backups are unavailable.\n" : "Relay stopped.\n");
  } else process.exitCode = await startRelay();
}
