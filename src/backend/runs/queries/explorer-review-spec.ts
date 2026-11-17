import type { ExplorerNodeWire } from "../../../models/dashboard/explorer.js";
import { ExplorerReviewSpecSchema, type ExplorerReviewSpec, type ExplorerSpecValue } from "../../../models/dashboard/explorer-review-spec.js";
import { failureCodeFromTaskCode, operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import type { NodeCondition } from "../../../models/workflow/node-condition.js";
import type { OperatorFieldDisplay } from "../../../models/workflow/presentation.js";
import { WorkflowStepReviewSchema } from "../../../models/workflow/review-spec.js";
import { contractSchemaLeaves, contractSchemaLeavesForModes } from "../../../models/validation/contract-boundary.js";
import { descriptorRuntimeNodes, workflowDryRunSupport } from "../../../workflow-kit/workflow.js";
import type { ExplorerModuleView } from "./explorer.js";

type Condition = Readonly<Record<string, readonly string[]>>;
/** Alternatives, any of which shows a part; `undefined` shows it always. */
type When = readonly Condition[];
type Choices = ReadonlyMap<string, readonly string[]>;
type Spec = ExplorerReviewSpec;
type Option = Spec["options"][number];
type Step = Spec["steps"][number];
type Block = Step["blocks"][number];
type Decision = Extract<Block, { kind: "decision" }>;
type Outcome = Decision["outcomes"][number];
type StepReview = ReturnType<typeof WorkflowStepReviewSchema.parse>;
type RuntimeNode = ReturnType<typeof descriptorRuntimeNodes>[number];

const STOPS = "The run stops with a failure card.";
const ON_OFF = [{ value: "true", label: "On" }, { value: "false", label: "Off" }];
const DRY_RUN = "dry-run";
const DRY: When = [{ [DRY_RUN]: ["true"] }];
const LIVE: When = [{ [DRY_RUN]: ["false"] }];

/** Drops keys that admit every choice and alternatives another alternative already covers; `undefined` when one admits every run. */
function simplify(when: When, choices: Choices): When | undefined {
  const reduced = when.map(condition => Object.fromEntries(Object.entries(condition).flatMap(([key, values]) => {
    const all = choices.get(key);
    if (all !== undefined && all.every(value => values.includes(value))) return [];
    return [[key, all === undefined ? [...new Set(values)] : all.filter(value => values.includes(value))] as const];
  })));
  if (reduced.some(condition => Object.keys(condition).length === 0)) return undefined;
  const merged = mergeAlternatives(reduced);
  if (merged.length < reduced.length) return simplify(merged, choices);
  const covers = (wide: Condition, narrow: Condition) => Object.entries(wide).every(([key, values]) => narrow[key]?.every(value => values.includes(value)) === true);
  return reduced.filter((condition, index) => !reduced.some((other, at) => at !== index && covers(other, condition) && (at < index || !covers(condition, other))));
}

/** Two alternatives that differ only in one key's values are one alternative admitting both. */
function mergeAlternatives(when: When): When {
  for (const [index, left] of when.entries()) for (const [at, right] of when.entries()) {
    if (at <= index) continue;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length || !keys.every(key => right[key] !== undefined)) continue;
    const differing = keys.filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
    if (differing.length > 1) continue;
    const merged = Object.fromEntries(keys.map(key => [key, [...new Set([...left[key] ?? [], ...right[key] ?? []])]]));
    return mergeAlternatives([...when.filter((_, position) => position !== index && position !== at), merged]);
  }
  return when;
}

function join(left: Condition, right: Condition): Condition | undefined {
  const joined: Record<string, readonly string[]> = { ...left };
  for (const [key, values] of Object.entries(right)) {
    const kept = joined[key]?.filter(value => values.includes(value)) ?? values;
    if (kept.length === 0) return undefined;
    joined[key] = kept;
  }
  return joined;
}

/** Every gate holds. */
function both(choices: Choices, ...gates: readonly (When | undefined)[]): When | undefined {
  let joined: readonly Condition[] | undefined;
  for (const gate of gates) {
    if (gate === undefined) continue;
    joined = (joined ?? [{}]).flatMap(left => gate.flatMap(right => join(left, right) ?? []));
    if (joined.length === 0) throw new Error(`explorer gates ${JSON.stringify(gates)} admit no run`);
  }
  return joined === undefined ? undefined : simplify(joined, choices);
}

