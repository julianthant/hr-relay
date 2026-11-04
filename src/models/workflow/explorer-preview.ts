import { z } from "zod";

export interface FlowField {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly mode: "read" | "fill" | "compute";
  readonly source?: string;
  readonly template?: "ucpath" | "kuali" | "duplicate";
}
export type FlowPart =
  | { readonly kind: "form"; readonly id: string; readonly title: string; readonly mode: string; readonly parts: readonly FlowPart[]; readonly result?: "pending" }
  | { readonly kind: "rows"; readonly fields: readonly FlowField[] }
  | { readonly kind: "action"; readonly text: string; readonly icon: "click" | "read" | "verify" | "compute" | "key" | "rejoin" | "stop" }
  | { readonly kind: "note"; readonly text: string }
  | { readonly kind: "detail"; readonly id: string; readonly title: string; readonly parts: readonly FlowPart[] }
  | { readonly kind: "choice"; readonly choice: "identity" | "termination" }
  | { readonly kind: "mock-choice"; readonly id: string; readonly label: string; readonly value: string; readonly options: readonly (readonly [value: string, label: string])[] }
  | { readonly kind: "resume"; readonly step: number; readonly text: string }
  | { readonly kind: "sessions"; readonly systems?: readonly string[] };
export interface FlowStep {
  readonly number: number;
  readonly title: string;
  readonly system?: "Kuali" | "Kronos" | "UCPath" | "Local" | "You" | "CRM" | "I-9" | "OCR" | "OnBase" | "ServiceNow" | "SharePoint";
  readonly parts: readonly FlowPart[];
}
export interface FieldSource {
  readonly origin?: string;
  readonly detail?: string;
  readonly reads?: readonly { readonly system: string; readonly page: string; readonly field: string; readonly step: number; readonly fieldId?: string }[];
  readonly chain?: readonly { readonly step: number; readonly title: string; readonly detail: string }[];
}

const text = z.string().min(1);
const when = z.record(text, z.array(text).min(1));
export type PreviewSelection = Readonly<Record<string, string>>;
export type PreviewCondition = Readonly<Record<string, readonly string[]>>;
export type AuthoredExplorerPart = Omit<Extract<FlowPart, { kind: "form" }>, "parts"> & { readonly parts: readonly AuthoredExplorerPart[]; readonly when?: PreviewCondition }
  | Omit<Extract<FlowPart, { kind: "detail" }>, "parts"> & { readonly parts: readonly AuthoredExplorerPart[]; readonly when?: PreviewCondition }
  | Exclude<FlowPart, { kind: "form" | "detail" | "mock-choice" }> & { readonly when?: PreviewCondition }
  | { readonly kind: "preview-choice"; readonly key: string; readonly when?: PreviewCondition };
