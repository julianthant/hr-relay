/** Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 * src/dashboard/components/dev/rebuild-demo/ds/primitives-form.tsx */
import { Input as HeroInput, Radio as HeroRadio, RadioGroup as HeroRadioGroup, SearchField as HeroSearchField, Switch as HeroSwitch, TextArea as HeroTextArea } from "@heroui/react";
import {
  Children,
  isValidElement,
  createContext,
  forwardRef,
  useEffect,
  useContext,
  useId,
  useRef,
  useState,
  type DOMAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Eye, EyeOff, Lock, Minus, Pencil, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { Select as BaseSelect, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "./base-select.js";
import { Button, IconButton } from "./primitives-core.js";
import { Tooltip, TooltipProvider } from "./primitives-overlay.js";
import { dsBorder, dsFocus, dsFocusWithin, dsIcon, dsMotion, dsRadius, dsText } from "../theme/tokens.js";

/** Form primitives.
 * This product types EIDs, names and dates that become real HR transactions */

interface FieldContextValue {
  inputId: string;
  descriptionId?: string;
  errorId?: string;
  invalid: boolean;
  disabled?: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** The props a control needs to be correctly described by its `Field`. */
export function useFieldControl(): {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
} {
  const ctx = useContext(FieldContext);
  if (!ctx) return {};
  const describedBy = [ctx.descriptionId, ctx.errorId].filter(Boolean).join(" ");
  return {
    id: ctx.inputId,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": ctx.invalid || undefined,
    disabled: ctx.disabled,
  };
}

/** <Field label="Employee ID" description="9 digits, no dashes" error={err}>
 * <Input placeholder="100844120" /> */
export function Field({
  label,
  description,
  error,
  required,
  hint,
  disabled,
  className,
  orientation = "vertical",
  controlWidth = "standard",
  children,
  ...props
}: {
  label: ReactNode;
  description?: ReactNode;
  /** a string turns the field invalid and announces the message */
  error?: string | null;
  required?: boolean;
  /** right-aligned helper beside the label (a unit, a shortcut, a count) */
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Horizontal rows place the label and description beside the control. */
  orientation?: "vertical" | "horizontal";
  /** Preferred control column for horizontal body rows; ignored outside DsBodyScope. */
  controlWidth?: "standard" | "medium" | "wide";
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  const base = useId();
  const inputId = `${base}-control`;
  const descriptionId = description ? `${base}-description` : undefined;
  const errorId = error ? `${base}-error` : undefined;

  const fieldLabel = (
    <label
      htmlFor={inputId}
      className={cn(
        "ds-field-label",
        dsText.meta,
        "font-medium text-[color:var(--ds-fg-secondary)]",
      )}
    >
      {label}
      {required && (
        <span aria-hidden className="ml-0.5 text-[color:var(--ds-danger)]">
          *
        </span>
      )}
      {required && <span className="sr-only"> (required)</span>}
    </label>
  );
  const fieldMessage = error ? (
    <p
      id={errorId}
      role="alert"
      className={cn(
        "ds-field-error",
        dsText.meta,
        "flex items-center gap-[var(--ds-space-tight)] text-[color:var(--ds-danger)]",
      )}
    >
      <TriangleAlert aria-hidden className={dsIcon.sm} />
      {error}
    </p>
  ) : description ? (
    <p
      id={descriptionId}
      className={cn("ds-field-description", dsText.meta, "text-[color:var(--ds-fg-muted)]")}
    >
      {description}
    </p>
  ) : null;

  return (
    <FieldContext.Provider
      value={{ inputId, descriptionId, errorId, invalid: Boolean(error), disabled }}
    >
      {orientation === "horizontal" ? (
        <div
          {...props}
          data-control-width={controlWidth}
          className={cn("ds-body-row ds-field-layout-horizontal min-w-0", className)}
        >
          <div className="ds-field-copy">
            <div className="flex items-baseline gap-[var(--ds-space-base)]">
              {fieldLabel}
              {hint && (
                <span className={cn(dsText.meta, "ml-auto text-[color:var(--ds-fg-faint)]")}>
                  {hint}
                </span>
              )}
            </div>
            {fieldMessage}
          </div>
          <div className="ds-field-control-slot">{children}</div>
        </div>
      ) : (
        <div {...props} className={cn("flex min-w-0 flex-col gap-[var(--ds-space-tight)]", className)}>
          <div className="flex items-baseline gap-[var(--ds-space-base)]">
            {fieldLabel}
            {hint && (
              <span className={cn(dsText.meta, "ml-auto text-[color:var(--ds-fg-faint)]")}>
                {hint}
              </span>
            )}
          </div>
          {children}
          {fieldMessage}
        </div>
      )}
    </FieldContext.Provider>
  );
}

const controlShell = cn(
  "w-full min-w-0 border bg-[var(--ds-surface-2)]",
  "border-[color:var(--ds-control-border)] text-[color:var(--ds-fg)]",
  "placeholder:text-[color:var(--ds-fg-faint)]",
  dsRadius.md,
  dsFocus,
  dsMotion.base,
  "hover:border-[color:var(--ds-border-loud)]",
  "aria-[invalid=true]:border-[color:var(--ds-danger)]",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    const field = useFieldControl();
    return (
      <HeroInput
        ref={ref}
        {...field}
        {...props}
        variant="secondary"
        className={cn(
          controlShell,
          "ds-control-input h-[var(--ds-h-md)] px-[var(--ds-space-base)]",
          dsText.ui,
          className,
        )}
      />
    );
  },
);

export function PathControl({ value, label, onChange, disabled = false, busy = false }: {
  value: string; label: string; onChange: () => void; disabled?: boolean; busy?: boolean;
}) {
  const field = useFieldControl();
  const separator = value.lastIndexOf("/");
  const prefix = separator < 0 ? "" : value.slice(0, separator + 1);
  const basename = separator < 0 ? value : value.slice(separator + 1);
  return <div className="ds-path-control">
    <TooltipProvider delayDuration={250}>
      <Tooltip content={<span className="break-all whitespace-normal">{value}</span>}>
        <span className={cn("ds-path-value", dsFocus)} tabIndex={0} aria-label={value}>
          <span className="sr-only">{value}</span>
          <span aria-hidden="true" className="ds-path-prefix">{prefix}</span>
          <span aria-hidden="true" className="ds-path-basename">{basename}</span>
        </span>
      </Tooltip>
    </TooltipProvider>
    <Button id={field.id} aria-describedby={field["aria-describedby"]} aria-invalid={field["aria-invalid"]}
      aria-label={`Change ${label}`} size="md" variant="secondary" onClick={onChange}
      disabled={disabled || field.disabled} loading={busy}>Change</Button>
  </div>;
}

export type UnitFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "aria-describedby"> & {
  unit: string;
  "aria-describedby"?: string;
  /** Body-scope width. Use `stretch` for a unit control inside a paired wide field. */
  bodyWidth?: "compact" | "stretch";
};

/** A text or numeric control with a fixed, announced unit inside its shell. */
export const UnitField = forwardRef<HTMLInputElement, UnitFieldProps>(function UnitField(
  { unit, bodyWidth = "compact", className, id, "aria-describedby": describedBy, ...props },
  ref,
) {
  const field = useFieldControl();
  const unitId = useId();
  const mergedDescription = [field["aria-describedby"], describedBy, unitId].filter(Boolean).join(" ");
  return (
    <div className="ds-unit-field" data-body-width={bodyWidth}>
      <Input
        ref={ref}
        {...props}
        id={field.id ?? id}
        aria-describedby={mergedDescription}
        className={cn("ds-unit-input", className)}
      />
      <span id={unitId} className="ds-unit-label">{unit}</span>
    </div>
  );
});

export type SecretFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Accessible name when the control is used without a surrounding Field. */
  label: string;
  /** Stable credential identity. Changing it immediately hides a revealed value. */
  identity?: string;
  /** A distinct trailing removal action. It is omitted when removal is unavailable. */
  onRemove?: () => void;
  removeLabel?: string;
};

/** A masked value with an in-control reveal action and a separate remove action. */
export const SecretField = forwardRef<HTMLInputElement, SecretFieldProps>(function SecretField(
  { label, identity: explicitIdentity, onRemove, removeLabel, onChange, className, "aria-describedby": describedBy, ...props },
  ref,
) {
  const field = useFieldControl();
  const [revealedFor, setRevealedFor] = useState<{ identity: string; value: string } | null>(null);
  const identity = explicitIdentity ?? field.id ?? props.id ?? props.name ?? label;
  const controlled = props.value !== undefined;
  const currentValue = String(props.value ?? "");
  const effectiveDisabled = props.disabled === true || field.disabled === true;
  const visible = revealedFor?.identity === identity && (!controlled || revealedFor.value === currentValue);
  useEffect(() => {
    setRevealedFor((current) => current && (
      current.identity !== identity || (controlled && current.value !== currentValue)
    ) ? null : current);
  }, [identity, controlled, currentValue]);
  const handleChange: NonNullable<InputHTMLAttributes<HTMLInputElement>["onChange"]> = (event) => {
    if (visible) setRevealedFor({ identity, value: event.currentTarget.value });
    onChange?.(event);
  };
  const mergedDescription = [field["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("ds-secret-field", className)}>
      <div className="ds-secret-input flex h-[var(--ds-h-md)] min-w-0 flex-1 items-center">
        <Input
          ref={ref}
          {...props}
          disabled={effectiveDisabled}
          onChange={handleChange}
          type={visible ? "text" : "password"}
          aria-label={field.id ? props["aria-label"] : props["aria-label"] ?? label}
          aria-describedby={mergedDescription}
          className="ds-secret-control h-full rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:outline-none"
        />
        <IconButton
          type="button"
          label={`${visible ? "Hide" : "Show"} ${label}`}
          aria-pressed={visible}
          disabled={effectiveDisabled}
          onClick={() => setRevealedFor(visible ? null : { identity, value: currentValue })}
          variant="input"
          size="xs"
          icon={visible ? <EyeOff aria-hidden className={dsIcon.sm} /> : <Eye aria-hidden className={dsIcon.sm} />}
          className="ml-[var(--ds-space-tight)]"
        />
      </div>
      {onRemove && (
        <IconButton
          type="button"
          label={removeLabel ?? `Remove ${label}`}
          disabled={effectiveDisabled || props.readOnly}
          variant="danger-outline"
          size="sm"
          className="ds-secret-remove"
          icon={<Trash2 aria-hidden className={dsIcon.sm} />}
          onClick={onRemove}
        />
      )}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    const field = useFieldControl();
    return (
      <HeroTextArea
        ref={ref}
        rows={rows}
        {...field}
        {...props}
        variant="secondary"
        className={cn(controlShell, "resize-y p-[var(--ds-space-base)]", dsText.body, className)}
      />
    );
  },
);

/** Base UI Select with the shared field and toolbar sizes; option children keep existing callers explicit. */
export const Select = forwardRef<HTMLButtonElement,
  Omit<SelectHTMLAttributes<HTMLSelectElement>, keyof DOMAttributes<HTMLSelectElement>> & Omit<DOMAttributes<HTMLButtonElement>, "onChange" | "children"> & {
    children: ReactNode; variant?: "field" | "toolbar"; icon?: ReactNode;
    onChange?: (event: { target: { value: string }; currentTarget: { value: string } }) => void;
  }
>(function Select({ className, children, variant = "field", icon, value, defaultValue, onChange, name, required, form, disabled, size: _nativeSize, ...props }, ref) {
  const field = useFieldControl();
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const options: { value: string; label: ReactNode; disabled: boolean }[] = [];
  function collect(nodes: ReactNode) {
    Children.forEach(nodes, child => {
      if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return;
      if (child.type === "option") options.push({ value: String(child.props.value ?? ""), label: child.props.children, disabled: !!child.props.disabled });
      else if (child.props.children) collect(child.props.children);
    });
  }
  collect(children);
  const initial = defaultValue === undefined ? options[0]?.value : String(defaultValue);
  return <BaseSelect modal={false} onOpenChange={open => { if (open) setPortalContainer(trigger.current?.closest<HTMLElement>('[role="dialog"]') ?? null); }} value={value === undefined ? undefined : String(value)} defaultValue={initial}
    onValueChange={next => { if (next !== null) onChange?.({ target: { value: next }, currentTarget: { value: next } }); }}
    name={name} required={required} form={form} disabled={disabled ?? field.disabled}
    items={options.map(option => ({ value: option.value, label: option.label }))}>
    <SelectTrigger data-value={value === undefined ? undefined : String(value)} ref={node => { trigger.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }} {...field} {...props} className={cn("ds-select-control w-full min-w-0 bg-[var(--ds-control-bg)] text-[color:var(--ds-control-fg)]", variant === "toolbar" ? "h-[var(--ds-h-toolbar)] w-auto shrink-0 text-caption" : "h-[var(--ds-h-md)]", className)}>
      {icon}<SelectValue />
    </SelectTrigger>
    <SelectContent container={portalContainer} align="start" alignItemWithTrigger={false}>
      <SelectGroup>{options.map(option => <SelectItem key={option.value} data-value={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectGroup>
    </SelectContent>
  </BaseSelect>;
});


export function Checkbox({
  label,
  description,
  className,
  ...props
}: CheckboxPrimitive.CheckboxProps & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  // Name Radix’s checkbox button with the visible label; label-for does not name its subtree.
  const labelId = `${id}-label`;
  return (
    <div data-disabled={props.disabled || undefined} className={cn("ds-checkbox-row flex items-start gap-[var(--ds-space-base)]", className)}>
      <CheckboxPrimitive.Root
        id={id}
        {...props}
        aria-labelledby={labelId}
        className={cn(
          "ds-checkbox-control mt-px inline-flex size-4 shrink-0 cursor-pointer items-center justify-center border",
          "border-[color:var(--ds-control-border)] bg-[var(--ds-surface-2)]",
          "data-[state=checked]:border-transparent data-[state=checked]:bg-[var(--ds-accent)]",
          "data-[state=indeterminate]:border-transparent data-[state=indeterminate]:bg-[var(--ds-accent)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          dsRadius.xs,
          dsFocus,
          dsMotion.fast,
        )}
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center text-[color:var(--ds-accent-fg)]">
          {props.checked === "indeterminate" ? (
            <Minus aria-hidden className="size-3" strokeWidth={3} />
          ) : (
            <Check aria-hidden className="size-3" strokeWidth={3} />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <label htmlFor={id} className="ds-checkbox-copy flex min-w-0 cursor-pointer flex-col">
        <span id={labelId} className={cn("ds-checkbox-label", dsText.ui, "text-[color:var(--ds-fg)]")}>
          {label}
        </span>
        {description && (
          <span className={cn("ds-checkbox-description", dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{description}</span>
        )}
      </label>
    </div>
  );
}

/** Radio group with library-owned selection and arrow-key navigation. */
export function RadioGroup<T extends string>({
  label,
  name,
  value,
  onValueChange,
  options,
  className,
}: {
  label: string;
  name: string;
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: ReactNode; description?: ReactNode; disabled?: boolean }[];
  className?: string;
}) {
  const labelId = useId();
  return (
    <HeroRadioGroup
      name={name}
      value={value}
      onChange={(next) => onValueChange(next as T)}
      aria-labelledby={labelId}
      className={cn("ds-radio-group flex min-w-0 flex-col gap-[var(--ds-space-snug)]", className)}
    >
      <span id={labelId} className={cn("ds-radio-legend", dsText.meta, "mb-[var(--ds-space-tight)] font-medium text-[color:var(--ds-fg-secondary)]")}>
        {label}
      </span>
      {options.map((option) => (
        <HeroRadio
          key={option.value}
          value={option.value}
          isDisabled={option.disabled}
          className={cn(
            "ds-radio-option group m-0 flex min-w-0 cursor-pointer items-start gap-[var(--ds-space-base)]",
            option.disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <HeroRadio.Control
            className={cn(
              "ds-radio-control mt-px size-4 shrink-0 cursor-pointer appearance-none rounded-full border",
              "border-[color:var(--ds-control-border)] bg-[var(--ds-surface-2)]",
              "group-data-[selected]:border-[length:var(--ds-border-w-emphasis)] group-data-[selected]:border-[color:var(--ds-accent)]",
              "group-data-[selected]:bg-[var(--ds-surface-page)]",
              dsFocus,
              dsMotion.fast,
            )}
          ><HeroRadio.Indicator /></HeroRadio.Control>
          <HeroRadio.Content className="ds-radio-copy flex min-w-0 flex-col">
            <span className={cn("ds-radio-label", dsText.ui, "text-[color:var(--ds-fg)]")}>{option.label}</span>
            {option.description && (
              <span className={cn("ds-radio-description", dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                {option.description}
              </span>
            )}
          </HeroRadio.Content>
        </HeroRadio>
      ))}
    </HeroRadioGroup>
  );
}

/** Switches apply immediately; changes requiring Save use checkboxes. */
export function Switch({
  name,
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
}: {
  name?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <HeroSwitch name={name} isSelected={checked} onChange={onCheckedChange} isDisabled={disabled} className={cn("ds-switch-row flex items-start gap-[var(--ds-space-base)]", className)}>
      <HeroSwitch.Content className="ds-switch-content flex min-w-0 flex-1 flex-row-reverse items-center justify-between">
        <HeroSwitch.Control onClick={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) onCheckedChange(!checked); }} className={cn(
        "ds-switch-control relative inline-flex shrink-0 cursor-pointer items-center rounded-full border",
        checked
          ? "ds-switch-control-checked border-transparent bg-[var(--ds-accent)]"
          : "border-[color:var(--ds-control-border)] bg-[var(--ds-surface-2)]",
        dsFocus,
        dsMotion.fast,
        )}><HeroSwitch.Thumb className={cn(
        "ds-switch-thumb block shrink-0 rounded-full transition-transform duration-[var(--ds-dur-1)] ease-[var(--ds-ease-out)]",
        checked
          ? "ds-switch-thumb-checked bg-[var(--ds-accent-fg)]"
          : "bg-[var(--ds-fg-muted)]",
        )} /></HeroSwitch.Control>
        <span className="ds-switch-copy flex min-w-0 flex-1 flex-col">
          <span className={cn(dsText.ui, "text-[color:var(--ds-fg)]")}>{label}</span>
          {description && <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{description}</span>}
        </span>
      </HeroSwitch.Content>
    </HeroSwitch>
  );
}

/** A search field with its icon and a clear control. Used by every list. */
export const SearchInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { onClear?: () => void; shortcut?: ReactNode; variant?: 'field' | 'toolbar' }
>(function SearchInput({ className, onClear, shortcut, variant = 'field', value, defaultValue, disabled, readOnly, ...props }, ref) {
  const field = useFieldControl();
  return (
    <HeroSearchField className={cn("ds-search-field", variant === 'toolbar' && 'ds-search-field--toolbar', className)} aria-label={props["aria-label"]}
      value={value === undefined ? undefined : String(value)} defaultValue={defaultValue === undefined ? undefined : String(defaultValue)}
      isDisabled={disabled ?? field.disabled} isReadOnly={readOnly} isInvalid={field["aria-invalid"] || props["aria-invalid"] === true} onClear={onClear}>
      <HeroSearchField.Group>
      <HeroSearchField.SearchIcon />
      <HeroSearchField.Input
        ref={ref}
        {...field}
        {...props}
      />
      <HeroSearchField.ClearButton aria-label="Clear search" className="ds-search-clear"><X aria-hidden /></HeroSearchField.ClearButton>
      {!value && shortcut && <span className="ds-search-shortcut">{shortcut}</span>}
      </HeroSearchField.Group>
    </HeroSearchField>
  );
});



/** Editable values need a visible affordance before hover; label once and pair dirty color with words. */
export function ValueField({
  id,
  ariaLabel,
  value,
  onChange,
  dirty = false,
  title,
  className,
}: {
  /** pair with your own `<label htmlFor>` when the label is visible */
  id?: string;
  /** the accessible name when there is no label element to pair with */
  ariaLabel?: string;
  value: string;
  onChange: (next: string) => void;
  /** typed over and not yet committed — a fill and a border, never ink */
  dirty?: boolean;
  title?: string;
  className?: string;
}) {
  /** Select recorded values on entry; preserve later drag selection for partial corrections. */
  const selectOnRelease = useRef(false);
  return (
    <span className={cn("relative flex min-w-0 items-center", className)}>
      <HeroInput
        id={id}
        aria-label={ariaLabel}
        title={title}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={(e) => {
          selectOnRelease.current = e.currentTarget !== document.activeElement;
        }}
        onFocus={(e) => e.currentTarget.select()}
        onMouseUp={(e) => {
          if (!selectOnRelease.current) return;
          selectOnRelease.current = false;
          e.preventDefault();
        }}
        className={cn(
          // Reserve pencil space so narrow value columns cannot overlap the edit affordance.
          "ds-value-field-input w-full min-w-0 border pl-[var(--ds-space-snug)] pr-[calc(var(--ds-space-loose)+var(--ds-space-tight))]",
          "h-[var(--ds-h-sm)] rounded-[var(--ds-radius-md)]",
          dsText.body,
          dsText.nums,
          dsFocus,
          dsMotion.fast,
          "text-[color:var(--ds-fg)]",
          dirty
            ? "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)]"
            : cn(
                "border-[color:var(--ds-control-border)] bg-[var(--ds-surface-2)]",
                "hover:border-[color:var(--ds-border-loud)] focus:border-[color:var(--ds-border-loud)]",
              ),
        )}
      />
      {/* Place the edit cue inside the value field; dense columns cannot spare another track. */}
      <Pencil
        aria-hidden
        className={cn(dsIcon.sm, "pointer-events-none absolute right-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}
      />
    </span>
  );
}

/** Locked values must look distinct from editable fields and explain why correction is refused. */
export function LockedValue({
  value,
  reason,
  tone = "default",
  className,
}: {
  value: ReactNode;
  /** why it cannot be corrected — shown, never left to be guessed */
  reason?: string;
  tone?: "default" | "warning";
  className?: string;
}) {
  return (
    <span title={reason} className={cn("flex min-w-0 items-start gap-[var(--ds-space-tight)]", className)}>
      <Lock aria-hidden className={cn(dsIcon.sm, "mt-[var(--ds-space-hair)] shrink-0 text-[color:var(--ds-fg-muted)]")} />
      {/* Wrap recorded values; truncation would hide facts with no recovery route. */}
      <span
        className={cn(
          dsText.body,
          dsText.nums,
          "ds-locked-value-text min-w-0 flex-1 break-words",
          tone === "warning" ? "text-[color:var(--ds-status-waiting-fg)]" : "text-[color:var(--ds-fg)]",
        )}
      >
        {value}
      </span>
    </span>
  );
}



/** Pass dropped files unchanged for named server refusal; disable duplicates and count nested drag events. */
export function Dropzone({
  label,
  accept,
  hint,
  busy,
  busyLabel = "Reading…",
  onFile,
  className,
}: {
  label: ReactNode;
  /** the picker hint, e.g. `.csv,.xlsx` — never used to drop a file */
  accept?: string;
  /** what is accepted and how large, in the product's own words */
  hint?: ReactNode;
  busy?: boolean;
  busyLabel?: string;
  onFile: (file: File) => void;
  className?: string;
}) {
  const [depth, setDepth] = useState(0);
  const over = depth > 0 && busy !== true;

  const take = (list: FileList | null): void => {
    const file = list?.item(0);
    // No file is a real outcome (a cancelled picker, a drag of something that
    // is not a file); it is not an error and it is not a reason to guess.
    if (file === null || file === undefined) return;
    onFile(file);
  };

  return (
    <label
      onDragEnter={(event) => {
        event.preventDefault();
        setDepth((current) => current + 1);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDepth((current) => Math.max(0, current - 1))}
      onDrop={(event) => {
        event.preventDefault();
        setDepth(0);
        if (busy === true) return;
        take(event.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-[var(--ds-space-tight)]",
        "border-dashed p-[var(--ds-space-section)] text-center",
        dsBorder.base,
        dsRadius.lg,
        dsFocusWithin,
        dsMotion.base,
        over
          ? "border-[color:var(--ds-accent)] bg-[color:var(--ds-accent-quiet)]"
          : "bg-[color:var(--ds-recess-bg)] hover:border-[color:var(--ds-border-loud)]",
        busy === true ? "cursor-progress opacity-70" : "cursor-pointer",
        className,
      )}
    >
      <HeroInput
        type="file"
        accept={accept}
        disabled={busy}
        className="sr-only"
        onChange={(event) => {
          take(event.currentTarget.files);
          // Clearing lets the SAME file be chosen again after a refusal —
          // otherwise `change` never fires and the zone looks dead.
          event.currentTarget.value = "";
        }}
      />
      <Upload
        aria-hidden
        className={cn(dsIcon.lg, over ? "text-[color:var(--ds-accent)]" : "text-[color:var(--ds-fg-faint)]")}
      />
      <span className={cn(dsText.ui, "font-medium text-[color:var(--ds-fg)]")}>
        {busy === true ? busyLabel : label}
      </span>
      {hint !== undefined && (
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{hint}</span>
      )}
    </label>
  );
}
