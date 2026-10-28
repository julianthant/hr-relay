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

export async function acquireRuntimeLifetimeLock(port: number): Promise<Server> {
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
  return server;
}

export function shareRuntimeLifetimeLock(server: Server, child: ChildProcess): Promise<void> {
  const address = server.address();
  if (address === null || typeof address === "string" || address.address !== "127.0.0.1") {
    throw new Error("runtime-lifetime-lock-not-held");
  }
  return new Promise<void>((resolve, reject) => {
    child.send({ kind: "runtime-lifetime-lock", port: address.port }, server, error => {
      if (error !== null) reject(error);
      else resolve();
    });
  });
}

export function receiveRuntimeLifetimeLock(port: number, onDisconnect: () => void): Promise<Server> {
  LockMessageSchema.parse({ kind: "runtime-lifetime-lock", port });
  if (process.send === undefined || !process.connected) return Promise.reject(new Error("runtime-parent-channel-required"));
  return new Promise<Server>((resolve, reject) => {
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
      // Retain the listener through disconnect until the worker finishes its drain and exits.
      resolve(handle);
    };
    process.once("disconnect", disconnected);
    process.on("message", received);
  });
}
