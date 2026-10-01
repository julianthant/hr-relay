import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import { PreflightAdmissionRefusal, type PreflightAdmission, type PreflightAdmissionScope } from "../../domain/preflight-admission.js";
import { PreflightRerunCommandRequestSchema, PreflightRerunCommandResultWireSchema, PreflightSelectionSchema, type PreflightReadinessWire, type PreflightSelection } from "../../domain/preflight-contract.js";
import type { createPreflightAuthority } from "../../domain/preflight.js";
import type { InstanceSelection } from "../../domain/run/envelope.js";
import type { z } from "zod";

type Result = z.infer<typeof PreflightRerunCommandResultWireSchema>;
export interface PreflightReportRuntime {
  readonly admission: Pick<PreflightAdmission, "read" | "prepare">;
  currentScope(workflowId?: string, requestedInstance?: InstanceSelection): PreflightAdmissionScope;
}

/** One bounded read-only replay namespace across dashboard and workflow scopes. */
export function createPreflightReportService(input: Readonly<{
  dashboard: ReturnType<typeof createPreflightAuthority>; runtime: PreflightReportRuntime; clock: Clock;
}>) {
  const commands = new Map<string, { identity: string; result: Promise<Result> }>();
  const lastCompleted = new Map<string, Extract<PreflightReadinessWire, { state: "present" }>["report"]>();
  const current = (selection: PreflightSelection) => input.runtime.currentScope(selection.workflowId, selection.requestedInstance);
  const remember = (selection: PreflightSelection, report: Extract<PreflightReadinessWire, { state: "present" }>["report"]): void => {
    const key = canonicalJsonStringify(selection);
    lastCompleted.delete(key);
    if (lastCompleted.size >= 256) lastCompleted.delete(lastCompleted.keys().next().value as string);
    lastCompleted.set(key, report);
  };
  return Object.freeze({
    read(selection?: PreflightSelection): PreflightReadinessWire {
      const selected = selection === undefined ? undefined : PreflightSelectionSchema.parse(selection);
      let previous = selected === undefined ? undefined : lastCompleted.get(canonicalJsonStringify(selected));
      try {
        if (selected !== undefined) {
          const report = input.runtime.admission.read(current(selected));
          remember(selected, report);
          return { state: "present", report };
        }
        const report = input.dashboard.readLatest();
        previous = report;
        if (input.runtime.currentScope().configFingerprint !== report.configFingerprint) throw new PreflightAdmissionRefusal("stale", "Settings changed; re-check readiness.");
        const age = input.clock.nowMs() - Date.parse(report.checkedAt);
        if (age < 0 || age >= 60_000) throw new PreflightAdmissionRefusal("stale", "Preflight evidence expired; re-check readiness.");
        return { state: "present", report };
      } catch (error) {
        if (error instanceof PreflightAdmissionRefusal) return { state: "unavailable", reason: error.message, ...(previous === undefined ? {} : { lastCompleted: previous }) };
        throw error;
      }
    },
    async execute(raw: unknown, signal: AbortSignal): Promise<Result> {
      const command = PreflightRerunCommandRequestSchema.parse(raw);
      const identity = canonicalJsonStringify(command);
      const existing = commands.get(command.commandId);
      if (existing !== undefined) {
        if (existing.identity !== identity) throw new PreflightAdmissionRefusal("scope-mismatch", "Preflight command was replayed with a divergent request.");
        return existing.result;
      }
      if (commands.size >= 256) throw new PreflightAdmissionRefusal("unavailable", "Preflight command capacity reached; restart the runtime.");
      const result = Promise.resolve().then(async (): Promise<Result> => {
        const selection = command.target.selection;
        if (selection === undefined) {
          // New commands cannot claim the old boot report after a settings change.
          const scope = input.runtime.currentScope();
          if (scope.configFingerprint !== command.target.expectedConfigFingerprint) throw new PreflightAdmissionRefusal("scope-mismatch", "Preflight configuration changed.");
          return input.dashboard.execute(command, signal);
        }
        const scope = current(selection);
        if (scope.configFingerprint !== command.target.expectedConfigFingerprint || scope.descriptorFingerprint !== command.target.expectedDescriptorFingerprint) {
          throw new PreflightAdmissionRefusal("scope-mismatch", "Preflight configuration or descriptor changed.");
        }
        const report = await input.runtime.admission.prepare(scope, signal);
        if (canonicalJsonStringify(current(selection)) !== canonicalJsonStringify(scope)) throw new PreflightAdmissionRefusal("stale", "Settings changed during preflight; re-check readiness.");
        remember(selection, report);
        return PreflightRerunCommandResultWireSchema.parse({ state: "completed", commandId: command.commandId, report });
      });
      commands.set(command.commandId, { identity, result });
      return result;
    },
  });
}
