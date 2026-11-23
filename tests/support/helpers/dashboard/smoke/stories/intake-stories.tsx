/** Intake workspace stories: the real workspace on a client that serves the fixture sessions, with each stage, tab, session state and command problem a person meets. */
import type { Page } from "@playwright/test";
import type { DashboardClient } from "../../../../../../src/dashboard/client/index.js";
import type { IntakeResource } from "../../../../../../src/dashboard/state/intake-wiring-adapter.js";
import { DashboardClientProvider } from "../../../../../../src/dashboard/state/client-context.js";
import { IntakeWorkspace } from "../../../../../../src/dashboard/surfaces/intake/intake.js";
import type { CommandProblem } from "../../../../../../src/dashboard/surfaces/intake/intake-command-model.js";
import type { IntakeTab, ManifestStage, RerunStage } from "../../../../../../src/dashboard/surfaces/intake/intake-model.js";
import type { IntakeSessionWire } from "../../../../../../src/models/intake/wire.js";
import { CommandResultSchema } from "../../../../../../src/rules/commands/commands.js";
import { RUN_DIALOG_ACTOR, intakeSession, never, runDialogClient } from "../../../../fixtures/dashboard/run-dialog-story-fixtures.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import type { StateRuleName } from "../state-rule-limits.js";
import { SceneBinding } from "./scene-binding.js";
import { StoryFrame } from "./story-frame.js";

const noop = () => undefined;
type SessionState = IntakeSessionWire["state"];

function IntakeScene({ client, sessionId }: { client: DashboardClient; sessionId: string }) {
  return <StoryFrame><DashboardClientProvider client={client}><SceneBinding>
    <IntakeWorkspace workflowLabel="Person Lookup" actorId={RUN_DIALOG_ACTOR} supportsDryRun sessionId={sessionId} onClose={noop} onEnqueued={noop} />
  </SceneBinding></DashboardClientProvider></StoryFrame>;
}

