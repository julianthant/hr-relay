import type { ChildProcess } from "node:child_process";
import { createServer, Server } from "node:net";
import { z } from "zod";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";

const LockMessageSchema = z.strictObject({ kind: z.literal("runtime-lifetime-lock"), port: z.number().int().positive().max(65535) });

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

export class RuntimeLifetimeLock {
  readonly #server: Server;
  #closing: Promise<void> | undefined;
  private constructor(server: Server, readonly port: number) { this.#server = server; }

  static async acquire(port: number): Promise<RuntimeLifetimeLock> {
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

  share(child: ChildProcess): Promise<void> {
    this.assertHeld();
    return new Promise<void>((resolve, reject) => {
      child.send({ kind: "runtime-lifetime-lock", port: this.port }, this.#server, error => {
        if (error !== null) reject(error);
        else resolve();
      });
    });
  }

  close(): Promise<void> { return this.#closing ??= closeListener(this.#server); }
}

export class WorkerRuntimeLifetimeLock {
  readonly #server: Server;
  #closing: Promise<void> | undefined;
  private constructor(server: Server, readonly port: number) { this.#server = server; }

  static receive(port: number, onDisconnect: () => void): Promise<WorkerRuntimeLifetimeLock> {
    LockMessageSchema.parse({ kind: "runtime-lifetime-lock", port });
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
        resolve(new WorkerRuntimeLifetimeLock(handle, port));
      };
      process.once("disconnect", disconnected);
      process.on("message", received);
    });
  }

  assertHeld(): void {
    if (!this.#server.listening) throw new RuntimeLifetimeLockReleasedError();
  }

  close(): Promise<void> { return this.#closing ??= closeListener(this.#server); }
}

export const acquireRuntimeLifetimeLock = RuntimeLifetimeLock.acquire;
export const receiveRuntimeLifetimeLock = WorkerRuntimeLifetimeLock.receive;
