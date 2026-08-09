/**
 * The phone's controls — thumb-sized, over the product's own palette.
 *
 * These are NOT restyled `ds/primitives-core.tsx` buttons. That library's
 * heights are 20/24/28/32px, which is right for a mouse on a dense console and
 * unreachable for a thumb; a call-site override would have produced a control
 * that agrees with the design system's colours while contradicting its sizes,
 * and the next person would have copied it. So the phone declares its own two
 * controls, reads every colour and every motion value from the same tokens, and
 * leaves the console's primitives untouched.
 *
 * Both are real `<button>`s (or, for the camera, a real `<label>` over a real
 * file input — see `CameraButton`), so keyboard and screen-reader reach come
 * from the platform rather than from handlers.
 *
 * `busy` disables ONLY this control and says so with `aria-busy`. Disabling the
 * whole bar while one request is in flight is how "the page is stuck" and "the
 * thing I pressed is working" become indistinguishable.
 */
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Camera, Loader2 } from "lucide-react";
import { cn } from "../lib/utils.js";
import { dsFocus, dsFocusWithin, dsMotion, dsRadius } from "../ds/tokens.js";

/**
 * Three tones, and the choice is semantic:
 *   primary   — the ONE thing the bar is for right now (Take a photograph, Send)
 *   secondary — a real alternative beside it (Add a page, Retry)
 *   quiet     — a control that must not compete (Reorder, Back)
 *   danger    — an irreversible act (Discard). Never the bar's default.
 */
export type PhoneButtonTone = "primary" | "secondary" | "quiet" | "danger";

const TONE: Readonly<Record<PhoneButtonTone, string>> = Object.freeze({
  primary: cn(
    "bg-[var(--ds-accent)] text-[color:var(--ds-accent-fg)] border-transparent font-semibold",
    "hover:bg-[var(--ds-accent-hover)]",
  ),
  secondary: cn(
    "bg-[var(--ds-control-bg)] text-[color:var(--ds-control-fg)]",
    "border-[color:var(--ds-border-strong)]",
    "hover:bg-[var(--ds-control-bg-hover)]",
  ),
  quiet: cn(
    "bg-transparent text-[color:var(--ds-fg-secondary)]",
    "border-[color:var(--ds-border-strong)]",
    "hover:bg-[var(--ds-surface-3)] hover:text-[color:var(--ds-fg)]",
  ),
  danger: cn(
    "bg-transparent text-[color:var(--ds-danger)]",
    "border-[color:var(--ds-danger-border)]",
    "hover:bg-[var(--ds-danger-quiet)]",
  ),
});

/**
 * The shared box. `min-h` rather than `h` so a label that wraps at a small
 * width grows the control instead of overflowing it — the floor is a floor.
 */
const PHONE_CONTROL = cn(
  "inline-flex select-none items-center justify-center gap-[var(--ds-space-base)]",
  "min-h-[var(--ds-phone-touch)] min-w-[var(--ds-phone-touch)]",
  "px-[var(--ds-phone-inset)] border text-center",
  "phone-text",
  dsRadius.md,
  dsFocus,
  dsMotion.fast,
  /**
   * PRESS FEEDBACK IS A SCALE, NOT A NUDGE. The console's controls drop one
   * pixel on `:active`, which is legible under a mouse cursor on a 28px
   * button. Here a finger COVERS the control, so the only feedback the
   * operator can actually see is at the control's edges — and a 1px shift is
   * invisible there while a 3% scale reads instantly. `ds-motion-fast`
   * already transitions transform at 90ms, which is inside the press band.
   */
  "active:scale-[0.97]",
  "disabled:pointer-events-none disabled:opacity-45",
);

export interface PhoneButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  tone?: PhoneButtonTone;
  icon?: ReactNode;
  /** Spins in place of `icon` and disables THIS control only. */
  busy?: boolean;
  /** Fills the bar's remaining width — the bar's one primary always does. */
  grow?: boolean;
}

export const PhoneButton = forwardRef<HTMLButtonElement, PhoneButtonProps>(
  function PhoneButton({ className, tone = "secondary", icon, busy, grow, children, disabled, ...props }, ref) {
    return (
      <button
        ref={ref}
        type={props.type ?? "button"}
        aria-busy={busy === true ? true : undefined}
        disabled={disabled === true || busy === true}
        className={cn(PHONE_CONTROL, TONE[tone], grow === true && "flex-1", className)}
        {...props}
      >
        {busy === true
          ? <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
          : icon}
        {children}
      </button>
    );
  },
);

export interface PhoneIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "color"> {
  /** REQUIRED — becomes the accessible name. There is no unlabelled control. */
  label: string;
  icon: ReactNode;
  tone?: PhoneButtonTone;
}

/** A square thumb target. Used for the two move controls on a page tile. */
export const PhoneIconButton = forwardRef<HTMLButtonElement, PhoneIconButtonProps>(
  function PhoneIconButton({ className, label, icon, tone = "quiet", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={props.type ?? "button"}
        aria-label={label}
        className={cn(PHONE_CONTROL, TONE[tone], "px-0", className)}
        {...props}
      >
        {icon}
      </button>
    );
  },
);

/**
 * The camera. A real `<input type="file" accept="image/*" capture="environment">`
 * inside a `<label>` — the same construction `ds/primitives-form.tsx`'s Dropzone
 * established (D173), and the only one that opens the phone's own camera.
 *
 * `capture="environment"` asks for the REAR lens, which is the one pointed at a
 * document. It is a hint: a device without a rear camera, or a desktop browser,
 * falls back to its file picker, which is a genuinely valid outcome rather than
 * a failure — the operator is choosing an image either way, and the server
 * refuses anything that is not one by name.
 *
 * The value is cleared after every change so photographing the SAME page twice
 * still fires `change`; without it the second press looks dead.
 */
export function CameraButton({
  label,
  tone = "primary",
  busy,
  disabled,
  grow,
  onPhotograph,
}: {
  label: string;
  tone?: PhoneButtonTone;
  busy?: boolean;
  disabled?: boolean;
  grow?: boolean;
  onPhotograph: (file: File) => void;
}) {
  const inputId = useId();
  const inert = busy === true || disabled === true;
  return (
    <label
      htmlFor={inputId}
      aria-busy={busy === true ? true : undefined}
      className={cn(
        PHONE_CONTROL,
        TONE[tone],
        dsFocusWithin,
        grow === true && "flex-1",
        inert ? "pointer-events-none opacity-45" : "cursor-pointer",
      )}
    >
      <input
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={inert}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.item(0);
          event.currentTarget.value = "";
          // A cancelled camera is a real outcome, not an error and not a reason
          // to guess at a photograph that was never taken.
          if (file === null || file === undefined) return;
          onPhotograph(file);
        }}
      />
      {busy === true
        ? <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
        : <Camera aria-hidden className="size-5" />}
      {label}
    </label>
  );
}
