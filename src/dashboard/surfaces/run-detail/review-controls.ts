import { ACTIVITY_SAMPLE_STATES } from "../activity/activity-fixture.js";
import { decisionScenarios, previewScenarios } from "./logs/log-fixture.js";

const frame = document.querySelector<HTMLIFrameElement>("#review-frame");
const link = document.querySelector<HTMLAnchorElement>("#review-open");
if (!frame || !link) throw new Error("REVIEW_CONTROLS_MISSING");
const initial = new URL("/", window.location.origin);
initial.search = window.location.search;
frame.src = initial.href;
link.href = initial.href;
const controls = [
  { id: "logs", parameter: "logPreview", options: [{ id: "", label: "Selected run" }, { id: "selected", label: "Queue facts" }, ...previewScenarios, ...decisionScenarios] },
  { id: "activity", parameter: "activityPreview", options: ACTIVITY_SAMPLE_STATES },
  { id: "notifications", parameter: "notificationsPreview", options: ["normal", "empty", "loading", "unavailable", "ping"].map(id => ({ id, label: id })) },
];
for (const control of controls) {
  const select = document.querySelector<HTMLSelectElement>(`#review-${control.id}`);
  if (!select) throw new Error("REVIEW_CONTROL_MISSING");
  for (const item of control.options) select.add(new Option(item.label, item.id));
  select.value = initial.searchParams.get(control.parameter) ?? control.options[0].id;
  select.addEventListener("change", () => {
    const next = new URL(frame.contentWindow?.location.href ?? frame.src);
    if (select.value) next.searchParams.set(control.parameter, select.value); else next.searchParams.delete(control.parameter);
    frame.src = next.href; link.href = next.href;
  });
}
frame.addEventListener("load", () => { link.href = frame.contentWindow?.location.href ?? frame.src; });
