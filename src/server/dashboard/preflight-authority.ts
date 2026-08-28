import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import type { MonotonicDeadlineScheduler } from "../../core/deadline-scheduler.js";
import { startPreflightRunner } from "../../core/preflight-executor.js";
import { FingerprintSchema } from "../../domain/ids.js";
import {
  buildPreflightReport,
  PreflightReportSchema,
  PreflightRerunCommandRequestSchema,
  PreflightRerunCommandResultSchema,
  requiredPreflightChecks,
  type PreflightRunner,
} from "../../domain/preflight.js";
import {
  RuntimeCapabilitySchema,
  type PreflightCheckId,
  type RuntimeCapability,
} from "../../domain/runtime-dependencies.js";

/** Process-local command authority shared by bootstrap readback and explicit reruns. */
export interface PreflightAuthority {
  execute(input: unknown, signal: AbortSignal): Promise<z.infer<typeof PreflightRerunCommandResultSchema>>;
  hasSettlingDetectorIo(): boolean;
  refresh(signal: AbortSignal): Promise<z.infer<typeof PreflightReportSchema>>;
  readLatest(): z.infer<typeof PreflightReportSchema>;
}

interface CreatePreflightAuthorityInput {
  readonly configFingerprint: string;
  readonly descriptorFingerprint?: string;
  readonly requestedCapabilities: readonly RuntimeCapability[];
  readonly runners: readonly PreflightRunner[];
  readonly clock: Clock;
  readonly deadlineScheduler: MonotonicDeadlineScheduler;
}

type PreflightCommandResult = z.infer<typeof PreflightRerunCommandResultSchema>;
type RetainedPreflightCommand = Readonly<
  { requestJson: string; state: "pending"; result: Promise<PreflightCommandResult> }
  | { requestJson: string; state: "completed"; result: PreflightCommandResult }
  | { requestJson: string; state: "failed"; error: unknown }
>;

const MAX_RETAINED_COMMAND_IDENTITIES = 256;

/** One registry-selected preflight report authority for bootstrap and explicit reruns. */
export function createPreflightAuthority(input: CreatePreflightAuthorityInput): PreflightAuthority {
  const configFingerprint = FingerprintSchema.parse(input.configFingerprint);
  const selected = requiredPreflightChecks(input.requestedCapabilities);
  const requestedCapabilities = z.array(RuntimeCapabilitySchema).min(1).parse(input.requestedCapabilities);
  const runners = new Map<PreflightCheckId, PreflightRunner>();
  for (const runner of input.runners) {
    if (runners.has(runner.check)) throw new Error(`preflight authority received duplicate runner ${runner.check}`);
    runners.set(runner.check, runner);
  }
  const missing = selected.filter((check) => !runners.has(check));
  if (missing.length > 0) throw new Error(`preflight authority has no runner for selected checks: ${missing.join(", ")}`);
  const extra = [...runners.keys()].filter((check) => !selected.includes(check));
  if (extra.length > 0) throw new Error(`preflight authority received extra runners: ${extra.join(", ")}`);
  let latest: z.infer<typeof PreflightReportSchema> | undefined;
  const commands = new Map<string, RetainedPreflightCommand>();
  let refreshSettlementTail = Promise.resolve();
  let settlingAfterResponse = 0;

  const startRefresh = (signal: AbortSignal) => {
    const executions = selected.map((check) => {
      const runner = runners.get(check);
      if (runner === undefined) throw new Error(`preflight authority runner ${check} vanished after composition`);
      return startPreflightRunner(runner, signal, input.clock, input.deadlineScheduler);
    });
    const settlement = Promise.all(executions.map(({ settlement: runnerSettlement }) => runnerSettlement))
      .then(() => undefined);
    const result = Promise.all(executions.map(({ result: runnerResult }) => runnerResult)).then((observations) => {
      latest = buildPreflightReport({
        configFingerprint,
        ...(input.descriptorFingerprint === undefined
          ? {}
          : { descriptorFingerprint: input.descriptorFingerprint }),
        requestedCapabilities,
        observations,
        clock: input.clock,
      });
      return latest;
    });
    return Object.freeze({ result, settlement });
  };
  const refresh = (signal: AbortSignal): Promise<z.infer<typeof PreflightReportSchema>> => {
    if (settlingAfterResponse > 0) {
      return Promise.reject(new Error(
        "preflight refresh refused because previous detector I/O is still settling after its response",
      ));
    }
    let releaseAdmission = (): void => undefined;
    const admission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    const predecessor = refreshSettlementTail;
    refreshSettlementTail = admission;
    return predecessor.then(() => {
      let execution: ReturnType<typeof startRefresh>;
      try {
        execution = startRefresh(signal);
      } catch (error) {
        releaseAdmission();
        throw error;
      }
      let settlementFinished = false;
      let countedAsSettling = false;
      void execution.settlement.then(() => {
        settlementFinished = true;
        if (countedAsSettling) settlingAfterResponse -= 1;
        releaseAdmission();
      });
      return execution.result.finally(() => {
        if (!settlementFinished) {
          countedAsSettling = true;
          settlingAfterResponse += 1;
        }
      });
    }, (error: unknown) => {
      releaseAdmission();
      throw error;
    });
  };

  return Object.freeze({
    async execute(commandInput: unknown, signal: AbortSignal) {
      const command = PreflightRerunCommandRequestSchema.parse(commandInput);
      const requestJson = canonicalJsonStringify(command);
      const existing = commands.get(command.commandId);
      if (existing !== undefined) {
        if (existing.requestJson !== requestJson) {
          throw new Error(`preflight command ${command.commandId} was already used for a different request`);
        }
        if (existing.state === "failed") throw existing.error;
        return existing.result;
      }
      if (commands.size >= MAX_RETAINED_COMMAND_IDENTITIES) {
        throw new Error(
          `preflight retained command identity capacity ${String(MAX_RETAINED_COMMAND_IDENTITIES)} is exhausted; `
          + "restart the local dashboard before admitting another unique rerun command",
        );
      }
      const result = (async () => {
        if (command.target.expectedConfigFingerprint !== configFingerprint) {
          throw new Error(
            `preflight command ${command.commandId} expected config ${command.target.expectedConfigFingerprint} `
            + `but current config is ${configFingerprint}`,
          );
        }
        const completed = PreflightRerunCommandResultSchema.parse({
          state: "completed",
          commandId: command.commandId,
          report: await refresh(signal),
        });
        // Keep the exact parsed command result as bootstrap readback; nested
        // strict parsing normalizes optional keys, so retaining its source
        // object would give the two projections different JSON shapes.
        latest = completed.report;
        return completed;
      })();
      commands.set(command.commandId, { requestJson, state: "pending", result });
      void result.then(
        (completed) => {
          const retained = commands.get(command.commandId);
          if (retained?.state === "pending" && retained.result === result) {
            commands.set(command.commandId, { requestJson, state: "completed", result: completed });
          }
        },
        (error: unknown) => {
          const retained = commands.get(command.commandId);
          if (retained?.state === "pending" && retained.result === result) {
            commands.set(command.commandId, { requestJson, state: "failed", error });
          }
        },
      );
      return result;
    },
    hasSettlingDetectorIo() {
      return settlingAfterResponse > 0;
    },
    refresh,
    readLatest() {
      if (latest === undefined) throw new Error("preflight authority has not completed an initial report");
      return latest;
    },
  });
}
