import type { RefObject, ReactNode } from "react";
import { Check, CircleAlert, FlaskConical, X } from "lucide-react";
import { useEffect, useId, useMemo } from "react";
import type { SurfaceField, InputRunSurface, TypedDateControl, TypedInputDraft } from "../../../models/workflow/ingress.js";
import { cn } from "../../lib/utils.js";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
  DateInput,
  Field,
  Input,
  IconButton,
  MetaLine,
  Select,
  Switch,
  Textarea,
  Well,
  dsFg,
  dsIcon,
  dsText,
} from "../../ds/ui.js";
import { formatTime } from "../../lib/date-format.js";
import type { StartPlanResponse } from "../../client/index.js";
import { surfaceValueLabel } from "./run-start-kit-model.js";
import { newestWorksheet } from "./run-start-spreadsheets-model.js";
import { FailureNotice } from "../../ds/primitives/failure-notice.js";
import { RunList, RunListRow, RunSection } from "../../ds/primitives/run-list.js";
import { RunChoice } from "./run-launch-layout.js";
import { MAX_SELECTED_WORKBOOK_SOURCES } from "../../../rules/spreadsheets/workbook-size.js";
import { SpreadsheetPicker, SpreadsheetRow, SpreadsheetSection, type PickerOption, type SheetVersion, type SheetWorksheet } from "./run-spreadsheet-picker.js";
import { typedInputMode, typedInputDefaults, inputRunFieldLabel, type RunInputPreview, type StepOmissionDraft, type StepOmissionFactDraft } from "./run-start-model.js";
import type { StepOmissionForm } from "../../../models/workflow/step-omission.js";
/** the non-default run flags shown in the preview and confirmation */
export function RunFlagChips({
  dryRun,
  priority,
}: {
  dryRun: boolean;
  priority?: "interactive" | "bulk";
}) {
  return (
    <span className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
      {dryRun && (
        <Badge tone="info">
          <FlaskConical aria-hidden className={dsIcon.sm} />
          dry run
        </Badge>
      )}
      {/** Only when it is NOT the default. */}
      {priority === "bulk" && <Badge tone="neutral">bulk</Badge>}
    </span>
  );
}

// Sub-selections — what the workflow's own input surface FIXES

/** One sub-selection, rendered the same way for every workflow that declares
 * one; a descriptor declares only its input surface */
export function StartChoiceControl({ constant, reason }: { constant: SurfaceField; reason: string }) {
  return <LockedFact label={constant.field} value={surfaceValueLabel(constant)} reason={reason} />;
}

/** Fixed workflow facts use plain read-only values rather than disabled controls. */
export function LockedFact({ label, value, reason }: { label: string; value: string; reason: string }) {
  return <div><span className={cn(dsText.meta, "font-medium", dsFg.secondary)}>{label}</span><p className={cn(dsText.body, "mt-[var(--ds-space-tight)]", dsFg.base)}>{value}</p><p className={cn(dsText.meta, "mt-[var(--ds-space-tight)]", dsFg.muted)}>{reason}</p></div>;
}

/** A run flag. A `Checkbox`, deliberately, and not a `Switch`: nothing here
 * takes effect until the primary action is pressed, and the switch primitive's */
export function StartFlagControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={(next) => onChange(next === true)}
      label={label}
    />
  );
}

// Plan preview — what this start WILL create

/** The server's exact proposal. Every column is a served identity: nothing here
 * is derived, counted, or renamed, because the operator is about to authorise */
