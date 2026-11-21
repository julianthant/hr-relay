import { readWritePlanTask } from "./tasks/read-write-plan.js";
import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readHirePlanTask } from "./tasks/read-hire-plan.js";
import { matchHireSubjectTask } from "./tasks/match-hire-subject.js";
import { readI9LookupTask } from "./tasks/read-i9-lookup.js";
import { readI9ProfilePlanTask } from "./tasks/read-i9-profile-plan.js";
import { readOnboardingReferenceStopTask } from "./tasks/read-reference-stop.js";

export const onboardingStore = defineWorkflowStore("onboarding", {
  readWritePlan: readWritePlanTask, readHirePlan: readHirePlanTask, matchHireSubject: matchHireSubjectTask,
  readI9Lookup: readI9LookupTask, readI9ProfilePlan: readI9ProfilePlanTask, readReferenceStop: readOnboardingReferenceStopTask,
});
