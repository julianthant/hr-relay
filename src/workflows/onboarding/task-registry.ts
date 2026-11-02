import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readHirePlanTask } from "./tasks/read-hire-plan.js";
import { matchHireSubjectTask } from "./tasks/match-hire-subject.js";
import { readI9LookupTask, readI9ProfilePlanTask } from "./tasks/read-i9-profile.js";

export const onboardingStore = defineWorkflowStore("onboarding", {
  readHirePlan: readHirePlanTask, matchHireSubject: matchHireSubjectTask,
  readI9Lookup: readI9LookupTask, readI9ProfilePlan: readI9ProfilePlanTask,
});