export function PlanPreview({
  plan,
  className,
  compact = false,
}: {
  plan: StartPlanResponse;
  className?: string;
  compact?: boolean;
}) {
  return (
    <section className={cn("flex flex-col gap-[var(--ds-space-base)]", className)}>
      {!compact && <div className="flex flex-wrap items-center gap-[var(--ds-space-base)]">
        <span className={cn(dsText.ui, "font-medium", dsFg.base)}>
          {plan.planned.length === 1 ? "1 run" : `${String(plan.planned.length)} runs`}
        </span>
        <RunFlagChips dryRun={plan.dryRun} priority={plan.priority} />
      </div>}

      {plan.planned.length === 0 ? (
        <Well>
          <span className={dsFg.muted}>Nothing to create — every entry was refused.</span>
        </Well>
      ) : (
        <ul aria-label="Runs this start will create" className="flex flex-col gap-[var(--ds-space-snug)]">
          {plan.planned.map((row) => (
            <li key={row.logicalKey}>
              <PlanRowCard row={row} />
              {row.supersedeTargets !== undefined && (
                <div className="flex flex-col gap-[var(--ds-space-tight)] py-[var(--ds-space-snug)]">
                  <span className={dsText.body}>{row.supersedeTargets.length === 0 ? "No active runs to replace." : "Active runs to replace:"}</span>
                  {row.supersedeTargets.map((target) => <MetaLine key={target.runId}
                    items={[target.traceId, target.runId, `revision ${target.version}`, `attempt ${target.attempt}`, `generation ${target.claimGeneration}`]} />)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <MetaLine
        tone="faint"
        items={[
          `plan ${plan.startPlanId}`,
          `planned by ${plan.plannedBy}`,
          // C61 — an operator-facing instant is a clock reading, never a raw
          // ISO string. Same defect the context rail's R6 f.10 fixed.
          `expires ${formatTime(plan.expiresAt)}`,
        ]}
      />
    </section>
  );
}

/** Render only planned fields; absent role, containment and status facts must not be invented. */
function PlanRowCard({ row }: { row: StartPlanResponse["planned"][number] }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-[var(--ds-space-tight)] py-[var(--ds-space-snug)]">
        <div className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-base)]">
          <span className={cn(dsText.ui, "min-w-0 flex-1 truncate font-medium", dsFg.base)}>{row.title}</span>
        </div>
        {/* Wrap complete match keys; truncated subject identity cannot rely on pointer-only recovery. */}
        <MetaLine
          items={[
            row.subtitle,
            `match key ${row.matchKey}`,
          ]}
        />
      </CardBody>
    </Card>
  );
}

/** The failed spreadsheet list, drawn under its own heading with no empty card. */
function ReferenceFailure({ locked, onRefresh }: { locked: boolean; onRefresh: () => void }) {
  return <FailureNotice sentence="Couldn't load spreadsheets." {...(locked ? {} : { action: { label: "Retry", onClick: onRefresh } })} />;
}

export interface StageSpec {
  key: string;
  label: string;
}

/** Re-enter completed stages to correct input; future stages cannot skip planning. */
export function StageRail({
  stages,
  current,
  reachable,
  onSelect,
}: {
  stages: readonly StageSpec[];
  current: string;
  reachable: ReadonlySet<string>;
  onSelect: (key: string) => void;
}) {
  const currentIndex = stages.findIndex((stage) => stage.key === current);
  return (
    <nav
      aria-label={`Start stages — step ${String(currentIndex + 1)} of ${String(stages.length)}`}
      className="flex flex-wrap items-center gap-[var(--ds-space-tight)]"
    >
      {stages.map((stage, index) => {
        const isCurrent = stage.key === current;
        const canGo = reachable.has(stage.key);
        const settled = canGo && index < currentIndex;
        return (
          <span key={stage.key} className="flex items-center gap-[var(--ds-space-tight)]">
            {index > 0 && (
              <span aria-hidden className={cn(dsText.meta, index <= currentIndex ? dsFg.muted : dsFg.faint)}>
                ›
              </span>
            )}
            <Button
              size="sm"
              variant={isCurrent ? "primary" : canGo ? "outline" : "ghost"}
              disabled={!canGo && !isCurrent}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onSelect(stage.key)}
            >
              {settled ? (
                <Check aria-hidden className={cn(dsIcon.sm, "text-[color:var(--ds-success-fg)]")} />
              ) : (
                <span className={cn(dsText.nums, isCurrent ? "opacity-80" : "opacity-60")}>{index + 1}</span>
              )}
              {stage.label}
            </Button>
          </span>
        );
      })}
    </nav>
  );
}



/** Use declared field controls and schema refusals; do not invent another validation vocabulary. */
export function StepOmissionFactsForm({
  step,
  form,
  draft,
  errors,
  onChange,
  copied,
  disabled = false,
}: {
  step: string;
  form: StepOmissionForm;
  draft: StepOmissionDraft;
  /** field key → the refusal to draw; a key absent from it draws its help line */
  errors: Readonly<Record<string, string>>;
  onChange: (fieldKey: string, next: StepOmissionFactDraft) => void;
  /** The run is starting; nothing in the form changes. */
  disabled?: boolean;
  /** Field keys still holding a value copied unedited from the earlier run. */
  copied?: ReadonlySet<string>;
}) {
  if (form.fields.length === 0) return null;
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-[var(--ds-space-cozy)] @md:grid-cols-2">
      {/* The legend names the group, so a screen reader landing inside it knows which step these boxes belong to. */}
      <legend className="sr-only">{`Manual values for ${step}`}</legend>
      {form.fields.map((field) => {
        const value = draft[field.key];
        const error = errors[field.key] ?? null;
        const help = field.help;
        const savedControl = copied?.has(field.key) === true ? <p className="mt-1 text-caption text-ui-muted">From the earlier run</p> : null;
        if (field.kind === "boolean") {
          return (
            <div key={field.key}>
            <Checkbox
              checked={value === true}
              disabled={disabled}
              onCheckedChange={(next) => onChange(field.key, next === true)}
              label={field.label}
              {...(help === undefined ? {} : { description: help })}
            />
            {savedControl}
            </div>
          );
        }
        const text = typeof value === "string" ? value : "";
        const commonField = {
          label: field.label,
          ...(help === undefined ? {} : { description: help }),
          error,
          disabled,
        };
        if (field.kind === "enum") {
          return (
            <Field key={field.key} {...commonField}>
              <Select
                value={text}
                onChange={(event) => onChange(field.key, event.target.value)}
              >
                {/* Do not preselect asserted facts; real-person answers require an explicit operator choice. */}
                <option value="">Choose a value…</option>
                {field.values.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
              {savedControl}
            </Field>
          );
        }
        if (field.kind === "text-list") {
          return (
            <Field key={field.key} {...commonField} hint="One per line">
              <Textarea
                rows={3}
                value={text}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
              {savedControl}
            </Field>
          );
        }
        return (
          <Field key={field.key} {...commonField}>
            {field.kind === "us-date" || field.kind === "iso-date" ? <DateInput label={field.label} textEntry textDateFormat="MM/DD/YYYY" value={text} disabled={disabled} onChange={next => onChange(field.key, next)} /> : <Input
              value={text}
              {...(field.kind === "eid" ? { placeholder: "12345678", inputMode: "numeric" as const } : {})}
              {...(field.kind === "integer" ? { inputMode: "numeric" as const } : {})}
              onChange={(event) => onChange(field.key, event.target.value)}
            />}
            {savedControl}
          </Field>
        );
      })}
    </fieldset>
  );
}

/** The approved grey lines under the Lookup rows, by the mode label or control field they describe. */
const INPUT_NOTES: Readonly<Record<string, string>> = { "Lookup mode": "Search by ID or name, or match on details.", crmCheck: "Cross-check each person against CRM.", effectiveDate: "The day the change takes effect." };

/** The approved Lookup / Input / Parsed input layout, used by the served Run and Rerun dialogs and the design preview alike. */
export function TypedInput({
  surface,
  workflowId,
  text,
  onText,
  preview,
  inputRef,
  autoFocus = true,
  draft = {},
  locked = false,
  onValue,
  rowInput,
  rowsOwnNotice = false,
}: {
  rowInput?: ReactNode;
  /** The row input already shows its own read failure. */
  rowsOwnNotice?: boolean;
  /** Focus the box on mount; Rerun leaves focus to the dialog, which puts it on Close. */
  autoFocus?: boolean;
  surface: InputRunSurface;
  workflowId: string;
  text: string;
  onText: (next: string) => void;
  preview: RunInputPreview;
  draft?: TypedInputDraft;
  /** A start is out; nothing here changes. */
  locked?: boolean;
  onValue?: (field: string, value: string | boolean) => void;
  /** the dialog's handle on the box, so an exit from a banner can focus it */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const errorBase = useId();
  const declaration = surface.typedInput;
  const values = declaration === undefined ? draft : { ...typedInputDefaults(declaration), ...draft };
  const mode = declaration === undefined ? undefined : typedInputMode(declaration, values);
  const inputControls = declaration?.controls.filter(control => control.placement === "input" && control.modes.includes(mode?.value ?? "")) ?? [];
  const switches = inputControls.filter(control => !("kind" in control));
  const dates = inputControls.filter((control): control is TypedDateControl => "kind" in control);
  const editableParser = declaration === undefined ? surface.parser : mode?.parser.kind === "entries" ? mode.parser.spec : undefined;
  const separator = editableParser?.split.kind === "delimited"
    ? editableParser.split.delimiters.find(delimiter => declaration?.modes.some(candidate =>
      candidate.parser.kind === "name-tuple" && candidate.parser.delimiter === delimiter))
      ?? (editableParser.split.delimiters.includes("\n") ? "\n" : editableParser.split.delimiters[0])
    : "";
  const entryText = (entries: RunInputPreview["entries"]) => entries.map(entry => entry.sourceText).join(separator);
  const inputLabel = mode?.inputLabel ?? inputRunFieldLabel(surface.parser);
  const box = <Textarea key={workflowId} ref={inputRef} autoFocus={autoFocus} rows={4} value={text} disabled={locked} aria-label={inputLabel}
      placeholder={mode?.placeholder ?? (inputRunFieldLabel(surface.parser) === "Kuali ID" ? surface.placeholder.replaceAll("Kuali document numbers", "Kuali IDs") : surface.placeholder)}
      onChange={event => onText(event.target.value)}
      onBlur={() => {
        if (editableParser !== undefined && preview.problem === null) {
          const normalized = entryText(preview.entries);
          if (normalized !== text) onText(normalized);
        }
      }} />;
  return <>
    {declaration && <>
      {(declaration.submitsMode !== false || switches.length > 0) && <RunList title="Lookup">
        {declaration.submitsMode !== false && <RunListRow title={declaration.modeLabel} description={INPUT_NOTES[declaration.modeLabel]}>
          <RunChoice locked={locked} label={declaration.modeLabel} value={mode?.value ?? ""}
            options={declaration.modes.map(candidate => ({ value: candidate.value, label: candidate.label }))}
            onChange={value => onValue?.(declaration.modeField, value)} />
        </RunListRow>}
        {switches.map(control =>
          <RunListRow key={control.field} title={control.label} description={INPUT_NOTES[control.field]}>
            <Switch hideLabel disabled={locked} label={control.label} checked={values[control.field] === true} onCheckedChange={value => onValue?.(control.field, value)} className="!min-h-0 !w-auto !py-0" />
          </RunListRow>)}
      </RunList>}
      {dates.length > 0 && <RunList title="Dates">
        {dates.map(control =>
          <RunListRow key={control.field} title={control.label} description={INPUT_NOTES[control.field]}>
            <div className="w-[var(--ds-w-body-control-standard)]"><DateInput className="w-full" hideLabel disabled={locked} label={control.label} required={control.required} textEntry textDateFormat="MM/DD/YYYY"
              value={typeof values[control.field] === "string" ? String(values[control.field]) : ""} onChange={next => onValue?.(control.field, next)}
              {...(preview.dateProblems?.[control.field] === undefined ? {} : { errorId: `${errorBase}-${control.field}` })} />
              {preview.dateProblems?.[control.field] !== undefined && <p id={`${errorBase}-${control.field}`} role="alert" className="m-0 mt-1 text-caption text-ui-danger">{preview.dateProblems[control.field]}</p>}</div>
          </RunListRow>)}
      </RunList>}
    </>}
    {rowInput === undefined ? <RunSection title="Input" description={`${inputLabel}.`}>{box}{preview.problem !== null && preview.dateProblems === undefined && <p role="alert" className="m-0 text-caption text-ui-danger">{preview.problem}</p>}</RunSection>
      : <>{rowInput}{preview.problem !== null && !rowsOwnNotice && <FailureNotice sentence={preview.problem} />}</>}
    {rowInput === undefined && preview.entries.length > 0 && <RunList title="Parsed input" label="Parsed input" aside={`${preview.entries.length} ${preview.entries.length === 1 ? "run" : "runs"}`}>
      {preview.entries.map(entry => <RunListRow key={entry.index} title={<span className={cn("font-mono", preview.problem !== null && (preview.refusedIndexes === undefined || preview.refusedIndexes.includes(entry.index)) && "text-ui-danger")}>{entry.sourceText}</span>}>
        {preview.problem !== null && preview.refusedIndexes?.includes(entry.index) === true && <span className="flex items-center gap-2 text-body text-ui-secondary"><CircleAlert aria-hidden className={`${dsIcon.md} text-ui-danger`} />Not valid</span>}
        {editableParser !== undefined && <IconButton size="xs" label={`Remove ${entry.sourceText}`} disabled={locked} icon={<X aria-hidden className={dsIcon.md} />}
          onClick={() => {
            onText(entryText(preview.entries.filter(candidate => candidate.index !== entry.index)));
            inputRef?.current?.focus();
          }} />}
      </RunListRow>)}
    </RunList>}
  </>;
}

export interface ReferenceSheet { readonly libraryId: string; readonly name: string; readonly pinned?: boolean; readonly versions: readonly SheetVersion[]; readonly currentVersionId: string; readonly worksheets: readonly string[] }
/** One library spreadsheet that fits the optional check, as the card draws it: its named versions, the version in use and the worksheets of that version that map the key field. `pickedSheetIds` is absent while the row is unpicked. */
export interface CheckSheet {
  readonly libraryId: string; readonly name: string; readonly pinned: boolean;
  readonly versions: readonly SheetVersion[]; readonly versionId: string; readonly versionName: string;
  readonly worksheets: readonly ReferenceWorksheet[]; readonly worksheetsState: "loading" | "ready" | "error";
  readonly pickedSheetIds?: readonly string[];
}
export type ReferenceWorksheet = SheetWorksheet;

/** The reference spreadsheet a run looks people up in: one per run, with the worksheets of the chosen version that carry the key fields. `several` lets more than one be chosen. */
export interface RunReferenceSheet {
  readonly requiredLabel: string; readonly sheets: readonly ReferenceSheet[];
  readonly chosenLibraryId?: string | undefined; readonly chosenVersionId?: string | undefined; readonly chosenSheetIds: readonly string[]; readonly several: boolean;
  readonly worksheets: readonly ReferenceWorksheet[]; readonly worksheetsState: "loading" | "ready" | "error"; readonly worksheetsError: string | null;
  readonly onPick: (libraryId: string, versionId: string) => void; readonly onVersion: (versionId: string) => void; readonly onWorksheets: (sheetIds: readonly string[]) => void; readonly onRemove: () => void;
}

/** The served Run and Rerun dialogs' one Spreadsheets field: the reference spreadsheet the run looks people up in and the optional extra spreadsheets it checks each person against. One Add spreadsheet button: it fills the reference first, then adds checks; with no check available it changes the reference. */
export function RunSpreadsheets({ reference, check, busy: reading, locked = false, catalogError, onRefresh, inspectWorksheets = false }: {
  reference?: RunReferenceSheet | undefined; check?: { readonly sheets: readonly CheckSheet[] } & CheckCallbacks | undefined;
  busy: boolean; locked?: boolean; catalogError: string | null; onRefresh: () => void; inspectWorksheets?: boolean;
}) {
  const busy = reading || locked;
  const chosen = reference?.sheets.find(sheet => sheet.libraryId === reference.chosenLibraryId);
  const chosenSheetIds = reference?.chosenSheetIds ?? [];
  const referenceWorksheets = reference?.worksheets;
  const worksheets = useMemo(() => referenceWorksheets ?? [], [referenceWorksheets]);
  const worksheetsState = reference?.worksheetsState ?? "ready";
  const missingSheet = !chosenSheetIds.every(sheetId => worksheets.some(sheet => sheet.sheetId === sheetId));
  const onWorksheets = reference?.onWorksheets;
  const unpicked = chosenSheetIds.length === 0;
  useEffect(() => {
    const newest = newestWorksheet(worksheets);
    if (onWorksheets !== undefined && unpicked && worksheetsState === "ready" && newest !== undefined) onWorksheets([newest.sheetId]);
  }, [unpicked, worksheetsState, worksheets, onWorksheets]);
  const title = "References";
  const description = reference === undefined ? "Optional." : `Needs ${reference.requiredLabel}.`;
  if (catalogError) return <div className="flex min-w-0 flex-col gap-3"><RunSection title={title} description={description}><ReferenceFailure locked={locked} onRefresh={onRefresh} /></RunSection></div>;
  const addsCheck = check !== undefined && (reference === undefined || chosen !== undefined);
  const referenceOptions = reference === undefined ? [] : reference.sheets.map((sheet): PickerOption => {
    const uncoverable = sheet.worksheets.length === 0 && sheet.versions.length < 2;
    return { libraryId: sheet.libraryId, name: sheet.name, pinned: sheet.pinned === true, disabled: uncoverable,
      ...(sheet.worksheets.length > 0 ? {} : { description: uncoverable ? `No worksheet has ${reference.requiredLabel}` : `No current worksheet has ${reference.requiredLabel}. Pick an earlier version.` }) };
  });
  const picker = addsCheck
    ? <SpreadsheetPicker label="Add spreadsheet" options={checkOptions(check.sheets)} busy={busy} onPick={check.onAdd} />
    : <SpreadsheetPicker label={chosen ? "Change spreadsheet" : "Add spreadsheet"} options={referenceOptions} busy={busy}
      onPick={libraryId => reference?.onPick(libraryId, reference.sheets.find(sheet => sheet.libraryId === libraryId)?.currentVersionId ?? "")} />;
  const note = worksheetsState === "loading" ? "Loading worksheets…"
    : worksheetsState === "ready" && missingSheet ? (inspectWorksheets ? "A saved worksheet is unavailable." : "Previous worksheet unavailable; choose again") : undefined;
  return <div className="flex min-w-0 flex-col gap-3">
    <SpreadsheetSection title={title} description={description} picker={inspectWorksheets ? null : picker}>
      {(reference !== undefined && chosen !== undefined || check?.sheets.some(sheet => sheet.pickedSheetIds !== undefined)) && <>
      {reference !== undefined && chosen && <SpreadsheetRow name={chosen.name} versions={chosen.versions} versionId={reference.chosenVersionId ?? chosen.currentVersionId} note={note}
        worksheets={worksheets} picked={chosenSheetIds} mode={reference.several ? "many" : "one"} max={reference.several ? MAX_SELECTED_WORKBOOK_SOURCES : undefined} busy={busy} locked={locked} worksheetsReady={worksheetsState === "ready" && !reading}
        inspectWorksheets={inspectWorksheets}
        onVersion={reference.onVersion} onWorksheets={reference.onWorksheets} onRemove={reference.onRemove} />}
      {check !== undefined && <CheckPickedRows busy={busy} locked={locked} {...check} />}
      </>}
    </SpreadsheetSection>
    {reference !== undefined && worksheetsState === "error" && <p role="alert" className="m-0 text-caption text-ui-danger">{reference.worksheetsError}</p>}
    {reference !== undefined && chosen && worksheetsState === "ready" && worksheets.length === 0 && <p role="status" className="m-0 text-caption text-ui-muted">No worksheets in this version have {reference.requiredLabel}.</p>}
  </div>;
}

interface CheckCallbacks {
  onAdd: (libraryId: string) => void; onVersion: (libraryId: string, versionId: string) => void;
  onSheets: (libraryId: string, sheetIds: readonly string[]) => void; onRemove: (libraryId: string) => void;
}

const checkOptions = (sheets: readonly CheckSheet[]): PickerOption[] => sheets.filter(sheet => sheet.pickedSheetIds === undefined)
  .map(sheet => ({ libraryId: sheet.libraryId, name: sheet.name, pinned: sheet.pinned, disabled: false }));

/** The picked spreadsheets of the optional check, one row each. */
function CheckPickedRows({ sheets, busy, locked, onVersion, onSheets, onRemove }: { sheets: readonly CheckSheet[]; busy: boolean; locked: boolean } & Omit<CheckCallbacks, "onAdd">) {
  return <>{sheets.filter(sheet => sheet.pickedSheetIds !== undefined).map(sheet => {
    const picked = sheet.pickedSheetIds ?? [];
    const names = sheet.worksheets.filter(worksheet => picked.includes(worksheet.sheetId));
    const note = sheet.worksheetsState === "loading" ? "Loading worksheets…" : sheet.worksheetsState === "error" ? "Worksheets unavailable" : names.length === 0 ? "No worksheet in this version has Employee ID" : undefined;
    return <SpreadsheetRow key={sheet.libraryId} name={sheet.name} versions={sheet.versions} versionId={sheet.versionId} note={note}
      worksheets={sheet.worksheets} picked={picked} mode="many" busy={busy} locked={locked} worksheetsReady={sheet.worksheetsState === "ready"}
      onVersion={versionId => onVersion(sheet.libraryId, versionId)} onWorksheets={ids => onSheets(sheet.libraryId, ids)} onRemove={() => onRemove(sheet.libraryId)} />;
  })}</>;
}
