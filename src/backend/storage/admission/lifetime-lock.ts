import { assertSourceClosuresProved, rememberUnprovedSourceClosure } from "../source-closure.js";
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import type { ChildProcess } from "node:child_process";
import { createServer, Server } from "node:net";
import { z } from "zod";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";

const LockMessageSchema = z.strictObject({ kind: z.literal("runtime-lifetime-lock"), port: z.number().int().positive().max(65535), workspace: z.string().min(1) });

export class RuntimeAlreadyRunningError extends Error {
  readonly code = "RUNTIME_ALREADY_RUNNING";
  constructor(cause: unknown) {
    super(ERROR_CATALOG.RUNTIME_ALREADY_RUNNING.text, { cause });
    this.name = "RuntimeAlreadyRunningError";
  }
}

export class RuntimeLifetimeLockReleasedError extends Error {
  readonly code = "RUNTIME_LIFETIME_LOCK_RELEASED";
  constructor() {
    super(ERROR_CATALOG.RUNTIME_LIFETIME_LOCK_RELEASED.text);
    this.name = "RuntimeLifetimeLockReleasedError";
  }
}

function closeListener(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => server.close(error => {
    if (error !== undefined) reject(error);
    else resolve();
  }));
}

export class OfflineMaintenanceOperationUnavailableError extends Error {
  readonly code = "RUNTIME_OFFLINE_OPERATION_UNAVAILABLE";
  constructor(readonly reason: "offline-maintenance-unissued" | "offline-maintenance-busy" | "offline-maintenance-already-consumed") {
    super(`${ERROR_CATALOG.RUNTIME_OFFLINE_OPERATION_UNAVAILABLE.text} (${reason})`);
    this.name = "OfflineMaintenanceOperationUnavailableError";
  }
}

export type OfflineMaintenanceOperation = Readonly<{ operationId: string; assertHeld(): void; assertAvailable(): void; consume(): void; release(): void }>;
const maintenanceToken = Symbol("stopped-maintenance");

class StoppedMaintenance {
  readonly operationId = randomUUID();
  readonly #root: RuntimeLifetimeLock;
  readonly #workspace: string;
  readonly #release: () => void;
  #consumed = false;
  #expired = false;

  constructor(token: typeof maintenanceToken, root: RuntimeLifetimeLock, workspace: string, release: () => void) {
    if (token !== maintenanceToken) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-unissued");
    this.#root = root;
    this.#workspace = workspace;
    this.#release = release;
    Object.freeze(this);
  }

  static active(operation: OfflineMaintenanceOperation): operation is StoppedMaintenance {
    return typeof operation === "object" && operation !== null && #root in operation && !operation.#expired;
  }

  static workspace(operation: OfflineMaintenanceOperation): string {
    if (!StoppedMaintenance.active(operation)) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-unissued");
    operation.#root.assertOfflineMaintenance(operation, operation.#workspace);
    return operation.#workspace;
  }

  static ownedBy(operation: OfflineMaintenanceOperation, root: RuntimeLifetimeLock, workspace: string): boolean {
    return StoppedMaintenance.active(operation) && operation.#root === root && operation.#workspace === workspace;
  }

