import { memo, type ReactNode } from "react";
import { LogFeed } from "./log-feed.js";
import type { LogStep } from "./log-feed-model.js";

/** The production log layout accepts presentation data and has no transport dependency. */
export const LogPanel = memo(function LogPanel({ title, steps, status, toolbar }: {
  title: string; steps: readonly LogStep[]; status?: string; toolbar?: ReactNode;
}) {
  return <section aria-label="Selected run logs" className="ui-theme-scope flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel font-ui text-ui-primary [--ds-control-bg:var(--ui-table)] [--ds-control-fg:var(--ui-primary)] [--ds-control-bg-hover:var(--ui-hover)] [--ds-border-strong:var(--ui-stroke-control)] [--ds-focus-ring:var(--ui-info)]">
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-ui-stroke px-4 py-3"><h2 className="m-0 min-w-0 text-heading text-balance">{title}</h2>{status && <span className="text-caption text-ui-secondary">{status}</span>}<span className="ml-auto">{toolbar}</span></header>
    <LogFeed steps={steps} />
  </section>;
});
