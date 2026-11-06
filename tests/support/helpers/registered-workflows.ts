import { READABLE_WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { STEP_PROOF_MODULES } from "../../../src/backend/app/registries/step-proof-modules.js";
import type { z } from "zod";
import {
  compileWorkflow,
  type CompiledWorkflowDescriptor,
  type WorkflowDefinition,
  type WorkflowModule,
} from "../../../src/workflow-kit/workflow-definition.js";
import type { CompletionProgram } from "../../../src/models/workflow/completion.js";
import { registration as i9Lookup } from "../../../src/workflows/i9-lookup/index.js";
import { registration as ocrPage } from "../../../src/workflows/ocr-page/index.js";
import { registration as ocr } from "../../../src/workflows/ocr/index.js";
import { registration as onbase } from "../../../src/workflows/onbase/index.js";
import { registration as separations } from "../../../src/workflows/separations/index.js";
import { crmDocDownloadWorkflow } from "../../../src/workflows/crm-doc-download/workflow.js";
import { emergencyContactMemberWorkflow } from "../../../src/workflows/emergency-contact-member/workflow.js";
import { emergencyContactWorkflow } from "../../../src/workflows/emergency-contact/workflow.js";
import { i9CheckStartWorkflow } from "../../../src/workflows/i9-check-start/workflow.js";
import { i9CheckWorkflow } from "../../../src/workflows/i9-check/workflow.js";
import { i9LookupWorkflow } from "../../../src/workflows/i9-lookup/workflow.js";
import { ocrPageWorkflow } from "../../../src/workflows/ocr-page/workflow.js";
import { ocrWorkflow } from "../../../src/workflows/ocr/workflow.js";
import { onbaseWorkflow } from "../../../src/workflows/onbase/workflow.js";
import { onboardingWorkflow } from "../../../src/workflows/onboarding/workflow.js";
import { personLookupWorkflow } from "../../../src/workflows/person-lookup/workflow.js";
import { separationsWorkflow } from "../../../src/workflows/separations/workflow.js";

/** The registry's own module (or step proof) for a definition, typed by that definition. */
export function registeredModule<
  InputSchema extends z.ZodType,
  ResultSchema extends z.ZodType,
  Completion extends CompletionProgram | undefined,
>(definition: WorkflowDefinition<InputSchema, ResultSchema, Completion>) {
  const descriptor = compileWorkflow(definition).descriptor;
  const module = [...READABLE_WORKFLOW_MODULES, ...STEP_PROOF_MODULES].find(candidate => candidate.descriptor === descriptor);
  if (module === undefined) throw new Error(`workflow ${String(descriptor.id)} is not registered`);
  return module as WorkflowModule<CompiledWorkflowDescriptor<InputSchema, ResultSchema, Completion>>;
}

export const crmDocDownloadModule = registeredModule(crmDocDownloadWorkflow);
export const emergencyContactModule = registeredModule(emergencyContactWorkflow);
export const emergencyContactMemberModule = registeredModule(emergencyContactMemberWorkflow);
export const i9CheckModule = registeredModule(i9CheckWorkflow);
export const i9CheckStartModule = registeredModule(i9CheckStartWorkflow);
export const i9LookupModule = registeredModule(i9LookupWorkflow);
export const ocrModule = registeredModule(ocrWorkflow);
export const ocrPageModule = registeredModule(ocrPageWorkflow);
export const onbaseModule = registeredModule(onbaseWorkflow);
export const onboardingModule = registeredModule(onboardingWorkflow);
export const personLookupModule = registeredModule(personLookupWorkflow);
export const separationsModule = registeredModule(separationsWorkflow);

export const separationsKronosTimecardModule = registeredModule(separations.proofs[0].definition);
export const separationsKualiReadModule = registeredModule(separations.proofs[1].definition);
export const separationsIdentityCheckModule = registeredModule(separations.proofs[2].definition);
export const separationsUcpathTerminationModule = registeredModule(separations.proofs[3].definition);
export const separationsKualiFinalizationModule = registeredModule(separations.proofs[4].definition);
export const i9LookupStepModule = registeredModule(i9Lookup.proofs[0].definition);
export const onbaseSourcePageModule = registeredModule(onbase.proofs[0].definition);
export const onbaseImportDocumentModule = registeredModule(onbase.proofs[1].definition);
export const ocrSourcePagesModule = registeredModule(ocr.proofs[0].definition);
export const ocrPageReadingModule = registeredModule(ocrPage.proofs[0].definition);

export const personLookupDescriptor = personLookupModule.descriptor;
export const separationsDescriptor = separationsModule.descriptor;
export const separationsKronosTimecardDescriptor = separationsKronosTimecardModule.descriptor;
export const separationsUcpathTerminationDescriptor = separationsUcpathTerminationModule.descriptor;
export const separationsKualiFinalizationDescriptor = separationsKualiFinalizationModule.descriptor;
export const separationsKualiReadDescriptor = separationsKualiReadModule.descriptor;
export const separationsIdentityCheckDescriptor = separationsIdentityCheckModule.descriptor;