  readonly assertHeld = (): void => { StoppedMaintenance.workspace(this); };
  readonly assertAvailable = (): void => {
    this.assertHeld();
    if (this.#consumed) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-already-consumed");
  };
  readonly consume = (): void => { this.assertAvailable(); this.#consumed = true; };
  readonly release = (): void => {
    if (this.#expired) return;
    this.assertHeld();
    this.#release();
    this.#expired = true;
  };
}

export function isOfflineMaintenanceOperationActive(operation: OfflineMaintenanceOperation): boolean {
  return StoppedMaintenance.active(operation);
}

export function offlineMaintenanceWorkspace(operation: OfflineMaintenanceOperation): string {
  return StoppedMaintenance.workspace(operation);
}

export function assertOfflineMaintenanceOperation(operation: OfflineMaintenanceOperation, workspace: string): void {
  if (StoppedMaintenance.workspace(operation) !== workspace) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-unissued");
}

export class RuntimeLifetimeLock {
  readonly #server: Server;
  readonly #sourceFailures = new Set<unknown>();
  #closing: Promise<void> | undefined;
  readonly #port: number;
  readonly #children = new Set<ChildProcess>();
  #exclusiveAdmission = false;
  #exclusiveOperation: { operation: OfflineMaintenanceOperation; completion: Promise<void> } | undefined;
  #workspace: string | undefined;
  #startup: "initializing" | "ready" | "failed" | undefined;
  private constructor(server: Server, port: number) { this.#server = server; this.#port = port; }
  get port(): number { return this.#port; }
  retainSourceClosure(error: unknown): void { rememberUnprovedSourceClosure(this.#sourceFailures, error); }

  static async acquire(this: void, port: number): Promise<RuntimeLifetimeLock> {
    z.number().int().nonnegative().max(65535).parse(port);
    const server = createServer(socket => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error): void => {
        server.removeListener("listening", ready);
        reject("code" in error && error.code === "EADDRINUSE" ? new RuntimeAlreadyRunningError(error) : error);
      };
      const ready = (): void => { server.removeListener("error", failed); resolve(); };
      server.once("error", failed);
      server.once("listening", ready);
      server.listen({ port, host: "127.0.0.1", exclusive: true });
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new RuntimeLifetimeLockReleasedError();
    return new RuntimeLifetimeLock(server, address.port);
  }

  assertHeld(): void {
    if (!this.#server.listening) throw new RuntimeLifetimeLockReleasedError();
  }

  assertRuntimeAvailable(): void {
    this.assertHeld(); assertSourceClosuresProved(this.#sourceFailures);
    if (this.#closing !== undefined) throw new RuntimeLifetimeLockReleasedError();
    if (this.#exclusiveOperation !== undefined) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-busy");
  }

  bindWorkspace(workspace: string): void {
    this.assertHeld();
    if (resolvePath(workspace) !== workspace || realpathSync(workspace) !== workspace) throw new Error("runtime-lifetime-workspace-invalid");
    if (this.#workspace !== undefined && this.#workspace !== workspace) throw new Error("runtime-lifetime-workspace-unproved");
    this.#workspace = workspace;
  }

  assertExclusiveWorkspaceTarget(workspace: string): void {
    if (this.#closing !== undefined) throw new Error("runtime-lifetime-closing");
    this.bindWorkspace(workspace);
    if (this.#startup === "initializing" || this.#startup === "failed") throw new Error("runtime-lifetime-workspace-unproved");
    if (this.#children.size !== 0) throw new Error("runtime-lifetime-owned-children-unclosed");
  }

  initializeWorkspace(workspace: string, startup: () => void): void {
    if (this.#closing !== undefined) throw new Error("runtime-lifetime-closing");
    this.bindWorkspace(workspace);
    if (this.#startup !== undefined) { this.assertWorkspace(workspace); return; }
    this.#startup = "initializing";
    try {
      const completed: unknown = startup();
      if (completed !== undefined) throw new Error("runtime-lifetime-startup-must-be-synchronous");
      this.assertHeld(); this.#startup = "ready";
    }
    catch (error) { this.retainSourceClosure(error); this.#startup = "failed"; throw error; }
  }

  assertWorkspace(workspace: string): void {
    this.assertHeld();
    if (this.#startup !== "ready" || this.#workspace !== workspace) throw new Error("runtime-lifetime-workspace-unproved");
  }

  assertExclusiveWorkspace(workspace: string): void {
    this.assertWorkspace(workspace);
    if (this.#children.size !== 0) throw new Error("runtime-lifetime-owned-children-unclosed");
  }

  assertAdmissionOperation(operation: OfflineMaintenanceOperation | undefined, workspace: string): void {
    this.assertHeld();
    if (this.#closing !== undefined) throw new Error("runtime-lifetime-closing");
    if (this.#exclusiveOperation !== undefined) {
      if (operation === undefined || this.#exclusiveOperation.operation !== operation) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-unissued");
      this.assertOfflineMaintenance(operation, workspace);
    } else if (operation !== undefined) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-unissued");
  }

  retainExclusiveAdmission(workspace: string, operation?: OfflineMaintenanceOperation): () => void {
    this.assertExclusiveWorkspace(workspace);
    if (this.#exclusiveAdmission || this.#closing !== undefined) throw new Error("installation lease busy");
    if (this.#exclusiveOperation !== undefined) {
      if (operation === undefined || this.#exclusiveOperation.operation !== operation) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-unissued");
      this.assertOfflineMaintenance(operation, workspace);
    } else if (operation !== undefined) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-unissued");
    this.#exclusiveAdmission = true;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#exclusiveAdmission = false;
    };
  }

  beginOfflineMaintenance(workspace: string): OfflineMaintenanceOperation {
    assertSourceClosuresProved(this.#sourceFailures);
    this.assertExclusiveWorkspaceTarget(workspace);
    if (this.#exclusiveOperation !== undefined) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-busy");
    let finish: () => void = () => { throw new Error("offline-maintenance-completion-unissued"); };
    const completion = new Promise<void>(resolve => { finish = resolve; });
    const operation = new StoppedMaintenance(maintenanceToken, this, workspace, () => {
      this.assertOfflineMaintenance(operation, workspace);
      this.#exclusiveOperation = undefined;
      finish();
    });
    this.#exclusiveOperation = { operation, completion };
    return operation;
  }

  assertOfflineMaintenance(operation: OfflineMaintenanceOperation, workspace: string): void {
    this.assertHeld(); assertSourceClosuresProved(this.#sourceFailures);
    if (this.#workspace !== workspace || this.#exclusiveOperation?.operation !== operation
      || !StoppedMaintenance.ownedBy(operation, this, workspace)) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-unissued");
    if (this.#children.size !== 0) throw new Error("runtime-lifetime-owned-children-unclosed");
  }

  assertStartupWorkspace(workspace: string): void {
    this.assertHeld();
    if (this.#startup !== "initializing" || this.#workspace !== workspace) throw new Error("runtime-lifetime-startup-unproved");
  }

  share(child: ChildProcess): Promise<void> {
    this.assertHeld(); assertSourceClosuresProved(this.#sourceFailures);
    if (this.#closing !== undefined) throw new Error("runtime-lifetime-closing");
    if (this.#startup !== "ready" || this.#workspace === undefined) throw new Error("runtime-lifetime-workspace-unproved");
    if (this.#exclusiveAdmission || this.#exclusiveOperation !== undefined) throw new Error("runtime-lifetime-exclusive-lease-held");
    if (!child.connected || child.exitCode !== null || child.signalCode !== null || this.#children.has(child)) throw new Error("runtime-lifetime-child-transfer-invalid");
    this.#children.add(child);
    child.once("close", () => { this.#children.delete(child); });
    return new Promise<void>((resolve, reject) => {
      child.send({ kind: "runtime-lifetime-lock", port: this.port, workspace: this.#workspace }, this.#server, error => {
        if (error !== null) reject(error);
        else resolve();
      });
    });
  }

  async awaitOwnedChildrenClosed(): Promise<void> {
    this.assertHeld(); assertSourceClosuresProved(this.#sourceFailures);
    while (this.#children.size !== 0) await Promise.all([...this.#children].map(child => new Promise<void>(resolve => { child.once("close", () => resolve()); })));
    this.assertHeld(); assertSourceClosuresProved(this.#sourceFailures);
  }

  close(): Promise<void> {
    try { assertSourceClosuresProved(this.#sourceFailures); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error("runtime source closure unproved", { cause: error })); }
    return this.#closing ??= (async () => {
      if (this.#exclusiveOperation !== undefined) await this.#exclusiveOperation.completion;
      assertSourceClosuresProved(this.#sourceFailures);
      await this.awaitOwnedChildrenClosed();
      assertSourceClosuresProved(this.#sourceFailures);
      await closeListener(this.#server);
      assertSourceClosuresProved(this.#sourceFailures);
    })();
  }
}

export class WorkerRuntimeLifetimeLock {
  readonly #server: Server;
  readonly #sourceFailures = new Set<unknown>();
  readonly #disconnected: () => void;
  #closing: Promise<void> | undefined;
  readonly #port: number;
  readonly #workspace: string;
  private constructor(server: Server, port: number, workspace: string, disconnected: () => void) {
    this.#server = server; this.#port = port; this.#workspace = workspace; this.#disconnected = disconnected;
  }
  get port(): number { return this.#port; }
  retainSourceClosure(error: unknown): void { rememberUnprovedSourceClosure(this.#sourceFailures, error); }

  static receive(this: void, port: number, onDisconnect: () => void): Promise<WorkerRuntimeLifetimeLock> {
    z.number().int().positive().max(65535).parse(port);
    if (process.send === undefined || !process.connected) return Promise.reject(new Error("runtime-parent-channel-required"));
    return new Promise<WorkerRuntimeLifetimeLock>((resolve, reject) => {
      const failed = (): void => {
        process.removeListener("message", received);
        process.removeListener("disconnect", disconnected);
        reject(new Error("runtime-lifetime-lock-transfer-invalid"));
      };
      const disconnected = (): void => {
        process.removeListener("message", received);
        onDisconnect();
        reject(new Error("runtime-parent-disconnected-before-lock"));
      };
      const received = (message: unknown, handle: unknown): void => {
        const parsed = LockMessageSchema.safeParse(message);
        if (!parsed.success || parsed.data.port !== port || !(handle instanceof Server)) {
          if (handle instanceof Server) handle.close();
          failed();
          return;
        }
        const address = handle.address();
        if (!process.connected || address === null || typeof address === "string"
          || address.address !== "127.0.0.1" || address.port !== port) {
          handle.close();
          failed();
          return;
        }
        handle.on("connection", socket => socket.destroy());
        process.removeListener("message", received);
        try {
          if (resolvePath(parsed.data.workspace) !== parsed.data.workspace || realpathSync(parsed.data.workspace) !== parsed.data.workspace) throw new Error("runtime-lifetime-workspace-invalid");
        } catch { handle.close(); failed(); return; }
        resolve(new WorkerRuntimeLifetimeLock(handle, port, parsed.data.workspace, disconnected));
      };
      process.once("disconnect", disconnected);
      process.on("message", received);
    });
  }

  assertHeld(): void {
    if (!this.#server.listening) throw new RuntimeLifetimeLockReleasedError();
  }

  assertRuntimeAvailable(): void {
    this.assertHeld(); assertSourceClosuresProved(this.#sourceFailures);
    if (!process.connected || this.#closing !== undefined) throw new RuntimeLifetimeLockReleasedError();
  }

  assertWorkspace(workspace: string): void {
    this.assertHeld();
    if (workspace !== this.#workspace) throw new Error("runtime-lifetime-workspace-unproved");
  }

  close(): Promise<void> {
    try { assertSourceClosuresProved(this.#sourceFailures); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error("runtime source closure unproved", { cause: error })); }
    return this.#closing ??= (async () => {
      assertSourceClosuresProved(this.#sourceFailures);
      process.removeListener("disconnect", this.#disconnected);
      await closeListener(this.#server);
      assertSourceClosuresProved(this.#sourceFailures);
    })();
  }
}

export const acquireRuntimeLifetimeLock = RuntimeLifetimeLock.acquire;
export const receiveRuntimeLifetimeLock = WorkerRuntimeLifetimeLock.receive;
