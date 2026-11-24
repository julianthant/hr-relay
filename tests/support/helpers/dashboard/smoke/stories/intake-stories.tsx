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


/** A click leaves the browser's Tab starting point on the clicked control, so the keyboard walk would skip everything before it; start it at the top of the page, as a person arriving with a keyboard does. */
const startKeyboardAtTop = (page: Page) => page.evaluate(() => {
  const { body } = document;
  body.setAttribute("tabindex", "-1");
  body.focus();
  body.blur();
  body.removeAttribute("tabindex");
});

interface Options { readonly then?: (page: Page) => Promise<void>; readonly extra?: Partial<Story> }
const scene = (title: string, client: () => DashboardClient, sessionId: string, { then, extra }: Options = {}): Story => ({
  title, render: () => <IntakeScene client={client()} sessionId={sessionId} />, ready: 'text="Spreadsheet intake"',
  play: async page => { await then?.(page); await page.mouse.move(0, 0); await startKeyboardAtTop(page); }, ...extra,
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

/** One data-changing command: the story drives the control that issues it, and the client answers as scripted. */
type IntakeCommand = "confirm-intake-mapping" | "correct-intake-row" | "exclude-intake-row" | "inspect-intake" | "enqueue-intake-manifest";
const MAPPING_LAYOUT = MAPPING;
const CLEAN = intakeSession("validated", { validation: { ...(VALIDATED.validation as object), validRows: 7, unresolvedRows: [], rejected: [], excluded: [] }, reviewBinding: "b".repeat(64) });
const driven = (command: IntakeCommand, extra: Partial<DashboardClient>): Story => {
  const mapping = { confirm: (page: Page) => page.getByRole("button", { name: /^Bind /u }).click() };
  const fix = async (page: Page) => { await tab(page, "Review"); await press(page, "Fix cell"); await page.getByRole("textbox", { name: "Corrected value" }).fill("10873698"); await press(page, "Re-coerce this cell"); };
  const exclude = async (page: Page) => { await tab(page, "Review"); await page.getByRole("button", { name: "Exclude…" }).first().click();
    await page.getByRole("textbox", { name: "Reason" }).fill("duplicate export line"); await press(page, "Exclude with this reason"); };
  const inspect = async (page: Page) => { await page.getByRole("combobox", { name: "Header row" }).click(); await page.getByRole("option").nth(1).click(); await press(page, "Change it anyway"); };
  const enqueue = async (page: Page) => { await page.getByRole("switch", { name: "I confirm this reviewed plan" }).check(); await page.getByRole("button", { name: /^Start \d+ runs?$/u }).click(); };
  const plays = { "confirm-intake-mapping": mapping.confirm, "correct-intake-row": fix, "exclude-intake-row": exclude, "inspect-intake": inspect, "enqueue-intake-manifest": enqueue } as const;
  const session = command === "enqueue-intake-manifest" ? CLEAN : command === "confirm-intake-mapping" || command === "inspect-intake" ? MAPPING_LAYOUT : VALIDATED;
  return scene(`${command} sent`, () => served(session, extra), session.intakeSessionId, { then: plays[command] });
};
const rejected = (command: IntakeCommand): Story => driven(command, { executeCommand: answer({ state: "rejected", commandId: COMMAND, code: "invalid-state", message: "The session cannot take that now." }) });
const waiting = (command: IntakeCommand): Story => driven(command, { executeCommand: never });
const PENDING = {
  validate: validate("Validate sent, waiting on the answer", { executeCommand: never }),
  "confirm-intake-mapping": waiting("confirm-intake-mapping"), "correct-intake-row": waiting("correct-intake-row"), "exclude-intake-row": waiting("exclude-intake-row"),
  "inspect-intake": waiting("inspect-intake"), "enqueue-intake-manifest": waiting("enqueue-intake-manifest"),
} satisfies Record<IntakeCommand | "validate", Story>;
const COMMAND_REFUSED = {
  "confirm-intake-mapping": rejected("confirm-intake-mapping"), "correct-intake-row": rejected("correct-intake-row"), "exclude-intake-row": rejected("exclude-intake-row"),
  "inspect-intake": rejected("inspect-intake"), "enqueue-intake-manifest": rejected("enqueue-intake-manifest"),
} satisfies Record<IntakeCommand, Story>;

/** The one rule intake still breaks: the design system's tabs hold the keyboard walk's tab stops (the tab list takes a Tab stop and forwards it, and an arrow key activates the next tab and swaps the panel under the walk), tracked against the umbrella ticket. The two stories without tabs pass it. */
const AUDIT_TICKET = "#532";
const TABLESS = new Set(["intake/resource/loading", "intake/resource/failed"]);

export const INTAKE_STORIES = defineSurface("intake", { resource: RESOURCE, session: SESSION, tab: TAB, manifest: MANIFEST, rerun: RERUN, problem: PROBLEM, pending: PENDING, refused: COMMAND_REFUSED })
  .map(entry => TABLESS.has(entry.id) ? entry : { ...entry, story: { ...entry.story, knownFailures: { "named-and-focusable": AUDIT_TICKET } } });
