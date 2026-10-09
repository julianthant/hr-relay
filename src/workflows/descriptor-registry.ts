/** The bundle-safe descriptor tuple — the dashboard's aggregation of the one workflow composition root, not a second registry (a test pins every entry equals WORKFLOW_MODULES). */
import { compileWorkflow } from "../workflow-kit/workflow-definition.js";
import { personLookupWorkflow } from "./person-lookup/workflow.js";
import { separationsWorkflow } from "./separations/workflow.js";

export const WORKFLOW_DESCRIPTORS = Object.freeze([
  compileWorkflow(personLookupWorkflow).descriptor,
  compileWorkflow(separationsWorkflow).descriptor,
] as const);
