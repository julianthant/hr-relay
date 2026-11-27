// @vitest-environment jsdom
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { AssistantReplyParts } from "../../../../src/dashboard/surfaces/assistant/assistant-reply-parts.js";
import { SESSION_CHIP_STATE } from "../../../../src/dashboard/surfaces/assistant/assistant-reply-parts-model.js";
import { AssistantReplyPartsSchema, AssistantSessionViewSchema, type AssistantDataTarget, type AssistantInline, type AssistantReplyPart, type AssistantSessionView } from "../../../../src/models/dashboard/assistant.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

const ID = "00000000-0000-4000-8000-000000000001";
const AT = "2026-11-26T09:31:00.000Z";
const ATTRIBUTION = ({ kind: "assistant", requestedBy: "local-operator", profileId: ID, conversationId: ID, acceptedMessageId: ID, binding: { kind: "session", actionId: ID } });
const TARGET = { kind: "workbook", libraryId: "tracker", revision: 1, location: { kind: "master" } } as const;
const TEXT = { label: "Checking UCPath…", meta: "Person Lookup · Ortega, Lin" };
const SESSION = AssistantReplyPartsSchema.parse([{ kind: "session", runId: ID, ...TEXT }])[0];

async function draw(parts: readonly AssistantReplyPart[], view?: Partial<AssistantSessionView>) {
  const opened: AssistantDataTarget[] = [], stopped: string[] = [];
  const sessions = view && new Map([[ID, AssistantSessionViewSchema.parse({ runId: ID, rowRevision: 1, ...TEXT, state: "running", stop: null, ...view })]]);
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root?.render(createElement(AssistantReplyParts, { parts, sessions, onOpen: target => opened.push(target), onStop: stop => stopped.push(stop.runId) })));
  return { host, opened, stopped };
}

it("draws every inline kind in one message with its bullets", async () => {
  const runs: AssistantInline[] = [{ kind: "plain", text: "End date " }, { kind: "bold", text: "changed" }, { kind: "value", previous: "04/24/2031", value: "04/23/2031" },
    { kind: "failure", code: "ASSISTANT_HISTORY_UNAVAILABLE", text: "Failed" }, { kind: "link", label: "Show in Queue", target: TARGET }];
  const parts = AssistantReplyPartsSchema.parse([{ kind: "text", runs }, { kind: "bullets", items: [runs, runs] }]);
  const view = await draw(parts);
  assert.equal(view.host.querySelectorAll(".hub-message").length, 1);
  assert.equal(view.host.querySelectorAll("li").length, 2);
  assert.equal(view.host.querySelector("p")?.textContent, "End date changed04/24/2031 04/23/2031FailedShow in Queue");
  assert.equal(view.host.querySelector("del")?.textContent, "04/24/2031");
  assert.equal(view.host.querySelector(".reply-failure")?.textContent, "Failed");
  assert.equal(view.host.querySelectorAll("button").length, 0);
  const link = view.host.querySelector<HTMLAnchorElement>("a[href]")!;
  assert.equal(link.textContent, "Show in Queue");
  await act(async () => link.click());
  assert.deepEqual(view.opened, [TARGET]);
});

it("names the run on a keyboard-reachable Stop and spins while the run is live", async () => {
  const stop = { runId: ID, descriptor: { kind: "command", key: "cancel", command: "cancel", label: "Cancel", expectedVersion: 1, intent: "destructive", placement: ["footer"] } };
  const view = await draw([SESSION], AssistantSessionViewSchema.parse({ runId: ID, rowRevision: 1, label: TEXT.label, meta: TEXT.meta, state: "running", stop }));
  const button = view.host.querySelector("button")!;
  assert.equal(button.textContent, "Stop");
  assert.equal(button.tabIndex, 0);
  assert.equal(button.getAttribute("aria-describedby")!.split(" ").map(id => document.getElementById(id)?.textContent).join(" | "), `${TEXT.label} | ${TEXT.meta}`);
  assert(view.host.querySelector(".reply-spinner"));
  await act(async () => button.click());
  assert.deepEqual(view.stopped, [ID]);
});

it.each(Object.entries(SESSION_CHIP_STATE))("draws a %s run without Stop unless the server offers one", async (status, chip) => {
  const view = await draw([SESSION], { state: status as AssistantSessionView["state"] });
  assert.equal(view.host.querySelector(".reply-session")?.getAttribute("data-state"), chip);
  assert.equal(view.host.querySelector(".reply-spinner") !== null, chip === "running" || chip === "stopping");
  assert.equal(view.host.querySelector("button") === null, true);
});

it("claims no progress for a session the server has not described", async () => {
  const view = await draw([SESSION]);
  assert.equal(view.host.textContent, TEXT.label + TEXT.meta);
  assert.equal(view.host.querySelector(".reply-spinner, button") === null, true);
});

it("records who filed under a typed yes, and nothing for an unrecorded one", async () => {
  const view = await draw(AssistantReplyPartsSchema.parse([{ kind: "answered", attribution: ATTRIBUTION, at: AT }, { kind: "answered", attribution: { kind: "unrecorded" }, at: AT }]));
  assert.equal(view.host.querySelectorAll("p").length, 1);
  assert.match(view.host.textContent ?? "", /^You replied yes · \d{1,2}:31 [AP]M$/u);
});

it("stops the spinner under reduced motion", () => {
  const css = readFileSync("src/dashboard/surfaces/assistant/assistant-reply-parts.css", "utf8");
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.reply-spinner\{animation:none\}/u);
});

it("fails the type check on an unknown kind", () => {
  // @ts-expect-error an unknown part kind is not a reply part
  const part: AssistantReplyPart = { kind: "table" };
  // @ts-expect-error an unknown inline kind is not an inline run
  const run: AssistantInline = { kind: "button" };
  assert.deepEqual([part.kind as string, run.kind as string], ["table", "button"]);
});