const served = (session: IntakeSessionWire, extra: Partial<DashboardClient> = {}) => runDialogClient({ intakeSession: async () => session, ...extra });
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`, "u") }).click();
const press = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();


interface Options { readonly then?: (page: Page) => Promise<void>; readonly extra?: Partial<Story> }
const scene = (title: string, client: () => DashboardClient, sessionId: string, { then, extra }: Options = {}): Story => ({
  title, render: () => <IntakeScene client={client()} sessionId={sessionId} />, ready: 'text="Spreadsheet intake"',
  play: async page => { await then?.(page); await page.mouse.move(0, 0); }, ...extra,
});
const MAPPING = intakeSession("mapping");
const VALIDATED = intakeSession("validated");
const of = (session: IntakeSessionWire, title: string, options?: Options) => scene(title, () => served(session), session.intakeSessionId, options);

const RESOURCE = {
  loading: scene("The session being read", () => runDialogClient({ intakeSession: never }), MAPPING.intakeSessionId, { extra: { slowFetch: { region: '[aria-label="Spreadsheet intake"]' } } }),
  failed: scene("A session that could not be read", () => runDialogClient({ intakeSession: async () => { throw new Error("read failed"); } }), MAPPING.intakeSessionId),
  loaded: of(MAPPING, "A session read, mapping open"),
} satisfies Record<IntakeResource["state"], Story>;

const SESSION = {
  mapping: of(MAPPING, "A file being mapped"),
  validated: of(VALIDATED, "A file validated, rejections to review"),
  enqueued: of(intakeSession("manifest"), "A file that already became runs", { then: page => tab(page, "Manifest") }),
  discarded: of(intakeSession("validated", { state: "discarded" }), "A session discarded"),
} satisfies Record<SessionState, Story>;

const TAB = {
  mapping: of(MAPPING, "Mapping tab", { then: page => tab(page, "Mapping") }),
  review: of(VALIDATED, "Review tab, rejections listed", { then: page => tab(page, "Review") }),
  manifest: of(VALIDATED, "Manifest tab before any run", { then: page => tab(page, "Manifest") }),
  rerun: of(VALIDATED, "Rerun diff tab", { then: page => tab(page, "Rerun diff") }),
} satisfies Record<IntakeTab, Story>;

const MANIFEST = {
  unavailable: of(intakeSession("mapping", { reservedManifestId: undefined }), "A manifest the session never reserved", { then: page => tab(page, "Manifest") }),
  reserved: of(VALIDATED, "A manifest reserved and not yet written", { then: page => tab(page, "Manifest") }),
  terminal: of(intakeSession("manifest"), "A manifest written", { then: page => tab(page, "Manifest") }),
} satisfies Record<ManifestStage["kind"], Story>;

const RERUN = {
  none: of(VALIDATED, "A file never run before", { then: page => tab(page, "Rerun diff") }),
  "same-plan": of(intakeSession("manifest"), "A file run before, nothing changed", { then: page => tab(page, "Rerun diff") }),
  changed: of(intakeSession("rerun"), "A file run before, mapping and rows changed", { then: page => tab(page, "Rerun diff") }),
} satisfies Record<RerunStage["kind"], Story>;

const answer = (reply: unknown) => async () => CommandResultSchema.parse(reply);
const COMMAND = "3a000000-0000-4000-8000-0000000000bb";
const validate = (title: string, extra: Partial<DashboardClient>): Story => scene(title, () => served(VALIDATED, extra), VALIDATED.intakeSessionId, { then: page => press(page, "Re-validate") });
const PROBLEM = {
  rejected: validate("Validate refused by the server", { executeCommand: answer({ state: "rejected", commandId: COMMAND, code: "invalid-state", message: "The session cannot be validated now." }) }),
  "confirmation-required": validate("Validate asking for confirmation", { executeCommand: answer({ state: "confirmation-required", commandId: COMMAND, warningDigest: "a".repeat(64), message: "Confirm the repeat warning." }) }),
  conflict: validate("Validate on a session that changed", { executeCommand: answer({ state: "conflict", commandId: COMMAND, currentVersion: 9, message: "The session changed." }) }),
  transport: validate("Validate that never reached the server", { executeCommand: async () => { throw new Error("offline"); } }),
} satisfies Record<CommandProblem["kind"], Story>;

const PENDING = {
  validate: validate("Validate sent, waiting on the answer", { executeCommand: never }),
} satisfies Record<string, Story>;

/** Rules today's intake breaks per story, each against the dashboard-audit-fixes umbrella ticket. Every workspace story names an internal term ("fingerprint") and holds tabs and fields no keyboard reaches. */
const AUDIT_TICKET = "#532";
const BASE: readonly StateRuleName[] = ["named-and-focusable", "no-banned-text"];
const BREAKS: Readonly<Record<string, readonly StateRuleName[]>> = {
  "resource/failed": ["word-limits"],
  "resource/loaded": BASE, "session/mapping": BASE, "tab/mapping": BASE, "tab/manifest": BASE, "tab/rerun": BASE, "manifest/reserved": BASE, "manifest/unavailable": BASE, "rerun/none": BASE,
  "rerun/changed": [...BASE, "fits-viewport"], "rerun/same-plan": [...BASE, "no-dead-disabled-control", "word-limits"],
  "tab/review": [...BASE, "primary-button-accent"], "session/validated": [...BASE, "primary-button-accent"],
  "session/discarded": [...BASE, "no-dead-disabled-control", "primary-button-accent"],
  "session/enqueued": [...BASE, "fits-viewport", "no-dead-disabled-control"], "manifest/terminal": [...BASE, "fits-viewport", "no-dead-disabled-control"],
  "pending/validate": [...BASE, "no-dead-disabled-control", "primary-button-accent"],
  "problem/rejected": [...BASE, "no-dead-disabled-control", "primary-button-accent"], "problem/confirmation-required": [...BASE, "no-dead-disabled-control", "primary-button-accent"],
  "problem/conflict": [...BASE, "no-dead-disabled-control", "primary-button-accent"], "problem/transport": [...BASE, "no-dead-disabled-control", "primary-button-accent"],
};

export const INTAKE_STORIES = defineSurface("intake", { resource: RESOURCE, session: SESSION, tab: TAB, manifest: MANIFEST, rerun: RERUN, problem: PROBLEM, pending: PENDING })
  .map(entry => {
    const broken = BREAKS[entry.id.slice("intake/".length)] ?? [];
    const narrow = entry.id === "intake/rerun/changed" ? { knownFailureWidth: { "fits-viewport": 1024 } } : {};
    return broken.length === 0 ? entry : { ...entry, story: { ...entry.story, knownFailures: Object.fromEntries(broken.map(rule => [rule, AUDIT_TICKET])), ...narrow } };
  });
