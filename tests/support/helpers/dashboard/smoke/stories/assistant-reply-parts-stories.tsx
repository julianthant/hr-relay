/** Assistant reply parts: every part kind, inline kind and session chip state, plus the longest content the schema allows, in the shipped panel's 480px.
 * The parts are mounted directly; the served panel stories in assistant-stories.tsx show them through the controller. */
import "../../../../../../src/dashboard/surfaces/shell/assistant-panel.css";
import { AssistantReplyParts } from "../../../../../../src/dashboard/surfaces/assistant/assistant-reply-parts.js";
import type { SessionChipState } from "../../../../../../src/dashboard/surfaces/assistant/assistant-reply-parts-model.js";
import { AssistantReplyPartsSchema, AssistantSessionViewSchema, type AssistantDataTarget, type AssistantInline, type AssistantReplyPart, type AssistantSessionView } from "../../../../../../src/models/dashboard/assistant.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

const noop = () => undefined;
const ID = "00000000-0000-4000-8000-0000000000c1";
const AT = "2026-11-26T09:31:00.000Z";
const TARGET: AssistantDataTarget = { kind: "workbook", libraryId: "separations-tracker", revision: 1, location: { kind: "master" } };

const plain = (text: string): AssistantInline => ({ kind: "plain", text });
const say = (...runs: AssistantInline[]) => ({ kind: "text", runs });
const list = (items: AssistantInline[][]) => ({ kind: "bullets", items });
const LINK: AssistantInline = { kind: "link", label: "Ortega, Lin", target: TARGET };
const SESSION = { kind: "session", runId: ID, label: "Checking UCPath…", meta: "Person Lookup · Ortega, Lin" } as const;

function view(state: AssistantSessionView["state"], label: string = SESSION.label) {
  const stop = state === "running" ? { runId: ID, descriptor: { kind: "command", key: "cancel", command: "cancel", label: "Cancel", expectedVersion: 1, intent: "destructive", placement: ["footer"] } } : null;
  return { runId: ID, rowRevision: 1, label, meta: SESSION.meta, state, stop };
}

function scene(title: string, authored: readonly unknown[], authoredSession?: unknown): Story {
  const parts = AssistantReplyPartsSchema.parse(authored), session = authoredSession === undefined ? undefined : AssistantSessionViewSchema.parse(authoredSession);
  return { title, ready: "#hub-panel-assistant", render: () => <StoryFrame>
    <div className="ml-auto flex min-h-0 w-[30rem] flex-1 flex-col">
      <section id="hub-panel-assistant" className="hub-assistant-panel" aria-label="Relay assistant"><div className="hub-panel-content"><div className="hub-thread-wrap"><div className="hub-transcript">
        <AssistantReplyParts parts={parts} sessions={session && new Map([[ID, session]])} onOpen={noop} onStop={noop} />
      </div></div></div></section>
    </div>
  </StoryFrame> };
}

const PART = {
  text: scene("One sentence", [say(plain("Their employee ID is "), { kind: "value", value: "10101010" }, plain("."))]),
  bullets: scene("A sentence and its bullets", [say(plain("Two runs need you:")), list([[LINK, plain(" · identity review")], [{ kind: "link", label: "Brooks, Dana", target: TARGET }, plain(" · save contact")]])]),
  session: scene("A running session", [SESSION], view("running")),
  answered: scene("The line recording a typed yes", [say(plain("Reply yes to file it, or tell me what to change.")),
    { kind: "answered", attribution: { kind: "assistant", requestedBy: "local-operator", profileId: ID, conversationId: ID, acceptedMessageId: ID, binding: { kind: "session", actionId: ID } }, at: AT }]),
} satisfies Record<AssistantReplyPart["kind"], Story>;

const INLINE = {
  plain: scene("Plain text", [say(plain("Nothing is waiting on you."))]),
  bold: scene("Bold text", [say({ kind: "bold", text: "Dry run, saves nothing." })]),
  value: scene("A changed value", [say(plain("Changed the end date "), { kind: "value", previous: "04/24/2031", value: "04/23/2031" }, plain("."))]),
  failure: scene("A failure", [say({ kind: "failure", code: "ASSISTANT_HISTORY_UNAVAILABLE", text: "Failed" }, plain(": saving the contact. Nothing was saved. Want me to try again?"))]),
  link: scene("A link to data", [say(plain("Filed today for "), LINK, plain("."))]),
} satisfies Record<AssistantInline["kind"], Story>;

const CHIP = {
  running: scene("A session running", [SESSION], view("running")),
  stopping: scene("A session stopping", [SESSION], view("cancelling", "Stopping…")),
  finished: scene("A session finished", [SESSION], view("done", "Checked UCPath")),
  failed: scene("A session failed", [SESSION], view("failed", "UCPath check failed")),
} satisfies Record<SessionChipState, Story>;

const LONG = "Wolfeschlegelsteinhausenbergerdorff-Featherstonehaugh, Alexandria Cassiopeia Montgomery";
const STRESS = {
  "long-names": scene("Long names", [say(plain(LONG.replaceAll(" ", ""))), list([[{ kind: "link", label: LONG, target: TARGET }, plain(" "), { kind: "value", previous: LONG, value: LONG.replaceAll(" ", "") }]]),
    { ...SESSION, meta: `Person Lookup · ${LONG}` }], { ...view("running"), meta: `Person Lookup · ${LONG}` }),
  "twenty-bullets": scene("Twenty bullets", [list(Array.from({ length: 20 }, (_, index) => [plain(`Row ${String(index + 1)}: `), LINK]))]),
  "many-runs": scene("A text part of 500 runs", [say(...Array.from({ length: 500 }, (_, index): AssistantInline => index % 2 === 0 ? plain("and ") : { kind: "value", value: "10101010 " }))]),
};

export const ASSISTANT_REPLY_PARTS_STORIES = defineSurface("assistant-reply-parts", { part: PART, inline: INLINE, chip: CHIP, stress: STRESS });