const FieldSchema = z.strictObject({ id: text, label: text, value: text, mode: z.enum(["read", "fill", "compute"]), source: text.optional(), template: z.enum(["ucpath", "kuali", "duplicate"]).optional() });
const PartSchema: z.ZodType<AuthoredExplorerPart> = z.lazy(() => z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("form"), id: text, title: text, mode: text, parts: z.array(PartSchema), result: z.literal("pending").optional(), when: when.optional() }),
  z.strictObject({ kind: z.literal("detail"), id: text, title: text, parts: z.array(PartSchema), when: when.optional() }),
  z.strictObject({ kind: z.literal("rows"), fields: z.array(FieldSchema), when: when.optional() }),
  z.strictObject({ kind: z.literal("action"), text, icon: z.enum(["click", "read", "verify", "compute", "key", "rejoin", "stop"]), when: when.optional() }),
  z.strictObject({ kind: z.literal("note"), text, when: when.optional() }),
  z.strictObject({ kind: z.literal("choice"), choice: z.enum(["identity", "termination"]), when: when.optional() }),
  z.strictObject({ kind: z.literal("preview-choice"), key: text, when: when.optional() }),
  z.strictObject({ kind: z.literal("resume"), step: z.number().int().positive(), text, when: when.optional() }),
  z.strictObject({ kind: z.literal("sessions"), systems: z.array(text).optional(), when: when.optional() }),
]));
const SourceSchema = z.strictObject({
  origin: text.optional(), detail: text.optional(),
  reads: z.array(z.strictObject({ system: text, page: text, field: text, step: z.number().int().positive(), fieldId: text.optional() })).optional(),
  chain: z.array(z.strictObject({ step: z.number().int().positive(), title: text, detail: text })).optional(),
});
export const WorkflowExplorerPreviewSchema = z.strictObject({
  choices: z.array(z.strictObject({ key: text, label: text, options: z.array(z.tuple([text, text])).min(1) })),
  steps: z.array(z.strictObject({ nodes: z.array(text), title: text, system: z.enum(["Kuali", "Kronos", "UCPath", "Local", "You", "CRM", "I-9", "OCR", "OnBase", "ServiceNow", "SharePoint"]).optional(), parts: z.array(PartSchema), when: when.optional(), stopWhen: when.optional() })).min(1),
  sources: z.record(text, SourceSchema),
  completion: text.optional(),
  sourceVariants: z.array(z.strictObject({ when, sources: z.record(text, SourceSchema) })).optional(),
}).superRefine((preview, context) => {
  const choices = new Map(preview.choices.map(choice => [choice.key, new Set(choice.options.map(([value]) => value))]));
  if (choices.size !== preview.choices.length || preview.choices.some(choice => choices.get(choice.key)?.size !== choice.options.length)) context.addIssue({ code: "custom", message: "Explorer choices and options must be unique" });
  const condition = (value: PreviewCondition | undefined) => {
    for (const [key, values] of Object.entries(value ?? {})) if (!choices.has(key) || values.some(value => !choices.get(key)?.has(value))) context.addIssue({ code: "custom", message: `Explorer condition is undeclared: ${key}` });
  };
  const visit = (parts: readonly AuthoredExplorerPart[]) => {
    for (const part of parts) {
      condition(part.when);
      if (part.kind === "form" || part.kind === "detail") visit(part.parts);
      if (part.kind === "preview-choice" && !choices.has(part.key)) context.addIssue({ code: "custom", message: `Explorer choice is undeclared: ${part.key}` });
      if (part.kind === "rows") for (const field of part.fields) if (field.source !== undefined && !Object.hasOwn(preview.sources, field.source)) context.addIssue({ code: "custom", message: `Explorer source is undeclared: ${field.source}` });
    }
  };
  for (const step of preview.steps) { condition(step.when); condition(step.stopWhen); visit(step.parts); }
  for (const variant of preview.sourceVariants ?? []) {
    condition(variant.when);
    for (const key of Object.keys(variant.sources)) if (!Object.hasOwn(preview.sources, key)) context.addIssue({ code: "custom", message: `Explorer source variant is undeclared: ${key}` });
  }
});
export type WorkflowExplorerPreview = z.infer<typeof WorkflowExplorerPreviewSchema>;
const previewApplies = (condition: PreviewCondition | undefined, selection: PreviewSelection): boolean => condition === undefined || Object.entries(condition).every(([key, values]) => values.includes(selection[key]));

export function projectWorkflowExplorerPreview(preview: WorkflowExplorerPreview, selected: PreviewSelection): { steps: FlowStep[]; sources: ReadonlyMap<string, FieldSource>; stopAfter?: number; completion?: string } {
  const choices = Object.fromEntries(preview.choices.map(choice => [choice.key, choice.options[0][0]]));
  for (const choice of preview.choices) if (selected[choice.key] !== undefined) {
    if (!choice.options.some(([value]) => value === selected[choice.key])) throw new Error(`explorer-preview-choice-invalid: ${choice.key}`);
    choices[choice.key] = selected[choice.key];
  }
  const parts = (items: readonly AuthoredExplorerPart[]): FlowPart[] => items.filter(part => previewApplies(part.when, choices)).map(part => {
    const { when: _when, ...value } = part;
    if (value.kind === "preview-choice") {
      const choice = preview.choices.find(choice => choice.key === value.key);
      if (!choice) throw new Error(`explorer-preview-choice-missing: ${value.key}`);
      return { kind: "mock-choice", id: `workflow:${choice.key}`, label: choice.label, value: choices[choice.key], options: choice.options };
    }
    return value.kind === "form" || value.kind === "detail" ? { ...value, parts: parts(value.parts) } : value;
  });
  let stopAfter: number | undefined;
  const steps = preview.steps.filter(step => previewApplies(step.when, choices)).map((step, index) => {
    const number = index + 1;
    if (step.stopWhen && previewApplies(step.stopWhen, choices)) stopAfter ??= number;
    return { number, title: step.title, ...(step.system === undefined ? {} : { system: step.system }), parts: parts(step.parts) };
  });
  const sources = new Map(Object.entries(preview.sources));
  for (const variant of preview.sourceVariants ?? []) if (previewApplies(variant.when, choices)) for (const [key, source] of Object.entries(variant.sources)) sources.set(key, source);
  return { steps, sources, ...(stopAfter === undefined ? {} : { stopAfter }), ...(preview.completion === undefined ? {} : { completion: preview.completion }) };
}
