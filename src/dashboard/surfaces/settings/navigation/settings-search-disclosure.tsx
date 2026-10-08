import { useContext, useEffect, useState, type ComponentProps } from "react";
import { Disclosure } from "../../../ds/ui.js";
import { SettingsSearchTargetContext } from "./settings-search-target-model.js";

/** Keep a searched field reachable even when its group started collapsed. */
export function SettingsSearchDisclosure({ paths, defaultOpen, ...props }: Omit<ComponentProps<typeof Disclosure>, "open" | "onOpenChange"> & {
  paths: readonly string[];
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const { target: searchTarget, visit } = useContext(SettingsSearchTargetContext);
  const matched = searchTarget !== undefined && paths.some(path => searchTarget === path || searchTarget.startsWith(`${path}.`));
  useEffect(() => { if (matched) setOpen(true); }, [matched, searchTarget, visit]);
  return <Disclosure {...props} open={open} onOpenChange={setOpen} />;
}
