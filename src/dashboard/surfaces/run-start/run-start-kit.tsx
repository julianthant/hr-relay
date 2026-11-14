import type { RefObject, ReactNode } from "react";
import { Check, ChevronDown, FlaskConical, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SurfaceField, InputRunSurface, TypedDateControl, TypedInputDraft } from "../../../models/workflow/ingress.js";
import { cn } from "../../lib/utils.js";
import {
  Badge,
  Banner,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemCopy,
  DropdownMenuTrigger,
  Card,
  CardBody,
  Checkbox,
  DateInput,
  Field,
  Input,
  IconButton,
  MetaLine,
  Refusal,
  Select,
  SegmentedChoice,
  Switch,
  Textarea,
  Well,
  dsFg,
  dsIcon,
  dsText,
} from "../../ds/ui.js";
import { fmtClock } from "../shared/status/format.js";
import type { StartPlanResponse } from "../../client/index.js";
import { surfaceValueLabel } from "./run-start-kit-model.js";
import { RunList, RunListRow, RunSection } from "../../ds/primitives/run-list.js";
import { DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "../../ds/primitives/dropdown-menu.js";
import { typedInputMode, typedInputDefaults, inputRunFieldLabel, inputRunDelimiterHint, type RunInputPreview, type StepOmissionDraft, type StepOmissionFactDraft } from "./run-start-model.js";
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
        <span className={cn(dsText.ui, "font-semibold", dsFg.base)}>
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
          `expires ${fmtClock(plan.expiresAt)}`,
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

/** Keep the server’s refusal code and sentence verbatim so the operator can act on both. */
export function PlanRefusals({ refused, sources }: { refused: StartPlanResponse["refused"]; sources?: RunInputPreview["entries"] }) {
  if (refused.length === 0) return null;
  return (
    <ul className="flex flex-col gap-[var(--ds-space-snug)]">
      {refused.map((entry) => (
        <li key={`${String(entry.entry)}-${entry.code}`}>
          <Refusal
            title={`Entry ${String(entry.entry)}${sources?.find(source => source.index + 1 === entry.entry) ? ` (${sources.find(source => source.index + 1 === entry.entry)?.sourceText})` : ""} was not planned`}
            code={entry.code}
            outcome="nothing is enqueued for it"
          >
            {entry.message}
          </Refusal>
        </li>
      ))}
    </ul>
  );
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
  onTouch,
  previous,
  compact = false,
}: {
  step: string;
  form: StepOmissionForm;
  draft: StepOmissionDraft;
  /** field key → the refusal to draw; a key absent from it draws its help line */
  errors: Readonly<Record<string, string>>;
  onChange: (fieldKey: string, next: StepOmissionFactDraft) => void;
  onTouch: (fieldKey: string) => void;
  previous?: Readonly<Record<string, { value: string; onUse: () => void }>>;
  compact?: boolean;
}) {
  if (form.fields.length === 0) {
    return (
      <p className={cn(dsText.meta, dsFg.muted)}>
        This step asks for nothing — omitting it leaves no fact for you to supply.
      </p>
    );
  }
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-[var(--ds-space-cozy)] @min-[480px]:grid-cols-2">
      {/* The legend NAMES the group, so a screen reader landing inside it
          knows which omitted step these boxes stand in for. */}
      <legend className={cn(dsText.meta, "font-medium", dsFg.secondary, compact && "sr-only")}>
        {`What this run reads instead of ${step}`}
      </legend>
      {form.fields.map((field) => {
        const value = draft[field.key];
        const error = errors[field.key] ?? null;
        const help = field.help;
        const saved = previous?.[field.key];
        const savedControl = saved && <div className="mt-[5px] flex items-center justify-between gap-2 text-caption text-ui-muted"><span>{compact ? "Previous" : "Saved"} <span className="tabular-nums">{saved.value}</span></span><Button size="sm" variant="ghost" className="h-auto p-0 text-caption text-ui-info" aria-label={`Copy ${step} · ${field.label}`} onClick={saved.onUse}>Use previous</Button></div>;
        if (field.kind === "boolean") {
          return (
            <div key={field.key}>
            <Checkbox
              checked={value === true}
              onCheckedChange={(next) => {
                onTouch(field.key);
                onChange(field.key, next === true);
              }}
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
        };
        if (field.kind === "enum") {
          return (
            <Field key={field.key} {...commonField}>
              <Select
                value={text}
                onBlur={() => onTouch(field.key)}
                onChange={(event) => {
                  onTouch(field.key);
                  onChange(field.key, event.target.value);
                }}
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
                onBlur={() => onTouch(field.key)}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
              {savedControl}
            </Field>
          );
        }
        return (
          <Field key={field.key} {...commonField}>
            {field.kind === "us-date" ? <DateInput label={field.label} textEntry textDateFormat="MM/DD/YYYY" value={text} onChange={next => { onTouch(field.key); onChange(field.key, next); }} /> : <Input
              value={text}
              {...(field.kind === "eid" ? { placeholder: "12345678", inputMode: "numeric" as const } : {})}
              {...(field.kind === "integer" ? { inputMode: "numeric" as const } : {})}
              onBlur={() => onTouch(field.key)}
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
  draft = {},
  onValue,
  rowInput,
}: {
  rowInput?: ReactNode;
  surface: InputRunSurface;
  workflowId: string;
  text: string;
  onText: (next: string) => void;
  preview: RunInputPreview;
  draft?: TypedInputDraft;
  onValue?: (field: string, value: string | boolean) => void;
  /** the dialog's handle on the box, so an exit from a banner can focus it */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
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
  const hint = (mode?.hint ?? inputRunDelimiterHint(surface.parser)).replace(/semicolon or a new line\./u, "semicolon or Shift+Enter.");
  const box = <Textarea key={workflowId} ref={inputRef} autoFocus rows={4} value={text} aria-label={inputLabel}
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
          <div className="w-[250px]"><SegmentedChoice hideLabel label={declaration.modeLabel} value={mode?.value ?? ""}
            options={declaration.modes.map(candidate => ({ value: candidate.value, label: candidate.label }))}
            onChange={value => onValue?.(declaration.modeField, value)} /></div>
        </RunListRow>}
        {switches.map(control =>
          <RunListRow key={control.field} title={control.label} description={INPUT_NOTES[control.field]}>
            <Switch hideLabel label={control.label} checked={values[control.field] === true} onCheckedChange={value => onValue?.(control.field, value)} className="!min-h-0 !w-auto !py-0" />
          </RunListRow>)}
      </RunList>}
      {dates.length > 0 && <RunList title="Dates">
        {dates.map(control =>
          <RunListRow key={control.field} title={control.label} description={INPUT_NOTES[control.field]}>
            <div className="w-[200px]"><DateInput className="w-full" hideLabel label={control.label} required={control.required} textEntry textDateFormat="MM/DD/YYYY"
              value={typeof values[control.field] === "string" ? String(values[control.field]) : ""} onChange={next => onValue?.(control.field, next)} /></div>
          </RunListRow>)}
      </RunList>}
    </>}
    {rowInput === undefined ? <RunSection title="Input" description={`${inputLabel}. ${hint}`}>{box}{preview.problem !== null && <p role="alert" className="m-0 text-caption text-ui-danger">{preview.problem}</p>}</RunSection>
      : <>{rowInput}{preview.problem !== null && <Banner tone="danger" title="Selected rows need attention">{preview.problem}</Banner>}</>}
    {rowInput === undefined && preview.entries.length > 0 && <RunList title="Parsed input" label="Parsed input" aside={`${preview.entries.length} ${preview.entries.length === 1 ? "run" : "runs"}`}>
      {preview.entries.map(entry => <RunListRow key={entry.index} title={<span className="font-mono">{entry.sourceText}</span>}>
        {editableParser !== undefined && <IconButton size="xs" label={`Remove ${entry.sourceText}`} icon={<X aria-hidden className={dsIcon.md} />}
          onClick={() => {
            onText(entryText(preview.entries.filter(candidate => candidate.index !== entry.index)));
            inputRef?.current?.focus();
          }} />}
      </RunListRow>)}
    </RunList>}
  </>;
}

export interface ReferenceSheet { readonly libraryId: string; readonly name: string; readonly versions: readonly { readonly id: string; readonly name: string }[]; readonly currentVersionId: string; readonly worksheets: readonly string[] }
export interface ReferenceWorksheet { readonly sheetId: string; readonly sheetName: string }

/** The served Run and Rerun dialogs' reference spreadsheet list: the approved rows (spreadsheet, worksheet picker, version picker, remove ×) and the Add spreadsheet search menu, over the library the run reads. One spreadsheet per run: adding another replaces the current one. */
export function RunReferenceRows({ requiredLabel, sheets, chosenLibraryId, chosenVersionId, chosenSheetId, worksheets, worksheetsState, worksheetsError, busy, catalogError, onPick, onVersion, onWorksheet, onRemove, onRefresh }: {
  requiredLabel: string; sheets: readonly ReferenceSheet[];
  chosenLibraryId?: string; chosenVersionId?: string; chosenSheetId: string;
  worksheets: readonly ReferenceWorksheet[]; worksheetsState: "loading" | "ready" | "error"; worksheetsError: string | null;
  busy: boolean; catalogError: string | null;
  onPick: (libraryId: string, versionId: string) => void; onVersion: (versionId: string) => void; onWorksheet: (sheetId: string) => void; onRemove: () => void; onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const chosen = sheets.find(sheet => sheet.libraryId === chosenLibraryId);
  const needle = query.trim().toLowerCase();
  // The library serves no pins, so an empty search shows the guidance line; typing searches every spreadsheet and worksheet name, A-Z.
  const found = needle === "" ? [] : sheets.filter(sheet => [sheet.name, ...sheet.worksheets].some(name => name.toLowerCase().includes(needle))).toSorted((a, b) => a.name.localeCompare(b.name));
  const missingSheet = chosenSheetId !== "" && !worksheets.some(sheet => sheet.sheetId === chosenSheetId);
  useEffect(() => {
    if (chosenSheetId === "" && worksheetsState === "ready" && worksheets.length > 0) onWorksheet(worksheets[0].sheetId);
  }, [chosenSheetId, worksheetsState, worksheets, onWorksheet]);
  const current = worksheets.find(sheet => sheet.sheetId === chosenSheetId)?.sheetName;
  return <div className="flex min-w-0 flex-col gap-3">
    {catalogError && <Banner tone="danger" title="Reference data unavailable">{catalogError}<Button onClick={onRefresh}>Refresh</Button></Banner>}
    <RunList title="Reference spreadsheets" description={`Spreadsheets this run looks people up in. Needs ${requiredLabel}.`}>
      {chosen && <RunListRow title={chosen.name} description={missingSheet ? "Previous worksheet unavailable; choose again" : current ?? (worksheetsState === "loading" ? "Loading worksheets…" : undefined)}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" disabled={busy || worksheetsState !== "ready"} aria-label={`${chosen.name} worksheet, ${current ?? "none chosen"}`} className="ds-menu-trigger w-[150px] min-w-0 justify-between" iconAfter={<ChevronDown aria-hidden />}><span className="min-w-0 truncate">{current ?? "Choose worksheet"}</span></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[280px] max-h-[320px] overflow-y-auto"><DropdownMenuGroup>
            <DropdownMenuLabel>{chosen.name}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={chosenSheetId} onValueChange={onWorksheet}>
              {worksheets.map(sheet => <DropdownMenuRadioItem key={sheet.sheetId} value={sheet.sheetId}>{sheet.sheetName}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
        <Select aria-label={`${chosen.name} version`} variant="toolbar" className="min-w-[76px] max-w-[150px]" disabled={busy} value={chosenVersionId ?? chosen.currentVersionId} onChange={event => onVersion(event.target.value)}>
          {chosen.versions.map((version, index) => <option key={version.id} value={version.id}>{version.name || `v${chosen.versions.length - index}`}</option>)}
        </Select>
        <IconButton size="xs" label={`Remove ${chosen.name}`} icon={<X aria-hidden className={dsIcon.md} />} onClick={onRemove} />
      </RunListRow>}
    </RunList>
    {worksheetsState === "error" && <p role="alert" className="m-0 text-caption text-ui-danger">{worksheetsError}</p>}
    {chosen && worksheetsState === "ready" && worksheets.length === 0 && <p role="status" className="m-0 text-caption text-ui-muted">No worksheets in this version have {requiredLabel}.</p>}
    <div><DropdownMenu onOpenChange={open => { if (open) setQuery(""); }}>
      <DropdownMenuTrigger asChild><Button variant="outline" disabled={busy} className="ds-menu-trigger" iconAfter={<ChevronDown aria-hidden />}>{chosen ? "Change spreadsheet" : "Add spreadsheet"}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[320px] max-h-[320px] overflow-y-auto">
        <div className="ds-menu-search-row" onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }}>
          <Search aria-hidden /><input aria-label="Find a spreadsheet" placeholder="Find a spreadsheet" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        {found.length === 0 && <p className="m-0 px-2 py-2 text-[13px] leading-[18px] text-ui-muted">{needle === "" ? "Pin spreadsheets in Spreadsheets to list them here. Search finds the rest." : "No spreadsheets match."}</p>}
        {found.map(sheet => {
          const uncoverable = sheet.worksheets.length === 0 && sheet.versions.length < 2;
          const description = sheet.worksheets.length > 0 ? sheet.worksheets.join(", ") : uncoverable ? `No worksheet has ${requiredLabel}` : `Current version has no worksheet with ${requiredLabel}. Choose an earlier version.`;
          return <DropdownMenuItem key={sheet.libraryId} disabled={uncoverable} onClick={() => onPick(sheet.libraryId, sheet.currentVersionId)}>
            <DropdownMenuItemCopy title={sheet.name} description={description} />
          </DropdownMenuItem>;
        })}
      </DropdownMenuContent>
    </DropdownMenu></div>
  </div>;
}
