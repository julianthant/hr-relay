import {
  createContext,
  useContext,
  useEffect,
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

export type DsDialogSize = "sm" | "md" | "lg" | "xl";

const DIALOG_SIZE: Record<DsDialogSize, string> = {
  sm: "max-w-[400px]",
  md: "max-w-[560px]",
  lg: "max-w-[760px]",
  xl: "max-w-[min(94vw,1100px)]",
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

/** A dialog's confirming action is the dashboard blue. */
const DIALOG_BLUE = "[--ds-accent:var(--ui-info)] [--ds-accent-fg:var(--ui-canvas)] [--ds-accent-hover:var(--ui-info)]";

/** A modal dialog. `title` is REQUIRED — Radix warns without one,
 * and an unlabelled modal is unusable with a screen reader. */
export function DialogContent({
  title,
  description,
  size = "md",
  hideClose,
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
  hideClose?: boolean;
  /** The Run and Rerun dialog only: a divided header and a grey footer band. Every other dialog is compact. */
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
        hideClose={hideClose}
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
  hideClose,
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
  hideClose?: boolean;
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
        data-band={band || undefined}
        {...(!description ? { "aria-describedby": undefined } : {})}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={event => { protectNestedPopupEscape(event); onEscapeKeyDown?.(event); }}
        className={cn(
          "fixed left-1/2 top-1/2 w-[calc(100vw-var(--ds-space-section))] -translate-x-1/2 -translate-y-1/2",
          DIALOG_SIZE[size],
          dsLayer.modal,
          "group/dialog flex max-h-[86vh] flex-col overflow-hidden border outline-none", DIALOG_BLUE,
          "border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-overlay)]",
          dsRadius.xl,
          dsElev.high,
          dsMotion.enter,
          entered ? "opacity-100 scale-100" : "opacity-0 scale-[0.98]",
          className,
        )}
      >
        <header className="flex shrink-0 items-start gap-[var(--ds-space-base)] px-[var(--ds-space-loose)] py-[var(--ds-space-cozy)] group-data-[band]/dialog:border-b group-data-[band]/dialog:border-[color:var(--ds-border)]">
          <div className="flex min-w-0 flex-1 flex-col gap-[var(--ds-space-hair)]">
            <DialogPrimitive.Title className={cn(dsText.section, "font-semibold text-[color:var(--ds-fg)]")}>
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          {!hideClose && (
            <DialogPrimitive.Close asChild>
              <IconButton label="Close" size="sm" icon={<X aria-hidden className={dsIcon.md} />} />
            </DialogPrimitive.Close>
          )}
        </header>
        {children}
      </DialogPrimitive.Content>
    </>
  );
}

export function DialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto px-[var(--ds-space-loose)] py-[var(--ds-space-cozy)]", className)}>
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
      className={cn(
        // Compact: the buttons sit in the dialog's own padding. Only the Run and Rerun dialog (`band`) has the recessed plane.
        "flex shrink-0 items-center gap-[var(--ds-space-base)] px-[var(--ds-space-loose)] pb-[var(--ds-space-cozy)]",
        "group-data-[band]/dialog:border-t group-data-[band]/dialog:border-[color:var(--ds-border-subtle)] group-data-[band]/dialog:bg-[var(--ds-recess-bg)] group-data-[band]/dialog:pt-[var(--ds-space-cozy)] group-data-[band]/dialog:[border-end-start-radius:inherit] group-data-[band]/dialog:[border-end-end-radius:inherit]",
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
      <span className="flex shrink-0 items-center gap-[var(--ds-space-base)]">{children}</span>
    </footer>
  );
}

/** Confirm: the one dialog every confirmation uses.
 * No close ×: Escape and Cancel close it, and Cancel takes focus (ringed). A destructive action is a soft red button named for the action;
 * any other confirm is the blue primary. Never offers "Don't ask again" for deleting or merging data. */
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
  /** The exact thing affected: a file name, path or ID. */
  detail?: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  destructive?: boolean;
  cancelLabel?: ReactNode;
  busy?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <ConfirmSurface title={title} description={description} detail={detail} confirmLabel={confirmLabel} onConfirm={onConfirm}
          destructive={destructive} cancelLabel={cancelLabel} busy={busy} onCloseAutoFocus={onCloseAutoFocus} />
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ConfirmSurface({
  title, description, detail, confirmLabel, onConfirm, destructive, cancelLabel, busy, onCloseAutoFocus,
}: {
  title: ReactNode; description?: ReactNode; detail?: ReactNode; confirmLabel: ReactNode; onConfirm: () => void;
  destructive: boolean; cancelLabel: ReactNode; busy: boolean; onCloseAutoFocus?: (event: Event) => void;
}) {
  const entered = useEntered();
  useRegisterModal();
  return (
    <>
      <Scrim layer={dsLayer.modal} entered={entered} />
      <DialogPrimitive.Content
        {...(!description ? { "aria-describedby": undefined } : {})}
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-confirm-cancel]")?.focus(); }}
        className={cn(
          "fixed left-1/2 top-1/2 w-[calc(100vw-var(--ds-space-section))] max-w-[420px] -translate-x-1/2 -translate-y-1/2",
          dsLayer.modal,
          "flex flex-col gap-[var(--ds-space-loose)] border p-5 outline-none", DIALOG_BLUE,
          "rounded-[20px] border-[color:var(--ds-border)] bg-[var(--ds-surface-overlay)]",
          dsElev.high,
          dsMotion.enter,
          entered ? "opacity-100 scale-100" : "opacity-0 scale-[0.98]",
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <DialogPrimitive.Title className="m-0 text-[20px] font-semibold leading-7 text-[color:var(--ds-fg)]">{title}</DialogPrimitive.Title>
          {description && <DialogPrimitive.Description className="m-0 text-[13px] leading-5 text-[color:var(--ds-fg-muted)]">{description}</DialogPrimitive.Description>}
          {detail && <p className="m-0 break-all font-mono text-[13px] leading-5 text-[color:var(--ds-fg-muted)]">{detail}</p>}
        </div>
        <div className="flex justify-end gap-3">
          <DialogPrimitive.Close asChild>
            <Button data-confirm-cancel variant="muted" disabled={busy} className="h-8 focus:[outline-style:solid] focus:outline-[length:var(--ds-focus-ring-w)] focus:outline-offset-[var(--ds-focus-ring-offset)] focus:outline-[color:var(--ds-focus-ring)]">{cancelLabel}</Button>
          </DialogPrimitive.Close>
          <Button variant={destructive ? "danger" : "primary"} loading={busy} onClick={onConfirm} className="h-8 rounded-[8px]">{confirmLabel}</Button>
        </div>
      </DialogPrimitive.Content>
    </>
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
            <IconButton label="Close" size="sm" icon={<X aria-hidden className={dsIcon.md} />} />
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
  children,
}: {
  content: ReactNode;
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
          className={cn("ds-tooltip", dsLayer.tooltip)}
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
  /** ms before auto-dismiss; default 3000. `danger` never auto-dismisses unless a duration is given. */
  duration?: number;
  /** stays until its owner dismisses it or the operator clicks it */
  sticky?: boolean;
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const manager = useMemo(() => ToastPrimitive.createToastManager(), []);
  const nextId = useRef(0);
  const value = useMemo<ToastContextValue>(() => ({
    toast: input => {
      const id = `toast-${++nextId.current}`;
      manager.add({ id, title: input.title, description: input.description,
        type: input.tone === "danger" ? "error" : input.tone,
        timeout: input.sticky ? 0 : input.duration ?? (input.tone === "danger" ? 0 : 3000),
      });
      return id;
    },
    dismiss: id => manager.close(id),
  }), [manager]);
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
  return <BaseToastViewport aria-label="Notifications" data-ds-toast-viewport="default" inert={inert || undefined}>
    {toasts.map(item => {
      return <BaseToast key={item.id} toast={item} role={item.type === "error" ? "alert" : "status"} data-ds-toast-state="full" tabIndex={0} aria-label="Dismiss notification"
        onClick={() => close(item.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === "Escape" || event.key === " ") close(item.id); }}
        className={cn(inert && "pointer-events-none")}>
        <BaseToastContent><BaseToastIcon type={item.type} />
          <div className="min-w-0 flex-1"><BaseToastTitle /><BaseToastDescription /></div>
        </BaseToastContent>
      </BaseToast>;
    })}
  </BaseToastViewport>;
}