/** Any gate holds. */
function either(choices: Choices, gates: readonly (When | undefined)[]): When | undefined {
  if (gates.length === 0 || gates.some(gate => gate === undefined)) return undefined;
  return simplify(gates.flatMap(gate => gate ?? []), choices);
}

const gated = (when: When | undefined) => when === undefined ? {} : { when: when.map(condition => Object.fromEntries(Object.entries(condition).map(([key, values]) => [key, [...values]]))) };

/** The run options Start run declares, and how input conditions read as gates on them. */
function runOptions(module: ExplorerModuleView, inputLabels: ReadonlyMap<string, string>) {
  const { descriptor } = module;
  const typed = descriptor.surfaces.inputRun?.typedInput;
  const options: Option[] = [];
  const choices = new Map<string, readonly string[]>();
  const gates = new Map<string, When | undefined>();
  const emitted = new Map<string, { option: string; value: string }>();
  const add = (option: Omit<Option, "when">, when: When | undefined): void => {
    options.push({ ...option, ...gated(when) });
    choices.set(option.id, option.choices.map(choice => choice.value));
    gates.set(option.id, when);
  };
  if (typed !== undefined) {
    const modeOption = typed.submitsMode !== false && typed.modes.length > 1 ? typed.modeField : undefined;
    if (modeOption !== undefined) add({ id: modeOption, label: typed.modeLabel, choices: typed.modes.map(mode => ({ value: mode.value, label: mode.label })),
      initial: typed.initialMode ?? typed.modes[0]?.value ?? "" }, undefined);
    const modeGate = (modes: readonly string[]): When | undefined =>
      modeOption === undefined || typed.modes.every(mode => modes.includes(mode.value)) ? undefined : [{ [modeOption]: modes }];
    for (const mode of typed.modes) {
      if (mode.parser.kind !== "entries") continue;
      const fields = [...new Set(mode.parser.spec.rules.map(rule => rule.emit))];
      if (fields.length < 2) continue;
      const id = `${mode.value}-by`;
      add({ id, label: `${mode.label} by`, choices: fields.map(field => {
        const label = inputLabels.get(field);
        if (label === undefined) throw new Error(`workflow ${descriptor.id} option ${id} has no review row that reads input field ${field}`);
        return { value: field, label };
      }), initial: mode.parser.spec.rules.find(rule => rule.when.kind === "otherwise")?.emit ?? fields[0] ?? "" }, modeGate([mode.value]));
      for (const field of fields) emitted.set(field, { option: id, value: field });
    }
    for (const control of typed.controls) {
      if (control.placement === "hidden" || "kind" in control) continue;
      const leaves = typed.submitsMode === false ? contractSchemaLeaves(descriptor.input)
        : contractSchemaLeavesForModes(descriptor.input, typed.modeField, control.modes);
      const leaf = leaves.find(candidate => candidate.path === control.field);
      if (leaf === undefined) throw new Error(`workflow ${descriptor.id} review control names unknown input field ${control.field}`);
      const offered = leaf.kind === "boolean" ? ON_OFF : leaf.options?.map(value => ({ value, label: value }));
      if (offered === undefined) continue;
      const defaults = new Map(typed.modes.filter(mode => control.modes.includes(mode.value)).flatMap(mode => {
        const declared = mode.defaults.find(field => field.field === control.field)?.value;
        const value = declared === undefined ? undefined : declared.kind === "boolean" ? String(declared.value) : declared.kind === "text" ? declared.text : undefined;
        return value === undefined ? [] : [[mode.value, value] as const];
      }));
      const first = offered[0]?.value ?? "";
      const initialMode = typed.initialMode ?? typed.modes[0]?.value;
      const distinct = new Set(defaults.values());
      const initial: ExplorerSpecValue = distinct.size <= 1 || modeOption === undefined ? [...distinct][0] ?? first
        : { by: modeOption, values: Object.fromEntries(defaults), otherwise: (initialMode === undefined ? undefined : defaults.get(initialMode)) ?? first };
      add({ id: control.field, label: control.label, choices: offered, initial },
        both(choices, modeGate(control.modes), ...control.requires.map(field => both(choices, [{ [field]: ["true"] }], gates.get(field)))));
    }
  }
  if (workflowDryRunSupport(descriptor).state === "supported") add({ id: DRY_RUN, label: "Dry run", choices: ON_OFF, initial: "false" }, undefined);
  for (const omission of descriptor.stepOmissions) {
    const step = descriptor.timeline.find(group => group.key === omission.step);
    if (step === undefined) throw new Error(`workflow ${descriptor.id} review omission names unknown step ${omission.step}`);
    add({ id: `skip-${step.key}`, label: step.label, choices: [{ value: "run", label: "Runs" }, { value: "skip", label: "Skipped" }], initial: "run" }, undefined);
  }
  /** The gate an input condition puts on a node; a condition on another node's output depends on the run, so it gates nothing. */
  const conditionGate = (condition: NodeCondition | undefined): When | undefined => {
    if (condition?.of.from !== "input") return undefined;
    const path = String(condition.of.path);
    const values = choices.get(path);
    const option = (picked: readonly string[]) => values === undefined ? undefined : both(choices, [{ [path]: picked }], gates.get(path));
    switch (condition.kind) {
      case "equals": return values?.includes(String(condition.value)) === true ? option([String(condition.value)]) : undefined;
      case "not-equals": return option(values?.filter(value => value !== String(condition.value)) ?? []);
      case "is-true": return option(["true"]);
      case "is-false": return option(["false"]);
      case "is-present": case "is-absent": {
        const emit = emitted.get(path);
        if (emit === undefined) return undefined;
        const all = choices.get(emit.option) ?? [];
        return both(choices, [{ [emit.option]: condition.kind === "is-present" ? [emit.value] : all.filter(value => value !== emit.value) }], gates.get(emit.option));
      }
    }
  };
  const inputGate = (path: string): When | undefined => {
    const emit = emitted.get(path);
    return emit === undefined ? undefined : both(choices, [{ [emit.option]: [emit.value] }], gates.get(emit.option));
  };
  const selectionGate = (field: string, selectedWhen: boolean): When | undefined =>
    choices.get(field)?.includes(String(selectedWhen)) === true ? both(choices, [{ [field]: [String(selectedWhen)] }], gates.get(field)) : undefined;
  return { options, choices, conditionGate, inputGate, selectionGate };
}

