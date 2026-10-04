import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { cn } from "../lib/utils.js"
import { SearchIcon, X } from "lucide-react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./input-group.js"

function Command({
  className,
  variant = "panel",
  ...props
}: React.ComponentProps<typeof CommandPrimitive> & { variant?: "panel" | "inline" }) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex w-full flex-col text-popover-foreground",
        variant === "panel" ? "h-full overflow-hidden rounded-md bg-popover" : "relative overflow-visible",
        className
      )}
      {...props}
    />
  )
}

function CommandInput({
  className,
  shortcut,
  onClear,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & { shortcut?: React.ReactNode; onClear?: () => void }) {
  return (
    <InputGroup className={className}>
      <CommandPrimitive.Input asChild {...props}><InputGroupInput aria-expanded={props['aria-expanded']} {...('aria-activedescendant' in props ? { 'aria-activedescendant': props['aria-activedescendant'] } : {})} /></CommandPrimitive.Input>
      <InputGroupAddon><SearchIcon aria-hidden /></InputGroupAddon>
      {(onClear || shortcut) && <InputGroupAddon align="inline-end">
        {props.value && onClear ? <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={onClear}><X aria-hidden /></InputGroupButton> : shortcut}
      </InputGroupAddon>}
    </InputGroup>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-sm"
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
