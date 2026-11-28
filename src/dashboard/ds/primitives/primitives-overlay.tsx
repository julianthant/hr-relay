import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
  type ReactNode,
} from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { ToastIcon as BaseToastIcon, Toast as BaseToast, ToastContent as BaseToastContent, ToastTitle as BaseToastTitle, ToastDescription as BaseToastDescription, ToastViewport as BaseToastViewport } from "./base-toast.js";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { X } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { dsElev, dsIcon, dsLayer, dsMotion, dsRadius, dsText } from "../theme/tokens.js";
import { Button, IconButton } from "./primitives-core.js";
import { FloatingSurface } from "./primitives-layout.js";

/** Floating surfaces: Dialog, Drawer, Popover, Tooltip, Toast. */

/** Modal presence
 * A module-scoped registry of how many modal surfaces are currently mounted */

// Modals move toasts away from primary actions; nonmodal layers only make toast controls inert.
let openModalCount = 0;
let openLayerCount = 0;
const modalListeners = new Set<() => void>();

function subscribeModals(onChange: () => void): () => void {
  modalListeners.add(onChange);
  return () => {
    modalListeners.delete(onChange);
  };
}

function bumpCount(kind: "modal" | "layer", delta: number): void {
  if (kind === "modal") openModalCount += delta;
  else openLayerCount += delta;
  modalListeners.forEach((listener) => listener());
}

/** Called by every overlay surface; they only mount while open. */
function useRegisterModal(kind: "modal" | "layer" = "modal"): void {
  useEffect(() => {
    bumpCount(kind, 1);
    return () => bumpCount(kind, -1);
  }, [kind]);
}

/** Mounted inside library-owned content so closed menus do not suppress shell keys. */
export function OverlayLayerPresence() {
  useRegisterModal("layer");
  return null;
}

/** Register a modal surface that is NOT one of this file's Dialog/Drawer.
 * The registry above is what marks overlay layers open so toast cards go inert */
export function useDsModalPresence(): void {
  useRegisterModal();
}

// Focus traps do not stop window key listeners; suppress shell shortcuts while modals are open.
export function useDsModalOpen(): boolean {
  return useModalOpen();
}

// Decision notices stay panel-relative; app toasts stay viewport-relative, independent of each other.

/** Is any Dialog or Drawer open right now? */
function useModalOpen(): boolean {
  return useSyncExternalStore(
    subscribeModals,
    () => openModalCount > 0,
    () => false,
  );
}

/** Is any dismissable layer open — a modal, a popover or a context menu? */
function useAnyOverlayOpen(): boolean {
  return useSyncExternalStore(
    subscribeModals,
    () => openModalCount + openLayerCount > 0,
    () => false,
  );
}

/** True one frame after mount */
function useEntered(): boolean {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return entered;
}

/** Dialog */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DsDialogSize = "sm" | "md" | "lg";

/** sm 520, md 560, lg 880. `lg` is the Start run frame: a 73px divided header and a 57px recessed footer. */
const DIALOG_SIZE: Record<DsDialogSize, string> = {
  sm: "max-w-[520px]",
  md: "max-w-[560px]",
  lg: "max-w-[880px]",
};

/** The backdrop. `slow` matches a DRAWER's own `--ds-dur-4` slide */
function Scrim({ layer, entered, slow }: { layer: string; entered: boolean; slow?: boolean }) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 bg-[var(--ds-surface-scrim)]",
        layer,
        dsMotion.enter,
        slow && "duration-[var(--ds-dur-4)]",
        entered ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

/** A modal dialog. `title` is REQUIRED — Radix warns without one,
 * and an unlabelled modal is unusable with a screen reader. */
export function DialogContent({
  title,
  description,
  size = "md",
  band,
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  size?: DsDialogSize;
  /** A divided header and a recessed footer band; `size="lg"` always has them. */
  band?: boolean;
  className?: string;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogSurface
        title={title}
        description={description}
        size={size}
        band={band}
        className={className}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={onEscapeKeyDown}
      >
        {children}
      </DialogSurface>
    </DialogPrimitive.Portal>
  );
}