function scalarAt(value: unknown, path: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map(item => scalarAt(item, path)).find(item => item !== undefined);
  if (path.length === 0) return value === null || value === "" || typeof value === "object" ? undefined : value;
  if (value === null || typeof value !== "object") return undefined;
  const [head, ...rest] = path;
  const entry: unknown = Object.entries(value).find(([key]) => key === head)?.[1];
  return scalarAt(entry, rest);
}

function sampleText(value: unknown, display: OperatorFieldDisplay | undefined): string | undefined {
  if (value === undefined) return undefined;
  const shown = display?.cases.find(entry => entry.value === value)?.text;
  if (shown !== undefined) return shown;
  return typeof value === "boolean" ? (value ? "Yes" : "No") : typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

export function buildExplorerReviewSpec(module: ExplorerModuleView, modules: readonly ExplorerModuleView[], nodes: readonly ExplorerNodeWire[]): ExplorerReviewSpec {
  const { descriptor } = module;
  const runtimeNodes = descriptorRuntimeNodes(descriptor);
  const reviews = new Map<string, StepReview>(descriptor.timeline.flatMap(group => {
    const authored = module.definition?.steps.find(([candidate]) => candidate.key === group.key)?.[0].review;
    return authored === undefined ? [] : [[group.key, WorkflowStepReviewSchema.parse(authored)] as const];
  }));
  const inputLabels = new Map<string, string>();
  for (const review of reviews.values()) for (const page of review.pages) for (const field of page.fields) {
    if ("inputField" in field && !inputLabels.has(field.inputField)) inputLabels.set(field.inputField, field.label);
  }
  const run = runOptions(module, inputLabels);
  const known = new Map(run.choices);
  const nodeWire = (id: string): ExplorerNodeWire => {
    const node = nodes.find(candidate => candidate.id === id);
    if (node === undefined) throw new Error(`workflow ${descriptor.id} review names unknown node ${id}`);
    return node;
  };
  const nodeGate = (id: string): When | undefined => {
    const { shape } = nodeWire(id);
    return run.conditionGate(shape.kind === "task" || shape.kind === "gate" ? shape.condition : undefined);
  };
  const previewsOnDryRun = (node: ExplorerNodeWire): boolean => node.shape.kind === "transaction" && node.shape.dryRun === "stop-after-prepare" && known.has(DRY_RUN);
  const runtimeNode = (id: string): RuntimeNode => {
    const node = runtimeNodes.find(candidate => candidate.id === id);
    if (node === undefined) throw new Error(`workflow ${descriptor.id} review names unknown node ${id}`);
    return node;
  };
  const omitted = new Set(descriptor.stepOmissions.map(omission => omission.step));
  const stepGates = descriptor.timeline.map(group => both(known,
    group.selection === undefined ? undefined : run.selectionGate(group.selection.inputField, group.selection.selectedWhen),
    omitted.has(group.key) ? [{ [`skip-${group.key}`]: ["run"] }] : undefined,
    either(known, group.nodes.map(member => nodeGate(member.id))),
    reviews.get(group.key)?.when));
  const continueText = (index: number): string => {
    const next = descriptor.timeline[index + 1];
    return next === undefined ? "The run finishes." : stepGates[index + 1] === undefined ? `Continues to ${next.label}.` : "Continues to the next step.";
  };
  const decisionReads = new Map<string, { decision: string; values: readonly string[] }>();
  const sources: Spec["sources"] = {};
  const systemOf = (stepKey: string) => descriptor.timeline.find(group => group.key === stepKey)?.system;

  const steps = descriptor.timeline.map((group, index): Step => {
    const review = reviews.get(group.key);
    const stepGate = stepGates[index];
    const description: Step["description"] = group.description === undefined ? [] : [{ text: group.description }];
    const checks: Step["checks"] = [];
    const blocks: Block[] = [];
    const displayOf = (nodeId: string, fieldPath: string): OperatorFieldDisplay | undefined => descriptor.timeline.flatMap(candidate => candidate.operatorFields ?? [])
      .find(field => field.display !== undefined && field.sources.some(source => source.nodeId === nodeId && source.kind === "output" && source.fieldPath === fieldPath))?.display;
    const outputSample = (references: readonly { nodeId: string; kind: "input" | "output"; fieldPath: string }[], display: OperatorFieldDisplay | undefined): string | undefined => {
      for (const reference of references) {
        if (reference.kind !== "output") continue;
        const node = runtimeNode(reference.nodeId);
        const example = node.kind === "task" ? node.uses.example : node.kind === "transaction" ? node.prepare.uses.example : undefined;
        const sample = sampleText(scalarAt(example, reference.fieldPath.split(".")), display);
        if (sample !== undefined) return sample;
      }
      return undefined;
    };
    const byDecision = (references: readonly { nodeId: string; kind: "input" | "output"; fieldPath: string }[], display: OperatorFieldDisplay | undefined, sample: string | undefined): ExplorerSpecValue | undefined => {
      if (display === undefined || sample === undefined) return sample;
      for (const reference of references) {
        const read = reference.kind === "output" ? decisionReads.get(`${reference.nodeId}/${reference.fieldPath}`) : undefined;
        if (read === undefined) continue;
        const values = Object.fromEntries(display.cases.filter(entry => read.values.includes(String(entry.value))).map(entry => [String(entry.value), entry.text]));
        return Object.keys(values).length === 0 ? sample : { by: read.decision, values, otherwise: sample };
      }
      return sample;
    };
    // Declared decisions are known before the step's rows so a row that reads the same output follows its outcome.
    for (const decision of review?.decisions ?? []) {
      decisionReads.set(`${decision.reads.nodeId}/${decision.reads.fieldPath}`, { decision: decision.id, values: decision.outcomes.map(outcome => outcome.value) });
    }
    for (const page of review?.pages ?? []) {
      const pageGate = both(known, page.when, either(known, page.nodeIds.map(nodeGate)));
      const rows = page.fields.map(field => {
        const id = `${group.key}/${page.id}/${field.id}`;
        sources[id] = { origin: field.source.origin, detail: field.source.detail, reads: [field.source.read, ...field.source.chain.map(link => link.read)]
          .flatMap(read => read === undefined ? [] : [{ ...(systemOf(read.stepKey) === undefined ? {} : { system: systemOf(read.stepKey) }), step: read.stepKey, page: read.page, field: read.field }]) };
        const row = (label: string, value: ExplorerSpecValue | undefined, when: When | undefined) => ({ id: field.id, label, ...(value === undefined ? {} : { value }), source: id, ...gated(when) });
        if ("operatorField" in field) {
          const operator = group.operatorFields?.find(candidate => candidate.label === field.operatorField && candidate.visibility !== "logs");
          if (operator === undefined) throw new Error(`workflow ${descriptor.id} review field ${field.id} has no visible operator field ${field.operatorField}`);
          const sample = operator.example ?? outputSample(operator.sources, operator.display);
          return row(operator.label, byDecision(operator.sources, operator.display, sample), field.when);
        }
        if ("inputField" in field) return row(field.label, field.example, both(known, field.when, run.inputGate(field.inputField)));
        if ("constant" in field) return row(field.label, field.example ?? sampleText(field.constant.value, undefined), field.when);
        const references = "taskFields" in field ? field.taskFields : field.transactionFields;
        const display = "display" in field ? field.display : undefined;
        return row(field.label, byDecision(references, display, field.example ?? outputSample(references, display)), field.when);
      });
      blocks.push({ kind: "card", id: page.id, title: page.title, mode: page.mode === "Fill form" ? "fill" : "read", ...gated(pageGate), rows });
      for (const line of page.lines) {
        const when = both(known, pageGate, line.when);
        if (line.kind === "click") blocks.push({ kind: "click", target: line.target, ...gated(when) });
        else (line.kind === "check" ? checks : description).push({ text: line.text, ...gated(when) });
      }
    }

    for (const start of review?.starts ?? []) {
      const node = runtimeNode(start.nodeId);
      if (node.kind !== "child-run") throw new Error(`workflow ${descriptor.id} review starts ${start.nodeId}, which is not a child run`);
      const child = modules.find(candidate => candidate.descriptor.id === node.target.id);
      if (child === undefined) throw new Error(`workflow ${descriptor.id} review starts absent workflow ${node.target.id}`);
      blocks.push({ kind: "starts", workflowId: node.target.id, title: child.descriptor.label, each: start.each,
        ...gated(both(known, start.when, nodeGate(node.id))) });
    }

    const decisions: { block: Decision; nodeIds: readonly string[] }[] = [];
    const continuing = (value: string, label: string, when?: When): Outcome => ({ value, label, then: continueText(index), stops: false, ...gated(when) });
    for (const decision of review?.decisions ?? []) {
      const display = displayOf(decision.reads.nodeId, decision.reads.fieldPath);
      decisions.push({ nodeIds: decision.nodeIds, block: { kind: "decision", id: decision.id, label: decision.label, initial: decision.initial,
        ...gated(both(known, decision.when, nodeGate(decision.reads.nodeId))), outcomes: decision.outcomes.map(outcome => {
          const label = outcome.label ?? display?.cases.find(entry => String(entry.value) === outcome.value)?.text;
          if (label === undefined) throw new Error(`workflow ${descriptor.id} review decision ${decision.id} outcome ${outcome.value} has no label`);
          return { value: outcome.value, label, then: outcome.then ?? continueText(index), stops: outcome.stops === true, ...gated(outcome.when) };
        }) } });
    }
    for (const member of group.nodes) {
      const node = nodeWire(member.id);
      const point = (initial: ExplorerSpecValue, outcomes: Outcome[]) => decisions.push({ nodeIds: [node.id],
        block: { kind: "decision", id: node.id, label: node.label, initial, ...gated(nodeGate(node.id)), outcomes } });
      const { shape } = node;
      if (shape.kind === "branch") {
        point(shape.cases[0]?.name ?? "", shape.cases.map(branch => {
          const label = review?.branchLabels.find(candidate => candidate.nodeId === node.id && candidate.outcome === branch.name)?.label;
          if (label === undefined) throw new Error(`workflow ${descriptor.id} review branch ${node.id}/${branch.name} has no label`);
          return continuing(branch.name, label);
        }));
      } else if (shape.kind === "gate" && shape.resolvedBy === "operator") {
        if (!decisions.some(decision => decision.nodeIds.includes(node.id))) {
          point("waits", [{ value: "waits", label: "Waits for you", then: "Waits for you to resolve it in Logs, then continues.", stops: false }]);
        }
      } else if (shape.kind === "transaction") {
        const live = previewsOnDryRun(node) ? LIVE : undefined;
        point(live === undefined ? "saved" : { by: DRY_RUN, values: { true: DRY_RUN }, otherwise: "saved" }, [continuing("saved", "Saved", live),
          { value: "already-present", label: "Already present", then: "Uses the verified existing change without saving it again, then continues.", stops: false },
          { value: "unconfirmed", label: "Save unconfirmed", then: "Parks the write for your review in Logs and does not retry it.", stops: true, ...gated(live) },
          ...(live === undefined ? [] : [{ value: DRY_RUN, label: "Dry run", then: "Prepares the change without saving it, then continues.", stops: false, ...gated(DRY) }])]);
      } else if (shape.kind === "child-run" && shape.await === "terminal" && shape.onChildFailed !== "allow-partial") {
        point("succeeded", [continuing("succeeded", "Delegated work succeeds"), shape.onChildFailed === "fail-parent"
          ? { value: "child-failed", label: "Delegated work fails", then: STOPS, stops: true }
          : { value: "child-failed", label: "Delegated work fails", then: "Holds this run for your review in Logs.", stops: false }]);
      }
    }
    const generic: Decision = { kind: "decision", id: `${group.key}-result`, label: "Step result", initial: "succeeded", outcomes: [continuing("succeeded", "Finishes")] };
    for (const member of group.nodes) {
      const node = nodeWire(member.id);
      const owner = decisions.find(candidate => candidate.nodeIds.includes(node.id))?.block ?? generic;
      if (node.shape.kind === "task" && node.shape.dryRun === "stop-before-publish" && known.has(DRY_RUN) && !owner.outcomes.some(outcome => outcome.value === DRY_RUN)) {
        owner.outcomes.push({ value: DRY_RUN, label: "Dry run", then: "Prepares the output without publishing it, then continues.", stops: false, ...gated(DRY) });
        if (typeof owner.initial === "string") owner.initial = { by: DRY_RUN, values: { true: DRY_RUN }, otherwise: owner.initial };
      }
      for (const task of node.tasks) for (const code of task.errorCodes) {
        // A dry run prepares a transaction and never commits it, so commit failures apply only to a live run.
        const when = both(known, nodeGate(node.id), task.arm === "commit" && previewsOnDryRun(node) ? LIVE : undefined);
        const existing = owner.outcomes.findIndex(outcome => outcome.value === code);
        const previous = owner.outcomes[existing];
        const outcome: Outcome = { value: code, label: operatorFailureSentence(failureCodeFromTaskCode(code)), then: STOPS, stops: true,
          ...gated(previous === undefined ? when : either(known, [previous.when, when])) };
        if (previous === undefined) owner.outcomes.push(outcome); else owner.outcomes[existing] = outcome;
      }
    }
    if (generic.outcomes.length > 1) decisions.push({ nodeIds: [], block: generic });
    for (const { block } of decisions) {
      blocks.push(block);
      known.set(block.id, block.outcomes.map(outcome => outcome.value));
    }
    return { id: group.key, title: group.label, ...(group.system === undefined ? {} : { system: group.system }), ...gated(stepGate), description, checks, blocks };
  });

  const sessions = new Map<string, (When | undefined)[]>();
  const visit = (current: ExplorerModuleView, gate: (stepIndex: number, nodeId: string) => When | undefined, ancestry: readonly string[]): void => {
    const workflowId = current.descriptor.id;
    if (ancestry.includes(workflowId)) throw new Error(`workflow ${workflowId} review session delegation cycle`);
    const nodesOf = descriptorRuntimeNodes(current.descriptor);
    for (const [stepIndex, group] of current.descriptor.timeline.entries()) for (const member of group.nodes) {
      const node = nodesOf.find(candidate => candidate.id === member.id);
      if (node === undefined) throw new Error(`workflow ${workflowId} review session names unknown node ${member.id}`);
      const contracts = node.kind === "task" ? [node.uses] : node.kind === "transaction" ? [node.prepare.uses, node.commit.uses] : [];
      for (const contract of contracts) for (const store of current.stores) for (const task of Object.values(store.tasks)) {
        if (task.contract !== contract || store.kind !== "browser") continue;
        for (const need of task.impl.sessions) sessions.set(need.system, [...sessions.get(need.system) ?? [], gate(stepIndex, node.id)]);
      }
      if (node.kind !== "child-run") continue;
      const child = modules.find(candidate => candidate.descriptor.id === node.target.id);
      if (child === undefined) throw new Error(`workflow ${workflowId} delegates to ${node.target.id}, which is absent from the catalog`);
      const delegated = gate(stepIndex, node.id);
      visit(child, () => delegated, [...ancestry, workflowId]);
    }
  };
  visit(module, (stepIndex, nodeId) => both(known, stepGates[stepIndex], nodeGate(nodeId)), []);
  // Sessions open before the run starts, so a chip follows run options only; conditions on outcomes are dropped.
  const optionsOnly = (gate: When | undefined): When | undefined => gate === undefined ? undefined
    : simplify(gate.map(condition => Object.fromEntries(Object.entries(condition).filter(([key]) => run.choices.has(key)))), run.choices);

  return ExplorerReviewSpecSchema.parse({
    unlistedFailure: "Anything not listed stops the run with a failure card.",
    options: run.options,
    sessions: [...sessions].map(([system, gates]) => ({ system, ...gated(either(run.choices, gates.map(optionsOnly))) })),
    steps, sources,
  });
}
