/** The state gallery page: `window.mount` renders one catalogue story into #root for Playwright's `mount` fixture. */
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import "./gallery.css";
import "../../../src/dashboard/ds/theme/hub-theme.css";
import "../../../src/dashboard/surfaces/shell/permanent-shell.css";
import { CATALOGUE } from "../../support/helpers/dashboard/smoke/stories/catalogue.js";
import { RULE_PROBE_ENTRIES } from "../../support/helpers/dashboard/smoke/stories/rule-probe-stories.js";
import { storyOf } from "../../support/helpers/dashboard/smoke/story-catalogue.js";

const container = document.getElementById("root");
if (container === null) throw new Error("the gallery page requires a #root element");
const MOUNTABLE = [...CATALOGUE, ...RULE_PROBE_ENTRIES];
let root: Root | undefined;

Reflect.set(window, "mount", ({ story }: { story: string }) => {
  const mounted = storyOf(MOUNTABLE, story);
  root ??= createRoot(container);
  const target = root;
  flushSync(() => { target.render(mounted.render()); });
});
Reflect.set(window, "unmount", () => {
  root?.unmount();
  root = undefined;
});