function protectNestedPopupEscape(event: KeyboardEvent): void {
  // Radix handles Escape in capture
  const dialog = event.target instanceof Element ? event.target.closest('[role="dialog"]') : null;
  if (dialog?.querySelector('[data-slot="dropdown-menu-content"][data-open], [data-slot="dropdown-menu-sub-content"][data-open], [data-slot="select-content"][data-open]')) event.preventDefault();
}

/** Mounts only while the dialog is open — which is what makes the entry read. */
function DialogSurface({
  title,
  description,
  size,
  band,
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  size: DsDialogSize;
  band?: boolean;
  className?: string;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  children: ReactNode;
}) {
  const entered = useEntered();
  useRegisterModal();
  return (
    <>
      <Scrim layer={dsLayer.modal} entered={entered} />
      <DialogPrimitive.Content
        data-band={band || size === "lg" || undefined}
        data-size={size}
        {...(!description ? { "aria-describedby": undefined } : {})}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={event => { protectNestedPopupEscape(event); onEscapeKeyDown?.(event); }}
        className={cn(
          "fixed left-1/2 top-1/2 w-[calc(100vw-var(--ds-space-section))] -translate-x-1/2 -translate-y-1/2",
          DIALOG_SIZE[size],
          dsLayer.modal,
          "group/dialog flex max-h-[86vh] flex-col overflow-hidden outline-none",
          "bg-[var(--ds-dialog-bg)] rounded-[var(--ds-radius-dialog)]",
          dsElev.high,
          dsMotion.enter,
          entered ? "opacity-100 scale-100" : "opacity-0 scale-[0.98]",
          className,
        )}
      >
        <header className="flex shrink-0 items-start gap-[var(--ds-space-base)] px-[var(--ds-dialog-pad)] pb-[var(--ds-dialog-header-pb)] pt-[var(--ds-dialog-pad)] group-data-[band]/dialog:border-b group-data-[band]/dialog:border-[color:var(--ds-border)] group-data-[size=lg]/dialog:h-[73px] group-data-[size=lg]/dialog:items-center group-data-[size=lg]/dialog:bg-[var(--ds-surface-2)]">
          <div className="flex min-w-0 flex-1 flex-col gap-[var(--ds-space-hair)]">
            <DialogPrimitive.Title className="text-[length:var(--ds-dialog-title-size)] font-semibold leading-[var(--ds-dialog-title-lh)] text-[color:var(--ds-fg)]">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <IconButton label="Close" size="md" variant="ghost" className="ds-dialog-close" icon={<X aria-hidden className={dsIcon.lg} />} />
          </DialogPrimitive.Close>
        </header>
        {children}
      </DialogPrimitive.Content>
    </>
  );
}

export function DialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div data-slot="dialog-body" className={cn("min-h-0 flex-1 overflow-y-auto px-[var(--ds-dialog-pad)] pt-[var(--ds-dialog-body-pt)] pb-[var(--ds-dialog-body-pb)]", className)}>
      {children}
    </div>
  );
}

/** Actions right-aligned, primary last — the operator's eye ends on the verb.
 * `meta` is the quiet left-hand slot every dialog in this product wants */
