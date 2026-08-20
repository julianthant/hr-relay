/**
 * What a workflow must DECLARE before a phone-capture bundle may be handed to
 * it (ref data-intake-and-edit-data §5.1, D174).
 *
 * Ref data-intake-and-edit-data §5.1's rule is that "the downstream descriptor parses it like any
 * upload; no special `pdfPath` or callback bypass exists". That is only true
 * if the bundle → canonical-input step is a declared, fingerprinted property
 * of the workflow rather than something the capture service invents. So this
 * module is the exact analogue of `intake/projection.ts` for a document
 * source: the workflow's SERVER MODULE declares one binding, the registry
 * refuses a binding built over a copy of the descriptor's input schema, and a
 * workflow that declares none cannot receive a capture handoff at all.
 *
 * NO REGISTERED WORKFLOW DECLARES ONE. `person-lookup` is identified by an
 * employee id or a name and `kuali-timekeeper-annotation` by a document
 * number; neither can be produced from a photograph without an OCR-backed
 * workflow that does not exist yet. Inventing a binding for either would put
 * a fabricated canonical input into a real run, so the handoff REFUSES BY NAME
 * instead — the same shape D170 used for intake projections before D172 gave
 * intake its first real consumer.
 */
import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json.js";
import type { ArtifactRef } from "./artifacts.js";
import { FingerprintSchema, type Fingerprint } from "./ids.js";
import { deriveSchemaHash } from "./schema-bound-value.js";
import { sha256Hex } from "./sha256.js";

/**
 * Everything a binding is allowed to see. It is deliberately the FINALIZED
 * facts only — the bundle that exists, the photographs it was built from, and
 * the operator's declared context. A binding cannot reach the session row, so
 * it cannot read a token digest or invent a fact the bundle does not carry.
 */
export interface CaptureBundleFacts {
  readonly captureSessionId: string;
  readonly workflow: string;
  readonly formType?: string;
  readonly contextHint?: string;
  /** The single PDF the ordered photographs became. */
  readonly document: ArtifactRef;
  readonly orderedPhotoSha256: readonly string[];
  readonly finalizationGeneration: number;
}

export interface CaptureIntakeBinding {
  /** MUST be the descriptor's own input schema object, not a copy. */
  readonly inputSchema: z.ZodType;
  /** The declared identity of this binding, folded into the manifest. */
  readonly fingerprint: Fingerprint;
  /**
   * The OCR form types this binding accepts. A capture session whose
   * `formType` is outside the list is refused rather than bound to a form the
   * workflow never claimed to read. Absent means the binding accepts a bundle
   * with no declared form type and nothing else.
   */
  readonly formTypes: readonly string[];
  /** One bundle becomes ONE canonical input, or throws. */
  readonly build: (facts: CaptureBundleFacts) => unknown;
}

const FACTORY_DEFINED_BINDINGS = new WeakSet<CaptureIntakeBinding>();

export function isFactoryDefinedCaptureIntakeBinding(candidate: CaptureIntakeBinding): boolean {
  return FACTORY_DEFINED_BINDINGS.has(candidate);
}

export interface CaptureIntakeBindingDefinition {
  readonly inputSchema: z.ZodType;
  readonly formTypes: readonly string[];
  readonly build: (facts: CaptureBundleFacts) => unknown;
}

/**
 * The ONE mint. The fingerprint folds the accepted form types and the input
 * schema's structural hash, so a binding whose workflow input tightens is a
 * DIFFERENT binding — a manifest written under the old one cannot silently
 * read as having been produced under the new.
 */
export function defineCaptureIntakeBinding(
  definition: CaptureIntakeBindingDefinition,
): CaptureIntakeBinding {
  const formTypes = [...definition.formTypes].sort();
  if (new Set(formTypes).size !== formTypes.length) {
    throw new Error(`a capture intake binding lists a form type twice: ${formTypes.join(", ")}`);
  }
  const fingerprint = FingerprintSchema.parse(sha256Hex(
    `hrauto:capture-intake-binding:v1\0${canonicalJsonStringify({
      formTypes,
      inputSchemaHash: deriveSchemaHash(definition.inputSchema, "input"),
    })}`,
  ));
  const binding: CaptureIntakeBinding = Object.freeze({
    inputSchema: definition.inputSchema,
    fingerprint,
    formTypes: Object.freeze(formTypes),
    build: definition.build,
  });
  FACTORY_DEFINED_BINDINGS.add(binding);
  return binding;
}

/**
 * Why a bundle could not be bound. Each arm is a fact about the DECLARATION,
 * never about the photographs — a capture that cannot be handed off is an
 * operator-visible configuration problem, not a bad photograph.
 */
export const CaptureBindingRefusalCodeSchema = z.enum([
  "no-binding-declared",
  "form-type-unaccepted",
  "input-rejected",
]);
export type CaptureBindingRefusalCode = z.infer<typeof CaptureBindingRefusalCodeSchema>;
