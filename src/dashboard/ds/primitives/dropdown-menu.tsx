import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "../../lib/utils.js"

import { CheckIcon, ChevronRightIcon } from "lucide-react"
import { OverlayLayerPresence } from "./primitives-overlay.js"

const MenuPortalContext = React.createContext<HTMLElement | null>(null);

function DropdownMenu({ onOpenChange, ...props }: MenuPrimitive.Root.Props) {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  return <MenuPortalContext.Provider value={container}><MenuPrimitive.Root data-slot="dropdown-menu" modal={false} {...props}
    onOpenChange={(open, details) => {
      if (open) {
        const target = details.event.target;
        setContainer((target instanceof Element ? target.closest<HTMLElement>('[role="dialog"]') : null) ?? (document.activeElement instanceof Element ? document.activeElement.closest<HTMLElement>('[role="dialog"]') : null));
      }
      onOpenChange?.(open, details);
    }} /></MenuPortalContext.Provider>;
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  const container = React.useContext(MenuPortalContext);
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" container={container ?? undefined} {...props} />;
}

function DropdownMenuTrigger({ asChild, children, ...props }: MenuPrimitive.Trigger.Props & { asChild?: boolean }) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" render={asChild ? React.Children.only(children) as React.ReactElement : undefined} {...props}>{asChild ? undefined : children}</MenuPrimitive.Trigger>
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  collisionAvoidance,
  collisionPadding,
  className,
  children,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "collisionAvoidance" | "collisionPadding"
  >) {
  return (
    <DropdownMenuPortal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn("ds-menu-surface z-50 max-h-(--available-height) w-auto origin-(--transform-origin) overflow-x-hidden overflow-y-auto duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className)}
          {...props}
        ><OverlayLayerPresence />{children}</MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </DropdownMenuPortal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn("ds-menu-label", className)}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  onSelect,
  onClick,
  ...props
}: Omit<MenuPrimitive.Item.Props, "onSelect"> & {
  onSelect?: (event: React.MouseEvent<HTMLElement>) => void;
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented) onSelect?.(event); }}
      className={cn("ds-menu-item group/dropdown-menu-item data-[variant=destructive]:text-[color:var(--ds-danger)]", className)}
      {...props}
    />
  )
}

/** A two-line item body: the title with a grey description under it. */
function DropdownMenuItemCopy({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) {
  return <span className="ds-menu-copy"><span>{title}</span>{description && <span>{description}</span>}</span>
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn("ds-menu-item", className)}
      {...props}
    >
      {children}
      <ChevronRightIcon aria-hidden className="ml-auto !size-3.5" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn("w-auto min-w-[96px]", className)}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "ds-menu-item pr-[34px]",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="ds-menu-indicator"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon aria-hidden className="ds-menu-check" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ onValueChange, ...props }: Omit<MenuPrimitive.RadioGroup.Props, "value" | "defaultValue" | "onValueChange"> & { value?: string; defaultValue?: string; onValueChange?: (value: string) => void }) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      onValueChange={value => { if (typeof value !== "string") throw new Error("MENU_RADIO_VALUE_INVALID"); onValueChange?.(value); }}
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "ds-menu-item pr-[34px]",
        className
      )}
      {...props}
    >
      <span
        className="ds-menu-indicator"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon aria-hidden className="ds-menu-check" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("ds-menu-separator", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuItemCopy,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
