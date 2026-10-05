import type { NavbarData } from "./navbar-view-model.js";

export const NAVBAR_SAMPLE: NavbarData = {
  today: "2026-09-26",
  counts: { "2026-09-20": 0, "2026-09-21": 5, "2026-09-22": 8, "2026-09-23": 7, "2026-09-24": 6, "2026-09-25": 9, "2026-09-26": 9 },
  results: [
    { id: "sample-alex", subject: "Alex Morgan", workflow: "Separations", day: "2026-09-26", state: "Completed" },
    { id: "sample-jordan", subject: "Jordan Lee", workflow: "Person lookup", day: "2026-09-26", state: "Waiting" },
    { id: "sample-casey", subject: "Casey Rivera", workflow: "Separations", day: "2026-09-25", state: "Failed" },
  ],
};
