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
import { ToastIcon as BaseToastIcon, Toast as BaseToast, ToastContent as BaseToastContent, ToastTitle as BaseToastTitle, ToastDescription as BaseToastDescription, ToastAction as BaseToastAction, ToastClose as BaseToastClose, ToastViewport as BaseToastViewport } from "./base-toast.js";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { X } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { dsElev, dsIcon, dsLayer, dsMotion, dsRadius, dsText } from "../theme/tokens.js";
import { IconButton } from "./primitives-core.js";
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
  sm: "max-w-[420px]",
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

/** A modal dialog. `title` is REQUIRED — Radix warns without one,
 * and an unlabelled modal is unusable with a screen reader. */
export function DialogContent({
  title,
  description,
  size = "md",
  hideClose,
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
        {...(!description ? { "aria-describedby": undefined } : {})}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={event => { protectNestedPopupEscape(event); onEscapeKeyDown?.(event); }}
        className={cn(
          "fixed left-1/2 top-1/2 w-[calc(100vw-var(--ds-space-section))] -translate-x-1/2 -translate-y-1/2",
          DIALOG_SIZE[size],
          dsLayer.modal,
          "flex max-h-[86vh] flex-col overflow-hidden border outline-none",
          "border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-overlay)]",
          dsRadius.xl,
          dsElev.high,
          dsMotion.enter,
          entered ? "opacity-100 scale-100" : "opacity-0 scale-[0.98]",
          className,
        )}
      >
        <header className="flex shrink-0 items-start gap-[var(--ds-space-base)] border-b border-[color:var(--ds-border)] px-[var(--ds-space-loose)] py-[var(--ds-space-cozy)]">
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
        "flex shrink-0 items-center gap-[var(--ds-space-base)] border-t px-[var(--ds-space-loose)] py-[var(--ds-space-cozy)]",
        // The recessed plane, the same solid band the queue row's own footer
        // draws, read off the shared tokens rather than re-answered here.
        "border-[color:var(--ds-border-subtle)] bg-[var(--ds-recess-bg)] [border-end-start-radius:inherit] [border-end-end-radius:inherit]",
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
  children,
}: {
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  collisionBoundary?: Element | null;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionBoundary={collisionBoundary}
          collisionPadding={8}
          className={cn(
            "max-w-[280px] border px-[var(--ds-space-base)] py-[var(--ds-space-tight)]",
            "border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-overlay)] text-[color:var(--ds-fg)]",
            dsRadius.md,
            dsText.meta,
            dsElev.mid,
            dsLayer.menu,
          )}
        >
          {content}
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
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  side?: DsPopoverSide;
  align?: "start" | "center" | "end";
  width?: DsPopoverWidth;
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
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  side: DsPopoverSide;
  align: "start" | "center" | "end";
  width: DsPopoverWidth;
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
      sideOffset={6}
      collisionPadding={8}
      aria-label={title}
    >
      <FloatingSurface
        id={id}
        ref={surfaceRef}
        className={cn(
          POPOVER_WIDTH[width],
          "max-w-[calc(100vw-var(--ds-space-section))] outline-none",
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
              "flex items-start gap-[var(--ds-space-base)] border-b px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]",
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
        <div className={cn(dsText.body, "px-[var(--ds-space-cozy)] py-[var(--ds-space-base)] text-[color:var(--ds-fg-secondary)]")}>
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
  /** a single recovery action — "Retry", "Undo", "Open the run" */
  action?: { label: string; onAction: () => void };
  /** ms before auto-dismiss; default 3000. `danger` never auto-dismisses. */
  duration?: number;
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
        timeout: input.tone === "danger" ? 0 : input.duration ?? 3000,
        actionProps: input.action ? { children: input.action.label, onClick: () => { input.action?.onAction(); manager.close(id); } } : undefined,
      });
      return id;
    },
    dismiss: id => manager.close(id),
  }), [manager]);
  return <ToastContext.Provider value={value}><ToastPrimitive.Provider toastManager={manager}>
    {children}<ToastViewport />
  </ToastPrimitive.Provider></ToastContext.Provider>;
}

function ToastViewport() {
  const { toasts } = ToastPrimitive.useToastManager();
  const inert = useAnyOverlayOpen();
  return <BaseToastViewport aria-label="Notifications" data-ds-toast-viewport="default" inert={inert || undefined}>
    {toasts.map(item => <BaseToast key={item.id} toast={item} role={item.type === "error" ? "alert" : "status"} data-ds-toast-state="full" className={cn((inert || item.type === "success" && !item.actionProps) && "pointer-events-none")}>
      <BaseToastContent><BaseToastIcon type={item.type} />
        <div className="min-w-0 flex-1"><BaseToastTitle /><BaseToastDescription /></div>
        {item.actionProps && <BaseToastAction disabled={inert} />}
        <BaseToastClose disabled={inert} className={!inert && item.type === "success" && !item.actionProps ? "pointer-events-auto" : undefined} aria-label="Dismiss" />
      </BaseToastContent>
    </BaseToast>)}
  </BaseToastViewport>;
}
