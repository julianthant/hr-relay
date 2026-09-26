import { Form } from "@heroui/react";
import { Plus, Trash2 } from "lucide-react";
import { useReducer, useRef } from "react";
import type { EditableSettingsLeafWire } from "../../domain/dashboard/settings-editor.js";
import { Banner, BodySection, Button, Disclosure, Field, FormGroup, IconButton, Input, PageHeading, RankedList, Spinner, dsIcon, dsText } from "../ds/ui.js";
import { formatSetting, settingInput } from "./settings-draft-model.js";
import type { useEditableSettings } from "./settings-editor-model.js";
import { SettingsSaveFeedback } from "./settings-feedback.js";
import { modelRaw, modelRows, removeModelRow, reorderModelRows, updateModelRow, type ProviderModelRow } from "./settings-ranked-models.js";
import { providerFieldPresentation, providerName } from "./ui-settings-records-labels.js";
import { SettingsRowActions } from "./ui-settings-records-row-actions.js";
import "./settings-provider.css";

type Editor = ReturnType<typeof useEditableSettings>;

const BUDGETS = ["ocrExtract", "geocodeCensus", "geocodeNominatim", "aiAdvisory"] as const;
const MODELS = ["gemini", "groq", "mistral", "openRouter", "sambanova"] as const;
const BUDGET_DESCRIPTIONS: Readonly<Record<string, string>> = {
  ocrExtract: "Document reading and extraction.",
  geocodeCensus: "Census address lookups.",
  geocodeNominatim: "Nominatim address lookups.",
  aiAdvisory: "Advisory requests.",
};

function providerLeaves(leaves: readonly EditableSettingsLeafWire[]) {
  const paths = [...BUDGETS.map(key => `providers.${key}`), ...MODELS.map(key => `providers.${key}.models`)];
  if (leaves.length !== paths.length || new Set(leaves.map(leaf => leaf.path)).size !== paths.length
    || paths.some(path => !leaves.some(leaf => leaf.path === path))) throw new Error("settings-provider-leaves-unexpected");
  return new Map(leaves.map(leaf => [leaf.path, leaf]));
}

function requiredLeaf(leaves: Map<string, EditableSettingsLeafWire>, path: string): EditableSettingsLeafWire {
  const leaf = leaves.get(path);
  if (leaf === undefined) throw new Error(`settings-provider-leaf-missing:${path}`);
  return leaf;
}

function BudgetEditor({ editor, leaf, description, first }: { editor: Editor; leaf: EditableSettingsLeafWire; description: string; first: boolean }) {
  const operation = editor.draft[leaf.path];
  const raw = operation?.kind === "set" ? operation.raw : settingInput(leaf, operation?.kind === "clear" ? leaf.defaultValue ?? "" : leaf.effectiveValue);
  if (typeof raw === "string" || leaf.control.input !== "object") throw new Error(`settings-provider-budget-invalid:${leaf.path}`);
  const name = providerName(leaf.path.split(".")[1] ?? "");
  return <Disclosure variant="body" summary={name} description={description} defaultOpen={first}
    className="settings-provider-disclosure" contentClassName="settings-provider-budget-content">
    <div data-settings-path={leaf.path} className="settings-provider-budget">
      <div className="settings-provider-grid">{leaf.control.fields.map(field => {
        const presented = providerFieldPresentation(field.name);
        return <Field key={field.name} label={presented.label} description={presented.unit} required={field.required} disabled={editor.locked}>
          <Input type="number" min={field.minimum} step={1} aria-label={`${name}: ${presented.label}`} value={raw[field.name] ?? ""}
            aria-invalid={editor.errors[leaf.path] !== undefined || undefined} disabled={editor.locked}
            onChange={event => editor.update(leaf.path, { ...raw, [field.name]: event.target.value })} />
        </Field>;
      })}</div>
      {editor.errors[leaf.path] !== undefined && <p role="alert" className="settings-provider-error">{editor.errors[leaf.path]}</p>}
      <SettingsRowActions editor={editor} leaf={leaf} />
      {editor.save.state === "conflict" && operation !== undefined && <p className={dsText.meta}>Current value: {formatSetting(leaf.effectiveValue)}</p>}
      {leaf.hazard !== undefined && <p className={dsText.meta}>{leaf.hazard}</p>}
    </div>
  </Disclosure>;
}

