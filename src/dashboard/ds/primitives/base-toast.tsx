import { dsLayer } from "../theme/tokens.js"
import * as React from "react"
import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { cn } from "../../lib/utils.js"

import { Button } from "./primitives-core.js"
import { OctagonAlertIcon, XIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon, Loader2Icon } from "lucide-react"

const toast = ToastPrimitive.createToastManager()

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "pointer-events-none fixed bottom-[max(var(--ds-toast-inset-bottom,0.75rem),calc(var(--session-dock-h,0px)+1.25rem))] left-1/2 w-[320px] max-w-[calc(100vw-2rem)] -translate-x-1/2 outline-none",
        dsLayer.toastViewport,
        className
      )}
      {...props}
    />
  )
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      // A toast fades where it stands and swipes sideways: any downward move would cross the open Sessions panel below it.
      swipeDirection={["left", "right"]}
      className={cn(
        "group/toast pointer-events-auto absolute bottom-0 left-0 w-full origin-bottom cursor-pointer rounded-xl border bg-popover text-popover-foreground shadow-md will-change-transform outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "[--gap:0.5rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)+calc(var(--toast-index)*var(--gap))+var(--toast-swipe-movement-y))] [--peek:0.875rem] [--scale:calc(max(0,1-(var(--toast-index)*0.04)))]",
        "min-h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))))_scale(var(--scale))] [transition:transform_300ms_cubic-bezier(0.22,1,0.36,1),opacity_300ms,height_150ms]",
        "after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
        "data-expanded:min-h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--offset-y)*-1))]",
        "data-limited:opacity-0 data-starting-style:opacity-0 data-ending-style:opacity-0",
        "data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(calc(var(--offset-y)*-1))]",
        "data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(calc(var(--offset-y)*-1))]",
        dsLayer.toastCard,
        className
      )}
      {...props}
    />
  )
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        "flex items-start gap-2 px-3 py-2.5 data-behind:max-h-(--height) data-behind:overflow-hidden transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("text-[13px] leading-[18px] font-medium break-words", className)}
      {...props}
    />
  )
}

function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-xs leading-4 text-muted-foreground break-words", className)}
      {...props}
    />
  )
}

function ToastClose({
  className,
  children,
  render = <Button variant="ghost" size="sm" />,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Close toast"
      render={render}
      className={cn(
        "relative shrink-0 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:text-foreground",
        className
      )}
      {...props}
    >
      {children ?? (
        <XIcon aria-hidden className="size-4" />
      )}
    </ToastPrimitive.Close>
  )
}

function ToastIcon({ type }: { type: string | undefined }) {
  let icon: React.ReactNode = null

  if (type === "success") {
    icon = (
      <CircleCheckIcon aria-hidden className="size-4" />
    )
  }

  if (type === "info") {
    icon = (
      <InfoIcon aria-hidden className="size-4" />
    )
  }

  if (type === "warning") {
    icon = (
      <TriangleAlertIcon aria-hidden className="size-4" />
    )
  }

  if (type === "error") {
    icon = (
      <OctagonAlertIcon aria-hidden className="size-4 text-[color:var(--ds-danger)]" />
    )
  }

  if (type === "loading") {
    icon = (
      <Loader2Icon aria-hidden className="size-4" />
    )
  }

  if (!icon) {
    return null
  }

  return (
    <span
      data-slot="toast-icon"
      className="shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
    </span>
  )
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()

  return toasts.map((toastItem) => (
    <Toast key={toastItem.id} toast={toastItem}>
      <ToastContent>
        <ToastIcon type={toastItem.type} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ToastTitle />
          <ToastDescription />
        </div>
        <ToastClose />
      </ToastContent>
    </Toast>
  ))
}

function Toaster({
  children,
  toastManager = toast,
  ...props
}: ToastPrimitive.Provider.Props) {
  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  )
}

const createToastManager = ToastPrimitive.createToastManager
const useToastManager = ToastPrimitive.useToastManager

export {
  Toaster,
  Toast,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastIcon,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useToastManager,
}
