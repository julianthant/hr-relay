import { createDebugEventWriter } from "../../../src/backend/logs/debug-events.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { debugTimelineFixture } from "../helpers/backend/debug-timeline-fixture.js";

if (process.argv.includes("--electron")) Object.defineProperty(process.versions, "electron", { value: "test" });
const { repository, records } = debugTimelineFixture();
createDebugEventWriter({ repository, clock: manualClock(new Date("2026-11-03T12:00:00.000Z")), build: "test" })
  .emit({ category: "duo", phase: "failed", correlationId: "child-event", area: "profile-onboarding",
    reason: "provider", code: "PROFILE_ONBOARDING_DUO_FAILED", message: "PRIVATE_MESSAGE_CANARY" });
process.stdout.write(String(records.length));
