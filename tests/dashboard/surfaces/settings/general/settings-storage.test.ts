// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,it } from "vitest";
import { AppDataPaths } from "../../../../../src/dashboard/surfaces/settings/general/settings-storage.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
function render(props: Parameters<typeof AppDataPaths>[0]) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root?.render(createElement(AppDataPaths, props)));
  return host;
}
it("shows authoritative locations read-only with no backup, restore or relocation action", () => {
  const surface = render({ locations: { stateRoot: "/isolated/Relay/data", artifactRoot: "/isolated/Relay/data/artifacts" } });
  const inputs = [...surface.querySelectorAll("input")];
  assert.deepEqual(inputs.map(input => input.value), ["/isolated/Relay/data", "/isolated/Relay/data/artifacts"]);
  assert.equal(inputs.every(input => input.readOnly), true);
  assert.deepEqual([...surface.querySelectorAll("button")].map(button => button.getAttribute("aria-label")), ["Copy data path", "Copy evidence path"]);
  assert.equal(/Back up|Restore|Browse|plan/iu.test(surface.textContent ?? ""), false);
});
it("keeps a failed read distinct and retries only through the read callback", () => {
  let reads = 0;
  const surface = render({ readProblem: true, onRetry: () => { reads += 1; } });
  assert.equal(surface.querySelectorAll("input").length, 0);
  assert.match(surface.textContent ?? "", /couldn’t be read/u);
  act(() => surface.querySelector("button")?.click()); assert.equal(reads, 1);
});
it("disables retry while reading", () => {
  const surface = render({ loading: true, onRetry: () => { throw new Error("unexpected effect"); } });
  assert.match(surface.textContent ?? "", /Reading app-data/u);
  assert.equal(surface.querySelector("button")?.disabled, true);
});