export function DialogFooter({
  meta,
  className,
  children,
}: {
  meta?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <footer
      data-slot="dialog-footer"
      className={cn(
        // Compact: the buttons sit in the dialog's own padding. Only the Run and Rerun dialog (`band`) has the recessed plane.
        "flex shrink-0 items-center gap-[var(--ds-dialog-footer-gap)] px-[var(--ds-dialog-pad)] pb-[var(--ds-dialog-pad)] pt-[var(--ds-dialog-footer-pt)]",
        "group-data-[size=lg]/dialog:h-[57px] group-data-[size=lg]/dialog:pb-0 group-data-[band]/dialog:border-t group-data-[band]/dialog:border-[color:var(--ds-border-subtle)] group-data-[band]/dialog:bg-[var(--ds-recess-bg)] group-data-[band]/dialog:pt-[var(--ds-space-cozy)] group-data-[band]/dialog:[border-end-start-radius:inherit] group-data-[band]/dialog:[border-end-end-radius:inherit]",
        meta ? "justify-between" : "justify-end",
        className,
      )}
    >
      {meta && (
        <span
          className={cn(
            dsText.meta,
            "min-w-0 flex-1 truncate text-[color:var(--ds-fg-muted)]",
          )}
        >
          {meta}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-[var(--ds-dialog-footer-gap)]">{children}</span>
    </footer>
  );
}

/** Confirm: the one dialog every confirmation uses, in the `sm` Dialog frame.
 * The title is the question, `description` is the one consequence sentence, Cancel takes focus first and
 * the confirm button is named for the action: red when `destructive`, the blue primary otherwise.
 * Red appears on that one button only. Never offers "Don't ask again" for deleting or merging data. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  detail,
  confirmLabel,
  onConfirm,
  destructive = false,
  cancelLabel = "Cancel",
  busy = false,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** The exact thing affected: a file name or path. Not an id or revision. */
  detail?: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  destructive?: boolean;
  cancelLabel?: ReactNode;
  busy?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={title}
        description={description}
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-confirm-cancel]")?.focus(); }}
      >
        {detail && (
          <DialogBody className="pt-0">
            <p className={cn("m-0 break-all text-[color:var(--ds-fg-muted)]", dsText.ui)}>{detail}</p>
          </DialogBody>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button data-confirm-cancel variant="secondary" disabled={busy}>{cancelLabel}</Button>
          </DialogClose>
          <Button variant={destructive ? "danger" : "primary"} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Drawer */

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export type DsDrawerSide = "right" | "bottom";

/** A drawer is a dialog that arrives from an edge. Use it when the operator
 * needs the CONTEXT behind it (a run's detail beside its queue); use a Dialog */
export function DrawerContent({
  title,
  description,
  side = "right",
  size = "480px",
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  side?: DsDrawerSide;
  /** width for a right drawer, height for a bottom one */
  size?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DrawerSurface
        title={title}
        description={description}
        side={side}
        size={size}
        className={className}
      >
        {children}
      </DrawerSurface>
    </DialogPrimitive.Portal>
  );
}

function DrawerSurface({
  title,
  description,
  side,
  size,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  side: DsDrawerSide;
  size: string;
  className?: string;
  children: ReactNode;
}) {
  const entered = useEntered();
  useRegisterModal();
  const isRight = side === "right";
  return (
    <>
      <Scrim layer={dsLayer.drawer} entered={entered} slow />
      <DialogPrimitive.Content
        style={isRight ? { width: size } : { height: size }}
        onEscapeKeyDown={protectNestedPopupEscape}
        className={cn(
          "fixed flex flex-col overflow-hidden border outline-none",
          isRight ? "inset-y-0 right-0 max-w-[94vw] border-l" : "inset-x-0 bottom-0 max-h-[90vh] border-t",
          dsLayer.drawer,
          "border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-overlay)]",
          dsElev.high,
          "transition-transform duration-[var(--ds-dur-4)] ease-[var(--ds-ease-out)]",
          entered ? "translate-x-0 translate-y-0" : isRight ? "translate-x-full" : "translate-y-full",
          className,
        )}
      >
        <header className="flex shrink-0 items-start gap-[var(--ds-space-base)] border-b border-[color:var(--ds-border)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]">
          <div className="flex min-w-0 flex-1 flex-col gap-[var(--ds-space-hair)]">
            <DialogPrimitive.Title className={cn(dsText.title, "truncate font-semibold text-[color:var(--ds-fg)]")}>
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className={cn(dsText.meta, "truncate text-[color:var(--ds-fg-muted)]")}>
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <IconButton label="Close" size="md" icon={<X aria-hidden className={dsIcon.md} />} />
          </DialogPrimitive.Close>
        </header>
        {children}
      </DialogPrimitive.Content>
    </>
  );
}

/** Tooltip */

export const TooltipProvider = TooltipPrimitive.Provider;

// Tooltips supplement visible labels; touch and keyboard users may never reach them.
export function Tooltip({
  content,
  side = "top",
  collisionBoundary,
  open,
  shortcut,
  variant,
  children,
}: {
  content: ReactNode;
  /** `card` is the rich-content surface (256px card, 12px corners) instead of the one-line hint; `wrap` is the hint with its text wrapped, for names of any length. */
  variant?: "card" | "wrap";
  /** The key chord, drawn as a chip after the text. */
  shortcut?: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  collisionBoundary?: Element | null;
  /** Set false to hold the tooltip closed (for example while the trigger's own menu is open). */
  open?: false;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root {...(open === false ? { open: false } : {})}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          collisionBoundary={collisionBoundary}
          collisionPadding={8}
          className={cn("ds-tooltip", variant === "card" && "ds-tooltip--card", variant === "wrap" && "ds-tooltip--wrap", dsLayer.tooltip)}
        >
          {content}{shortcut && <kbd className="ds-tooltip-key">{shortcut}</kbd>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** Popover
 * The Tooltip's counterpart, and the reason both exist: a tooltip is a HINT */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export type DsPopoverSide = "top" | "right" | "bottom" | "left";
export type DsPopoverWidth = "sm" | "md" | "lg";

const POPOVER_WIDTH: Record<DsPopoverWidth, string> = {
  sm: "w-[var(--ds-w-popover-sm)]",
  md: "w-[var(--ds-w-popover-md)]",
  lg: "w-[var(--ds-w-popover-lg)]",
};

/** Entry motion is ORIGIN-AWARE: the surface scales out of the point it is
 * anchored to, so it reads as coming FROM the trigger rather than appearing */
const POPOVER_ORIGIN = "origin-[var(--radix-popover-content-transform-origin)]";

/** <Popover>
 * <PopoverTrigger asChild> */
export function PopoverContent({
  id,
  title,
  description,
  side = "bottom",
  align = "start",
  width = "md",
  hideTitle,
  hideClose,
  className,
  surfaceRef,
  onOpenAutoFocus,
  sideOffset,
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  side?: DsPopoverSide;
  align?: "start" | "center" | "end";
  width?: DsPopoverWidth;
  sideOffset?: number;
  /** keep the accessible name, drop the visible heading row */
  hideTitle?: boolean;
  hideClose?: boolean;
  className?: string;
  surfaceRef?: Ref<HTMLDivElement>;
  onOpenAutoFocus?: (event: Event) => void;
  children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverSurface
        id={id}
        title={title}
        description={description}
        side={side}
        align={align}
        width={width}
        hideTitle={hideTitle}
        hideClose={hideClose}
        className={className}
        surfaceRef={surfaceRef}
        onOpenAutoFocus={onOpenAutoFocus}
        sideOffset={sideOffset}
      >
        {children}
      </PopoverSurface>
    </PopoverPrimitive.Portal>
  );
}

/** Mounts only while the popover is open — which is what lets it both read as
 * arriving AND register itself in the modal-presence registry. */
function PopoverSurface({
  id,
  title,
  description,
  side,
  align,
  width,
  hideTitle,
  hideClose,
  className,
  surfaceRef,
  onOpenAutoFocus,
  sideOffset = 6,
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  side: DsPopoverSide;
  align: "start" | "center" | "end";
  width: DsPopoverWidth;
  sideOffset?: number | undefined;
  hideTitle?: boolean;
  hideClose?: boolean;
  className?: string;
  surfaceRef?: Ref<HTMLDivElement>;
  onOpenAutoFocus?: (event: Event) => void;
  children: ReactNode;
}) {
  const entered = useEntered();
  useRegisterModal("layer");
  const showHeader = !hideTitle;
  return (
    <PopoverPrimitive.Content
      asChild
      side={side}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={8}
      aria-label={title}
      onOpenAutoFocus={onOpenAutoFocus}
    >
      <FloatingSurface
        id={id}
        ref={surfaceRef}
        className={cn(
          POPOVER_WIDTH[width],
          "ds-menu-surface max-w-[calc(100vw-var(--ds-space-section))]",
          dsLayer.menu,
          dsMotion.enter,
          POPOVER_ORIGIN,
          entered ? "opacity-100 scale-100" : "opacity-0 scale-[0.97]",
          className,
        )}
      >
        {showHeader && (
          <header
            className={cn(
              "flex items-start gap-[var(--ds-space-base)] border-b px-[10px] py-[6px]",
              "border-[color:var(--ds-border-subtle)]",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className={cn(dsText.ui, "truncate font-semibold text-[color:var(--ds-fg)]")}>{title}</p>
              {description && (
                <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{description}</p>
              )}
            </div>
            {!hideClose && (
              <PopoverPrimitive.Close asChild>
                <IconButton label="Close" size="sm" icon={<X aria-hidden className={dsIcon.md} />} />
              </PopoverPrimitive.Close>
            )}
          </header>
        )}
        <div className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
          {children}
        </div>
      </FloatingSurface>
    </PopoverPrimitive.Content>
  );
}

/** ContextMenu — the commands an object carries, on its own object
 * An object's commands belong on the object itself, not behind a `⋯` button */

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuSeparator = ContextMenuPrimitive.Separator;

// Radix has no controlled open prop; keyboard opening dispatches its native contextmenu event.
export function openContextMenuFor(element: Element | null | undefined): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const box = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(box.left + 16),
      clientY: Math.round(box.top + 16),
    }),
  );
  return true;
}

/** The surface. Same floating language as `Popover` — overlay surface, menu
 * layer, mid elevation — and the same origin-aware entry, scaled from 0.97 */
export function ContextMenuContent({
  label,
  className,
  children,
}: {
  /** REQUIRED — the menu's accessible name ("Commands for Maria Lopez"). */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuSurface label={label} className={className}>
        {children}
      </ContextMenuSurface>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuSurface({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const entered = useEntered();
  useRegisterModal("layer");
  return (
    <ContextMenuPrimitive.Content
      aria-label={label}
      collisionPadding={8}
      className={cn(
        "min-w-[var(--ds-w-menu)] max-w-[calc(100vw-var(--ds-space-section))] overflow-hidden border py-[var(--ds-space-tight)]",
        "border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-overlay)]",
        dsRadius.md,
        dsElev.mid,
        dsLayer.menu,
        dsMotion.enter,
        "origin-[var(--radix-context-menu-content-transform-origin)]",
        entered ? "opacity-100 scale-100" : "opacity-0 scale-[0.97]",
        className,
      )}
    >
      {children}
    </ContextMenuPrimitive.Content>
  );
}

/** A group heading inside the menu. Never a sentence — it names a set. */
export function ContextMenuLabel({ children }: { children: ReactNode }) {
  return (
    <ContextMenuPrimitive.Label
      className={cn(dsText.caps, "px-[var(--ds-space-cozy)] py-[var(--ds-space-tight)] text-[color:var(--ds-fg-muted)]")}
    >
      {children}
    </ContextMenuPrimitive.Label>
  );
}

/** One command. `tone="destructive"` is the single irreversible slot — the same
 * rule the rest of the system holds to, so a menu never offers two. */
export function ContextMenuItem({
  icon,
  tone = "neutral",
  hint,
  disabled,
  onSelect,
  children,
}: {
  icon?: ReactNode;
  tone?: "neutral" | "destructive";
  /** a trailing keyboard hint or short qualifier — never an explanation */
  hint?: ReactNode;
  disabled?: boolean;
  onSelect?: () => void;
  children: ReactNode;
}) {
  return (
    <ContextMenuPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-[var(--ds-space-snug)] outline-none",
        "px-[var(--ds-space-cozy)] py-[var(--ds-space-tight)]",
        dsText.body,
        dsMotion.fast,
        tone === "destructive" ? "text-[color:var(--ds-danger)]" : "text-[color:var(--ds-fg-secondary)]",
        tone === "destructive"
          ? "data-[highlighted]:bg-[var(--ds-danger-quiet)]"
          : "data-[highlighted]:bg-[var(--ds-surface-3)] data-[highlighted]:text-[color:var(--ds-fg)]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
      )}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className={cn(dsText.micro, "shrink-0 text-[color:var(--ds-fg-faint)]")}>{hint}</span>}
    </ContextMenuPrimitive.Item>
  );
}

/** Toast */

export type DsToastTone = "info" | "success" | "warning" | "danger";

export interface DsToast {
  id: string;
  tone: DsToastTone;
  title: string;
  description?: string;
  /** ms before auto-dismiss; default 3000, `danger` 12000. */
  duration?: number;
  /** stays until its owner dismisses it or the operator clicks it */
  sticky?: boolean;
  /** one action, one toast: a new toast with the same key replaces the earlier one; defaults to the title */
  key?: string;
}

interface ToastContextValue {
  toast: (toast: Omit<DsToast, "id">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** `const { toast } = useToasts` — then
 * `toast({ tone: "danger", title: "Write parked", description: "…" })`. */
export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts() must be used inside <ToastProvider>");
  return ctx;
}

/** `hold` keeps every toast until it is dismissed: a state gallery that walks the page by keyboard must find the toast still there. */
export function ToastProvider({ children, hold = false }: { children: ReactNode; hold?: boolean }) {
  const manager = useMemo(() => ToastPrimitive.createToastManager(), []);
  const nextId = useRef(0);
  const byKey = useRef(new Map<string, string>());
  const value = useMemo<ToastContextValue>(() => ({
    toast: input => {
      const id = `toast-${++nextId.current}`;
      const key = input.key ?? input.title;
      const earlier = byKey.current.get(key);
      if (earlier !== undefined) manager.close(earlier);
      byKey.current.set(key, id);
      manager.add({ id, title: input.title, description: input.description,
        type: input.tone === "danger" ? "error" : input.tone,
        timeout: input.sticky || hold ? 0 : input.duration ?? (input.tone === "danger" ? 12000 : 3000),
      });
      return id;
    },
    dismiss: id => manager.close(id),
  }), [manager, hold]);
  return <ToastContext.Provider value={value}><ToastPrimitive.Provider toastManager={manager} limit={3}>
    {children}<ToastViewport />
  </ToastPrimitive.Provider></ToastContext.Provider>;
}

/** A toast tied to the surface that renders it: shown while mounted, withdrawn when the state clears.
 * `sticky` is for a state the operator must act on elsewhere; otherwise it dismisses itself. Without a `ToastProvider` it renders inline. */
export function Notice({ tone, title, description, sticky = false }: Pick<DsToast, "tone" | "title" | "description" | "sticky">) {
  const toasts = useContext(ToastContext);
  useEffect(() => {
    if (toasts === null) return;
    const id = toasts.toast({ tone, title, description, sticky, duration: 6000 });
    return () => toasts.dismiss(id);
  }, [toasts, tone, title, description, sticky]);
  if (toasts !== null) return null;
  return <div role={tone === "danger" ? "alert" : "status"}><span>{title}</span><span>{description}</span></div>;
}

function ToastViewport() {
  const { toasts, close } = ToastPrimitive.useToastManager();
  const inert = useAnyOverlayOpen();
  // The stack's bottom edge (12px top; 8px gaps expanded, 14px peeks at rest), published so the open Sessions panel always ends below it.
  // It grows at once when the stack expands and shrinks only after the 300ms collapse, so the panel never meets a moving toast.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const observer = new MutationObserver(() => setExpanded(viewport.hasAttribute("data-expanded")));
    observer.observe(viewport, { attributes: true, attributeFilter: ["data-expanded"] });
    return () => observer.disconnect();
  }, []);
  const shown = toasts.filter(item => item.limited !== true);
  const stackBottom = shown.length === 0 ? 0 : 12 + (expanded
    ? shown.reduce((sum, item) => sum + (item.height ?? 0), 0) + 8 * (shown.length - 1)
    : (shown[0]?.height ?? 0) + 14 * (shown.length - 1));
  const [published, setPublished] = useState(stackBottom);
  useEffect(() => {
    if (stackBottom >= published) { setPublished(stackBottom); return; }
    const timer = window.setTimeout(() => setPublished(stackBottom), 300);
    return () => window.clearTimeout(timer);
  }, [stackBottom, published]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--toast-stack-bottom", `${String(Math.max(stackBottom, published))}px`);
    return () => { root.style.removeProperty("--toast-stack-bottom"); };
  }, [stackBottom, published]);
  return <BaseToastViewport ref={viewportRef} aria-label="Notifications" data-ds-toast-viewport="default" inert={inert || undefined}>
    {toasts.map(item => {
      return <BaseToast key={item.id} toast={item} role={item.type === "error" ? "alert" : "status"} data-ds-toast-state="full" tabIndex={0} aria-label="Dismiss notification"
        onClick={() => close(item.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === "Escape" || event.key === " ") close(item.id); }}
        className={cn(inert && "pointer-events-none")}>
        <BaseToastContent><BaseToastIcon type={item.type} />
          <div className="min-w-0 flex-1"><BaseToastTitle /><BaseToastDescription />
          </div>
        </BaseToastContent>
      </BaseToast>;
    })}
  </BaseToastViewport>;
}
