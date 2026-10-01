import { useState } from "react";
import { Moon, ScrollText, Sun } from "lucide-react";
import { Button, IconButton, useDemoTheme } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { LogFeed } from "../surfaces/log-feed.js";
import { previewScenarios } from "./fixtures.js";

export function LogsPreview() {
  const [scenarioId, setScenarioId] = useState<string>("separation");
  const scenario = previewScenarios.find(item => item.id === scenarioId);
  if (scenario === undefined) throw new Error("Unknown Logs preview scenario.");
  const { theme, toggleTheme } = useDemoTheme();
  return <main className="ui-theme-scope flex h-dvh min-h-180 min-w-256 flex-col bg-ui-canvas font-ui text-body text-ui-primary">
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ui-stroke px-4"><strong className="text-control">HR Automation</strong><span className="border-l border-ui-stroke pl-3 text-ui-secondary">Logs preview</span><span className="ml-auto text-caption text-ui-muted">Fictional data</span><IconButton label={theme === "dark" ? "Use light theme" : "Use dark theme"} icon={theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />} onClick={toggleTheme} /></header>
    <div className="grid min-h-0 flex-1 grid-cols-[11rem_14rem_minmax(0,1fr)] max-xl:grid-cols-[9rem_11rem_minmax(0,1fr)] gap-3 p-3">
      <aside className="rounded-lg border border-ui-stroke bg-ui-panel p-3"><h2 className="mb-4 mt-0 text-caption font-semibold text-ui-muted">Operations</h2><div className="rounded-md bg-ui-table px-2.5 py-2 text-control font-semibold">Separations</div></aside>
      <aside className="rounded-lg border border-ui-stroke bg-ui-panel p-3"><h2 className="mb-4 mt-0 text-caption font-semibold text-ui-muted">Preview scenarios</h2><div className="flex flex-col gap-2">{previewScenarios.map(item => <Button key={item.id} variant="ghost" className={cn("h-auto! w-full! flex-col! items-start! gap-2! rounded-md! border! px-3! py-3! text-left!", item.id === scenarioId ? "border-ui-stroke-control! bg-ui-table!" : "border-ui-stroke! bg-ui-panel!")} aria-pressed={item.id === scenarioId} onClick={() => setScenarioId(item.id)}><span className="text-control font-semibold">{item.label}</span><span className="text-body font-normal text-ui-secondary">{item.subject}</span><span className={cn("text-caption font-medium", item.status === "Completed" ? "text-ui-positive" : "text-ui-muted")}>{item.status}</span></Button>)}</div></aside>
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel" aria-label="Selected run"><header className="flex min-h-11 shrink-0 items-center justify-between gap-4 border-b border-ui-stroke px-4"><h1 className="m-0 text-control font-semibold">Separations · {scenario.subject}</h1><span className="text-caption text-ui-muted">{scenario.status}</span></header><div className="flex h-10 shrink-0 items-center border-b border-ui-stroke px-4"><span className="inline-flex h-full items-center gap-1.5 border-b-2 border-ui-primary text-body font-semibold"><ScrollText aria-hidden className="size-3.5" />Logs</span></div><LogFeed key={scenario.id} steps={scenario.steps} /></section>
    </div>
  </main>;
}