function ModelEditor({ editor, leaf, first }: { editor: Editor; leaf: EditableSettingsLeafWire; first: boolean }) {
  const operation = editor.draft[leaf.path];
  const raw = operation?.kind === "set" ? operation.raw : settingInput(leaf, operation?.kind === "clear" ? leaf.defaultValue ?? "" : leaf.effectiveValue);
  if (typeof raw !== "string" || leaf.input !== "models") throw new Error(`settings-provider-model-invalid:${leaf.path}`);
  const source = operation?.kind ?? "none";
  const rowsRef = useRef<{ raw: string; source: string; rows: ProviderModelRow[] }>({ raw, source, rows: modelRows(raw, [], () => crypto.randomUUID()) });
  const [, refresh] = useReducer(value => value + 1, 0);
  if (rowsRef.current.raw !== raw || rowsRef.current.source !== source) rowsRef.current = { raw, source, rows: modelRows(raw, rowsRef.current.rows, () => crypto.randomUUID()) };
  const rows = rowsRef.current.rows;
  const name = providerName(leaf.path.split(".")[1] ?? "");
  const update = (next: ProviderModelRow[]) => {
    const nextRaw = modelRaw(next);
    rowsRef.current = { raw: nextRaw, source: "set", rows: next };
    refresh();
    editor.update(leaf.path, nextRaw);
  };
  return <Disclosure variant="body" summary={name} meta={`${rows.length} ${rows.length === 1 ? "model" : "models"}`} defaultOpen={first}
    className="settings-provider-disclosure" contentClassName="settings-provider-model-content">
    <div data-settings-path={leaf.path} className="settings-provider-models">
      <RankedList label={`${name} model priority`} disabled={editor.locked} items={rows.map((row, index) => ({
        id: row.id, label: row.value || `Model ${index + 1}`, role: index === 0 ? "Primary" : "Fallback",
        content: <Input aria-label={`${name} model ${index + 1}`} value={row.value} maxLength={256} disabled={editor.locked}
          aria-invalid={(row.value.length === 0 || row.value.length > 256 || /[\s,]/u.test(row.value)) || undefined}
          onChange={event => update(updateModelRow(rowsRef.current.rows, row.id, event.target.value))} />,
        actions: <IconButton type="button" size="xs" variant="ghost" label={`Remove ${name} model ${index + 1}`} disabled={editor.locked}
          icon={<Trash2 aria-hidden className={dsIcon.sm} />} onClick={() => update(removeModelRow(rowsRef.current.rows, row.id))} />,
      }))} onReorder={ordered => update(reorderModelRows(rowsRef.current.rows, ordered.map(item => item.id)))} />
      <div className="settings-provider-model-actions"><SettingsRowActions editor={editor} leaf={leaf} />
        <Button type="button" size="md" variant="secondary" icon={<Plus aria-hidden className={dsIcon.sm} />} className="settings-provider-add" disabled={editor.locked || rows.length >= 32}
          onClick={() => update([...rowsRef.current.rows, { id: crypto.randomUUID(), value: "" }])}>Add model</Button>
      </div>
      {editor.errors[leaf.path] !== undefined && <p role="alert" className="settings-provider-error">Enter a model name for each row, without spaces or commas.</p>}
      {editor.save.state === "conflict" && operation !== undefined && <p className={dsText.meta}>Current value: {formatSetting(leaf.effectiveValue)}</p>}
      {leaf.validity === "unset" && rows.length === 0 && <p className={dsText.meta}>No model preference is set.</p>}
      {leaf.hazard !== undefined && <p className={dsText.meta}>{leaf.hazard}</p>}
    </div>
  </Disclosure>;
}

export function ProviderSettingsSection({ editor }: { editor: Editor }) {
  if (editor.editor.state === "loading") return <Spinner label="Reading editable settings" />;
  if (editor.editor.state === "failed") return <Banner tone="danger" title="Editable settings could not be read"><Button size="sm" onClick={editor.reload}>Try again</Button></Banner>;
  const document = editor.editor.document;
  const section = document.sections.find(candidate => candidate.id === "providers");
  if (section === undefined) return <Banner tone="danger" title="Provider settings unavailable">The settings document did not include provider settings.</Banner>;
  const leaves = providerLeaves(section.leaves);
  return <section className="settings-compact-page settings-provider-page">
    <PageHeading title="Provider budgets & models" description="Request limits and model preferences for each provider." />
    <Form validationBehavior="aria" className="settings-compact-form" onSubmit={event => { event.preventDefault(); editor.submit(); }}>
      {document.runtimeStatus.state === "restart-required" && <Banner tone="warning" title="Restart required">Settings revision {String(document.runtimeStatus.persisted.settingsRevision)} is saved; this dashboard still runs revision {String(document.runtimeStatus.active.settingsRevision)}.</Banner>}
      {editor.readProblem !== undefined && <Banner tone="warning" title="Current settings unavailable">{editor.readProblem} <Button size="sm" onClick={editor.reload}>Refresh current values</Button></Banner>}
      <SettingsSaveFeedback save={editor.save} retry={editor.retry} retryConflict={editor.submit} />
      <div className="ds-body-stack">
        <BodySection title="Request budgets"><FormGroup label="Request budgets">
          {BUDGETS.map((key, index) => <BudgetEditor key={key} editor={editor} leaf={requiredLeaf(leaves, `providers.${key}`)} description={BUDGET_DESCRIPTIONS[key] ?? ""} first={index === 0} />)}
        </FormGroup></BodySection>
        <BodySection title="Model priority"><FormGroup label="Model priority">
          {MODELS.map((key, index) => <ModelEditor key={key} editor={editor} leaf={requiredLeaf(leaves, `providers.${key}.models`)} first={index === 0} />)}
        </FormGroup></BodySection>
      </div>
    </Form>
  </section>;
}
