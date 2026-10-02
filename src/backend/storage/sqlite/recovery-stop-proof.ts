import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import type { Clock } from "../../../domain/clock.js";
import { systemClock } from "../../../domain/clock.js";
import { ActorIdSchema, FingerprintSchema } from "../../../domain/ids.js";
import {
  RecoveryRuntimeLockSnapshotSchema,
  StoppedSystemProofSchema,
  type RecoveryRuntimeLockSnapshot,
  type StoppedSystemProof,
} from "./recovery-contracts.js";

export const RecoveryStopProofStoreOptionsSchema = z.strictObject({
  processLockRoot: z.string().min(1),
  maxProofAgeMs: z.number().int().positive(),
});

export const StoppedSystemProofIssueRequestSchema = z.strictObject({
  observedBy: ActorIdSchema,
  sourceDatabaseIdentity: FingerprintSchema,
});

const RUNTIME_STATE_FILE = "recovery-runtime-locks.json";
const PENDING_DIRECTORY = "restore-proofs-pending";
const CONSUMED_DIRECTORY = "restore-proofs-consumed";

function fsyncPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function parseJsonFile<Schema extends z.ZodType>(path: string, schema: Schema): z.output<Schema> {
  return schema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function stateFingerprint(state: RecoveryRuntimeLockSnapshot): string {
  return FingerprintSchema.parse(createHash("sha256")
    .update("hrauto:recovery-runtime-lock-state:v1\0")
    .update(canonicalJsonStringify(state))
    .digest("hex"));
}

export class RecoveryStopProofStore {
  #root: string;
  #maxProofAgeMs: number;
  #clock: Clock;

  constructor(input: unknown, clock: Clock = systemClock) {
    const options = RecoveryStopProofStoreOptionsSchema.parse(input);
    this.#root = resolve(options.processLockRoot);
    this.#maxProofAgeMs = options.maxProofAgeMs;
    this.#clock = clock;
  }

  recordRuntimeState(input: unknown): RecoveryRuntimeLockSnapshot {
    const state = RecoveryRuntimeLockSnapshotSchema.parse(input);
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    const temporaryPath = join(this.#root, `.recovery-runtime-locks-${randomUUID()}.tmp`);
    const finalPath = join(this.#root, RUNTIME_STATE_FILE);
    try {
      writeFileSync(temporaryPath, `${canonicalJsonStringify(state)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fsyncPath(temporaryPath);
      renameSync(temporaryPath, finalPath);
      fsyncPath(this.#root);
      return state;
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  }

  issue(input: unknown): StoppedSystemProof {
    const request = StoppedSystemProofIssueRequestSchema.parse(input);
    const state = this.#readCurrentState();
    this.#assertCurrentAndStopped(state, request.sourceDatabaseIdentity);
    const proof = StoppedSystemProofSchema.parse({
      state: "stopped",
      proofId: randomUUID(),
      observedAt: this.#clock.now().toISOString(),
      observedBy: request.observedBy,
      sourceDatabaseIdentity: request.sourceDatabaseIdentity,
      runtimeNamespace: state.runtimeNamespace,
      runtimeGeneration: state.runtimeGeneration,
      runtimeStateFingerprint: stateFingerprint(state),
      processLockGenerations: {
        server: state.processLocks.server.generation,
        workers: state.processLocks.workers.generation,
      },
    });
    const pendingDirectory = join(this.#root, PENDING_DIRECTORY);
    const consumedDirectory = join(this.#root, CONSUMED_DIRECTORY);
    mkdirSync(pendingDirectory, { recursive: true, mode: 0o700 });
    mkdirSync(consumedDirectory, { recursive: true, mode: 0o700 });
    const proofPath = join(pendingDirectory, `${proof.proofId}.json`);
    writeFileSync(proofPath, `${canonicalJsonStringify(proof)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fsyncPath(proofPath);
    fsyncPath(pendingDirectory);
    return proof;
  }

  consume(input: unknown): StoppedSystemProof {
    const proof = StoppedSystemProofSchema.parse(input);
    this.#assertProofCurrent(proof);
    return this.#consumeIssuedProof(proof);
  }

  /**
   * Consume the exact persisted proof after comparing a fresh live observation
   * under restore admission. `recordedAt` is deliberately excluded from the
   * live comparison: it says when the second observation happened, while the
   * proof fingerprint remains bound to the exact issued snapshot on disk.
   */
  consumeAgainstLiveSnapshot(
    input: unknown,
    liveInput: unknown,
  ): StoppedSystemProof {
    const proof = StoppedSystemProofSchema.parse(input);
    const live = RecoveryRuntimeLockSnapshotSchema.parse(liveInput);
    this.#assertIssuedProofMatches(proof);
    this.#assertProofCurrent(proof);
    this.#assertCurrentAndStopped(live, proof.sourceDatabaseIdentity);
    if (proof.runtimeNamespace !== live.runtimeNamespace
      || proof.runtimeGeneration !== live.runtimeGeneration
      || proof.processLockGenerations.server !== live.processLocks.server.generation
      || proof.processLockGenerations.workers !== live.processLocks.workers.generation) {
      throw new Error(
        `stopped-system proof ${proof.proofId} does not match current runtime and process-lock generations`,
      );
    }
    return this.#consumeIssuedProof(proof);
  }

  #consumeIssuedProof(proof: StoppedSystemProof): StoppedSystemProof {
    const ageMs = this.#clock.nowMs() - Date.parse(proof.observedAt);
    if (ageMs < 0) throw new Error(`stopped-system proof ${proof.proofId} was observed in the future`);
    if (ageMs > this.#maxProofAgeMs) {
      throw new Error(`stopped-system proof ${proof.proofId} is stale at ${String(ageMs)}ms old`);
    }
    const pendingDirectory = join(this.#root, PENDING_DIRECTORY);
    const consumedDirectory = join(this.#root, CONSUMED_DIRECTORY);
    const pendingPath = join(pendingDirectory, `${proof.proofId}.json`);
    const consumedPath = join(consumedDirectory, `${proof.proofId}.json`);
    if (existsSync(consumedPath)) throw new Error(`stopped-system proof ${proof.proofId} was already consumed`);
    if (!existsSync(pendingPath)) throw new Error(`stopped-system proof ${proof.proofId} was not issued by the current runtime`);
    const issued = parseJsonFile(pendingPath, StoppedSystemProofSchema);
    if (canonicalJsonStringify(issued) !== canonicalJsonStringify(proof)) {
      throw new Error(`stopped-system proof ${proof.proofId} does not match its issued one-time record`);
    }
    try {
      linkSync(pendingPath, consumedPath);
    } catch (error) {
      throw new Error(`stopped-system proof ${proof.proofId} could not be consumed exactly once`, { cause: error });
    }
    unlinkSync(pendingPath);
    fsyncPath(pendingDirectory);
    fsyncPath(consumedDirectory);
    return proof;
  }

  #assertIssuedProofMatches(proof: StoppedSystemProof): void {
    const pendingPath = join(this.#root, PENDING_DIRECTORY, `${proof.proofId}.json`);
    const consumedPath = join(this.#root, CONSUMED_DIRECTORY, `${proof.proofId}.json`);
    if (existsSync(consumedPath)) {
      throw new Error(`stopped-system proof ${proof.proofId} was already consumed`);
    }
    if (!existsSync(pendingPath)) {
      throw new Error(`stopped-system proof ${proof.proofId} was not issued by the current runtime`);
    }
    const issued = parseJsonFile(pendingPath, StoppedSystemProofSchema);
    if (canonicalJsonStringify(issued) !== canonicalJsonStringify(proof)) {
      throw new Error(`stopped-system proof ${proof.proofId} does not match its issued one-time record`);
    }
  }

  #assertProofCurrent(proof: StoppedSystemProof): void {
    const ageMs = this.#clock.nowMs() - Date.parse(proof.observedAt);
    if (ageMs < 0) throw new Error(`stopped-system proof ${proof.proofId} was observed in the future`);
    if (ageMs > this.#maxProofAgeMs) {
      throw new Error(`stopped-system proof ${proof.proofId} is stale at ${String(ageMs)}ms old`);
    }
    const state = this.#readCurrentState();
    this.#assertCurrentAndStopped(state, proof.sourceDatabaseIdentity);
    if (proof.runtimeNamespace !== state.runtimeNamespace
      || proof.runtimeGeneration !== state.runtimeGeneration
      || proof.processLockGenerations.server !== state.processLocks.server.generation
      || proof.processLockGenerations.workers !== state.processLocks.workers.generation
      || proof.runtimeStateFingerprint !== stateFingerprint(state)) {
      throw new Error(`stopped-system proof ${proof.proofId} does not match current runtime and process-lock generations`);
    }
  }

  #readCurrentState(): RecoveryRuntimeLockSnapshot {
    const path = join(this.#root, RUNTIME_STATE_FILE);
    if (!existsSync(path)) {
      throw new Error(`rebuild recovery runtime-lock state ${basename(path)} does not exist`);
    }
    return parseJsonFile(path, RecoveryRuntimeLockSnapshotSchema);
  }

  #assertCurrentAndStopped(state: RecoveryRuntimeLockSnapshot, sourceDatabaseIdentity: string): void {
    if (state.sourceDatabaseIdentity !== sourceDatabaseIdentity) {
      throw new Error("rebuild recovery runtime-lock state belongs to a different authority database");
    }
    const ageMs = this.#clock.nowMs() - Date.parse(state.recordedAt);
    if (ageMs < 0) throw new Error("rebuild recovery runtime-lock state was recorded in the future");
    if (ageMs > this.#maxProofAgeMs) {
      throw new Error(`rebuild recovery runtime-lock state is stale at ${String(ageMs)}ms old`);
    }
    for (const [name, lock] of Object.entries(state.processLocks)) {
      if (lock.state === "active") {
        throw new Error(`rebuild ${name} process lock generation ${String(lock.generation)} is active for pid ${String(lock.pid)}`);
      }
    }
  }
}
