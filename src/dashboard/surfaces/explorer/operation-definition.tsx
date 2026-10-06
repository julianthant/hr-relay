import { useRef, useState } from "react";
import { Link2 } from "lucide-react";
import type { WorkflowOperationDisplaySnapshot } from "../../../domain/workflow/operation-display-snapshot.js";
import { Button, Dialog, DialogBody, DialogContent, Input, dsIcon, dsText } from "../../ds/ui.js";
import { definitionValueSources, operationFieldTemplate, type OperationAction, type OperationInvocation } from "./operation-structure-model.js";
import { renderDisplayTemplate, type DisplayTemplate } from './operation-template-model.js';

function TemplateSegments({ segments }: { segments: readonly DisplayTemplate['segments'][number][] }) {
  return <div className="operation-template-segments">{segments.map((segment, index) => segment.kind === "literal" ? <span key={index}>{segment.value}</span> : segment.kind === "variable" ? <mark key={index}>{`{${segment.variable}}`}</mark> : <div key={index} className="operation-template-clause"><span className={dsText.meta}>{segment.when.variable} {segment.when.kind}{segment.when.value === undefined ? "" : ` ${JSON.stringify(segment.when.value)}`}</span><TemplateSegments segments={segment.segments} /></div>)}</div>;
}

export function OperationFieldTemplate({ invocation, action, observed = false }: { invocation: OperationInvocation; action: OperationAction; observed?: boolean }) {
  const template = operationFieldTemplate(invocation, action);
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  if (template === undefined) return null;
  let preview: string | undefined;
  if (template.variables.every((variable) => values[variable.id] !== undefined)) preview = renderDisplayTemplate(template, values);
  return <details className="operation-template"><summary className={dsText.meta}>Template</summary>
    <TemplateSegments segments={template.segments} />
    {!observed && <><div className="operation-template-inputs">{template.variables.map((variable) => <label key={variable.id} className={dsText.meta}>{variable.id}<Input aria-label={`${action.label ?? action.id} preview ${variable.id}`} value={values[variable.id] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [variable.id]: event.target.value }))} /></label>)}</div>
    <div className="operation-template-preview"><span className={dsText.meta}>Template preview</span><p>{preview ?? "Enter preview values"}</p></div></>}
  </details>;
}

export function OperationDefinitionSource({ definition, invocation, action, onJump }: { definition: WorkflowOperationDisplaySnapshot; invocation: OperationInvocation; action: OperationAction; onJump: (invocationId: string, actionId: string, trigger: HTMLButtonElement) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const jumping = useRef(false);
  const sources = action.valueSlot === undefined ? [] : definitionValueSources(definition, invocation, action.valueSlot);
  return <>
    <Button ref={trigger} size="sm" variant="ghost" onClick={() => setOpen(true)}><Link2 aria-hidden className={dsIcon.sm} />Value source</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent title="Value source" description="Declared producer and inputs" size="lg" onCloseAutoFocus={(event) => { event.preventDefault(); if (!jumping.current) trigger.current?.focus(); jumping.current = false; }}><DialogBody>
      {sources.length === 0 && <p>Source association unavailable in this definition.</p>}
      {sources.map((source, index) => <div key={index} className="operation-definition-source"><span>{source.label}</span>{source.invocationId !== undefined && source.actionId !== undefined && <Button size="sm" variant="secondary" onClick={() => {
        if (trigger.current === null) return;
        jumping.current = true; setOpen(false); onJump(source.invocationId!, source.actionId!, trigger.current);
      }}>Go to field</Button>}</div>)}
      <Button size="toolbar" variant="secondary" onClick={() => setOpen(false)}>Return to value</Button>
    </DialogBody></DialogContent></Dialog>
  </>;
}
