import { bindWorkflowDelegationTargets, descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../workflow-kit/workflow.js";
import { registration as crmDocDownload } from "./crm-doc-download/index.js";
import { registration as emergencyContact } from "./emergency-contact/index.js";
import { registration as emergencyContactMember } from "./emergency-contact-member/index.js";
import { registration as i9Check } from "./i9-check/index.js";
import { registration as i9CheckStart } from "./i9-check-start/index.js";
import { registration as i9Lookup } from "./i9-lookup/index.js";
import { registration as ocr } from "./ocr/index.js";
import { registration as ocrPage } from "./ocr-page/index.js";
import { registration as onbase } from "./onbase/index.js";
import { registration as onboarding } from "./onboarding/index.js";
import { registration as personLookup } from "./person-lookup/index.js";
import { registration as separations } from "./separations/index.js";
import { registration as workStudy } from "./work-study/index.js";

/** Workflows the operator starts, in Run picker order. */
export const PUBLIC_WORKFLOWS = Object.freeze([
  personLookup,
  separations,
  onboarding,
  workStudy,
  i9CheckStart,
  crmDocDownload,
  emergencyContact,
] as const);

/** Workflows that run only as a parent's delegated children. */
export const CHILD_ONLY_WORKFLOWS = Object.freeze([
  emergencyContactMember,
  i9Check,
  i9Lookup,
  ocr,
  ocrPage,
  onbase,
] as const);

export const WORKFLOW_REGISTRATIONS = Object.freeze([...PUBLIC_WORKFLOWS, ...CHILD_ONLY_WORKFLOWS]);

export function createWorkflowDescriptorRegistry(
  publicDescriptors: readonly AnyWorkflowDescriptor[],
  childOnlyDescriptors: readonly AnyWorkflowDescriptor[],
) {
  const descriptors = Object.freeze([...publicDescriptors]);
  const all = new Map<string, AnyWorkflowDescriptor>();
  for (const descriptor of [...descriptors, ...childOnlyDescriptors]) {
    if (all.has(descriptor.id)) throw new Error(`workflow ${descriptor.id} is registered more than once`);
    all.set(descriptor.id, descriptor);
  }
  const children = new Map([...all].map(([id, descriptor]) => [id,
    descriptorRuntimeNodes(descriptor).flatMap(node => node.kind === "child-run" ? [String(node.target.id)] : []),
  ]));
  bindWorkflowDelegationTargets([...all.values()]);

  return Object.freeze({
    descriptors,
    resolve: (id: string) => descriptors.find(descriptor => descriptor.id === id),
    resolveChild(parentId: string, id: string): AnyWorkflowDescriptor {
      const target = all.get(id);
      if (target === undefined) throw new Error(`workflow delegation target ${id} is not registered`);
      if (!children.get(parentId)?.includes(id)) {
        throw new Error(`workflow ${parentId} does not declare delegation to ${id}`);
      }
      return target;
    },
  });
}
