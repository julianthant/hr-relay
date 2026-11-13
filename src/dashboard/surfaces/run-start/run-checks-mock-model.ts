import { mockParam } from "../../app/mock-surfaces.js";
import { CHECK_COPY } from "../settings/preflight/preflight-check-copy.js";

/** Design mock for the Checks step of the Run and Rerun dialog; read only from the URL (`runChecks=a|b`). */
export const RUN_CHECKS_DIRECTIONS = ["a", "b"] as const;
export type RunChecksDirection = (typeof RUN_CHECKS_DIRECTIONS)[number];

export const RUN_CHECKS_SCENARIOS = ["checking", "ready", "warnings", "fail-fix", "fail-nofix", "fail-many", "settings", "back"] as const;
export type RunChecksScenario = (typeof RUN_CHECKS_SCENARIOS)[number];

export type RunChecksKind = "run" | "rerun";
export type CheckVerdict = "checking" | "pass" | "warning" | "fail";

export interface RunCheckRow {
  readonly title: string;
  readonly description: string;
  readonly verdict: CheckVerdict;
  /** The Settings section a Fix button opens; absent means the failure cannot be fixed in Settings. */
  readonly fixSection?: string;
}

export interface RunChecksFrame {
  readonly direction: RunChecksDirection;
  readonly scenario: RunChecksScenario;
  readonly kind: RunChecksKind;
}

export function runChecksFrame(): RunChecksFrame | undefined {
  const direction = RUN_CHECKS_DIRECTIONS.find(id => id === mockParam("runChecks"));
  if (direction === undefined) return undefined;
  return {
    direction,
    scenario: RUN_CHECKS_SCENARIOS.find(id => id === mockParam("runChecksScenario")) ?? "fail-fix",
    kind: mockParam("runChecksKind") === "rerun" ? "rerun" : "run",
  };
}

const ORDER = ["runtime.compatibility", "browser.assets", "config.valid", "filesystem.health", "authority.health", "secrets.ucpath-sso", "ports.available"] as const;
type CheckId = (typeof ORDER)[number] | "fiscal.current";

/** What a failed or warned check says instead of its description; synthetic copy in the existing readiness voice. */
const PROBLEM: Partial<Record<CheckId, { description: string; fixSection?: string }>> = {
  "secrets.ucpath-sso": { description: "The UCPath password is missing.", fixSection: "credentials" },
  "filesystem.health": { description: "Relay cannot save here. Free up disk space.", fixSection: "storage" },
  "browser.assets": { description: "Relay is missing files. Download Relay again." },
  "fiscal.current": { description: "The fiscal year ends in 12 days." },
  "ports.available": { description: "Port 3938 is used by another program.", fixSection: "paths" },
};

const COPY = (id: CheckId) => CHECK_COPY[id];

function row(id: CheckId, verdict: CheckVerdict): RunCheckRow {
  const copy = COPY(id);
  const problem = verdict === "fail" || verdict === "warning" ? PROBLEM[id] : undefined;
  return { title: copy.name, description: problem?.description ?? copy.description, verdict, fixSection: verdict === "fail" ? problem?.fixSection : undefined };
}

export function checkRows(scenario: RunChecksScenario): readonly RunCheckRow[] {
  const verdicts: Partial<Record<CheckId, CheckVerdict>> = (() => {
    switch (scenario) {
      case "checking": return Object.fromEntries(ORDER.map(id => [id, "checking"]));
      case "warnings": return { "fiscal.current": "warning" };
      case "fail-fix":
      case "settings": return { "secrets.ucpath-sso": "fail" };
      case "fail-nofix": return { "browser.assets": "fail" };
      case "fail-many": return { "secrets.ucpath-sso": "fail", "filesystem.health": "fail", "browser.assets": "fail", "fiscal.current": "warning" };
      case "back": return { "secrets.ucpath-sso": "checking" };
      default: return {};
    }
  })();
  const ids: readonly CheckId[] = verdicts["fiscal.current"] === undefined ? ORDER : [...ORDER, "fiscal.current"];
  return ids.map(id => row(id, verdicts[id] ?? (scenario === "checking" ? "checking" : "pass")));
}

export const runChecksCounts = (rows: readonly RunCheckRow[]) => ({
  total: rows.length,
  ready: rows.filter(item => item.verdict === "pass").length,
  failed: rows.filter(item => item.verdict === "fail").length,
  warnings: rows.filter(item => item.verdict === "warning").length,
  checking: rows.filter(item => item.verdict === "checking").length,
});

export const RUN_CHECKS_STAGES = {
  a: { run: ["Checks", "Input", "Options", "Confirm"], rerun: ["Checks", "Steps", "Values", "Options", "Confirm"] },
  b: { run: ["Input", "Options", "Checks", "Confirm"], rerun: ["Steps", "Values", "Options", "Checks", "Confirm"] },
} as const satisfies Record<RunChecksDirection, Record<RunChecksKind, readonly string[]>>;

/** What the person typed before leaving for Settings; the frames that return show it kept. */
export const RUN_CHECKS_KEPT = { run: "3 people typed", rerun: "2 values copied" } as const;
