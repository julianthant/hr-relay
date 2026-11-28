/** Planted violations that prove each state rule bites, on the dashboard's real primitives. Never part of the catalogue. */
import { useEffect, useState } from "react";
import {
  Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, IconButton, PageHeading, SegmentedChoice, Skeleton, Switch, Tab, TabList, TabPanel, Tabs, useToasts,
} from "../../../../../../src/dashboard/ds/ui.js";
import { SessionsView } from "../../../../../../src/dashboard/surfaces/sessions/sessions-view.js";
import type { StateRuleName } from "../state-rule-limits.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

export interface RuleProbe {
  readonly story: Story;
  readonly atBothDesktopWidths?: true;
  /** What each rule must report on this story. */
  readonly finds: Readonly<Partial<Record<StateRuleName, readonly RegExp[]>>>;
  /** Rules that must report nothing on this story. */
  readonly clean?: readonly StateRuleName[];
}

/** The Sessions panel open, with the toast viewport pushed off centre and down onto it. */
function ToastOverSessions() {
  const { toast } = useToasts();
  useEffect(() => {
    const timer = window.setTimeout(() => { toast({ tone: "success", sticky: true, title: "Workers added" }); }, 0);
    return () => { window.clearTimeout(timer); };
  }, [toast]);
  return <>
    <style>{'[data-slot="toast-viewport"] { top: auto !important; bottom: 24px !important; left: 25% !important; }'}</style>
    <SessionsView data={{ state: "ready", workers: [] }} open onOpenChange={() => undefined} onControl={() => undefined} workflows={[]} />
  </>;
}

/** The Sessions bar collapsed, with a centred toast inside the window that hangs lower than its place. */
function ToastBelowTop() {
  const { toast } = useToasts();
  useEffect(() => {
    const timer = window.setTimeout(() => { toast({ tone: "success", sticky: true, title: "Workers added" }); }, 0);
    return () => { window.clearTimeout(timer); };
  }, [toast]);
  return <>
    <style>{'[data-slot="toast-viewport"] { top: 66px !important; }'}</style>
    <SessionsView data={{ state: "ready", workers: [] }} open={false} onOpenChange={() => undefined} onControl={() => undefined} workflows={[]} />
  </>;
}

/** The Sessions panel open and, at the left edge clear of the toasts, a button that raises one more toast per press. */
function RaiseToasts() {
  const { toast } = useToasts();
  const [raised, setRaised] = useState(0);
  return <>
    <div><Button onClick={() => { toast({ tone: "success", sticky: true, title: `Result ${String(raised + 1)}` }); setRaised(raised + 1); }}>Raise toast</Button></div>
    <SessionsView data={{ state: "ready", workers: [] }} open onOpenChange={() => undefined} onControl={() => undefined} workflows={[]} />
  </>;
}

/** Starts a request after first paint; it answers 404 and then the text changes. */
function LateFailure() {
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => { void fetch("/missing-slow-state").finally(() => { setAnswered(true); }); }, 600);
    return () => { window.clearTimeout(timer); };
  }, []);
  return <section aria-label="Runs">{answered ? <p id="answered">Loaded</p> : <p>Loading</p>}</section>;
}

const TEN_WORDS = "One two three four five six seven eight nine ten";
const TWENTY_FIVE_WORDS = `${TEN_WORDS} eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five`;

export const RULE_PROBES = {
  "open-dialog": {
    story: {
      title: "A real dialog, in its portal, breaking six rules",
      ready: '[role="dialog"]',
      render: () => <StoryFrame><Dialog open><DialogContent title={TEN_WORDS} description={TWENTY_FIVE_WORDS} size="sm">
        <DialogBody>
          <p>Check outcome</p>
          <div style={{ width: 60, overflow: "hidden", whiteSpace: "nowrap" }}>a long line of text that cannot fit</div>
          <select aria-label="Pick" disabled />
          <button type="button"><svg width="12" height="12" /></button>
        </DialogBody>
        <DialogFooter><Button variant="primary" style={{ background: "rgb(200, 30, 30)" }}>Save</Button></DialogFooter>
      </DialogContent></Dialog></StoryFrame>,
    },
    finds: {
      "no-banned-text": [/"Check outcome" in "Check outcome"/u],
      "word-limits": [/the title "One two .*" has 10 words/u, /the description "One two .*" has 25 words/u],
      "fits-viewport": [/"a long line of text that cannot fit" is cut off sideways/u],
      "no-dead-disabled-control": [/the picker "Pick" is shown switched off/u],
      "named-and-focusable": [/<button class=""> has no name/u],
      "primary-button-accent": [/the button "Save" is filled rgb\(200, 30, 30\), not the accent/u],
    },
    clean: ["dialogs-share-shape"],
  },
  "primary-without-accent": {
    story: {
      title: "Primary buttons that lost the accent",
      render: () => <StoryFrame>
        <Button variant="primary" style={{ background: "transparent" }}>Run</Button>
        <Button variant="primary" style={{ background: "rgb(40, 40, 44)" }}>Start</Button>
      </StoryFrame>,
    },
    finds: { "primary-button-accent": [/the button "Run" has no solid fill/u, /the button "Start" is filled rgb\(40, 40, 44\)/u] },
  },
  "checkbox-accents": {
    story: {
      title: "Checkbox state uses the form palette",
      render: () => <StoryFrame><Checkbox label="People" checked /><Checkbox label="Archive" checked={false} /></StoryFrame>,
    },
    finds: {},
    clean: ["primary-button-accent"],
  },
  "unreachable-controls": {
    story: {
      title: "A hidden name and a button Tab skips",
      render: () => <StoryFrame>
        <button type="button"><span hidden>Hidden name</span><svg width="12" height="12" /></button>
        <button type="button" tabIndex={-1}>Skipped</button>
        <Button>Reached</Button>
      </StoryFrame>,
    },
    finds: { "named-and-focusable": [/has no name/u, /"Skipped" cannot be reached with the keyboard/u, /^(?![\s\S]*"Reached")/u] },
  },
  "tab-drops-focus": {
    story: {
      title: "Tab drops focus before the last two controls",
      render: () => <StoryFrame>
        <Button>Before drop</Button>
        <Button onKeyDown={event => {
          if (event.key !== "Tab") return;
          event.preventDefault();
          event.currentTarget.blur();
        }}>Drops focus</Button>
        <Button>After drop</Button>
        <Button>Last control</Button>
      </StoryFrame>,
    },
    atBothDesktopWidths: true,
    finds: { "named-and-focusable": [
      /"After drop" cannot be reached with the keyboard/u,
      /"Last control" cannot be reached with the keyboard/u,
      /^(?![\s\S]*"(?:Before drop|Drops focus)")/u,
    ] },
  },
  "hidden-radios-and-toolbar": {
    story: {
      title: "Radios drawn by their labels, and a toolbar button no key reaches",
      render: () => <StoryFrame>
        <SegmentedChoice label="View" value="list" options={[{ value: "list", label: "List" }, { value: "board", label: "Board" }]} onChange={() => undefined} />
        <fieldset><legend>Plain</legend>
          <label><input type="radio" name="plain" className="sr-only" defaultChecked /><span>Left</span></label>
          <label><input type="radio" name="plain" className="sr-only" /><span>Right</span></label>
        </fieldset>
        <div role="toolbar" aria-label="PDF controls">
          <IconButton variant="ghost" label="Zoom out" icon={<svg aria-hidden width="12" height="12" />} />
          <button type="button" tabIndex={-1} aria-label="Zoom in"><svg aria-hidden width="12" height="12" /></button>
        </div>
      </StoryFrame>,
    },
    finds: {
      "named-and-focusable": [
        /"Left" shows no focus ring/u, /"Right" shows no focus ring/u, /"Zoom in" cannot be reached with the keyboard/u,
        /^(?![\s\S]*"(?:List|Board|Zoom out)")/u,
      ],
    },
  },
  "tab-list-hands-over-its-stop": {
    story: {
      title: "A tab list whose active tab takes the stop, and two that cannot",
      render: () => <StoryFrame>
        <Tabs value="one" onValueChange={() => undefined}>
          <TabList label="Steps"><Tab value="one">One</Tab><Tab value="two">Two</Tab></TabList>
          <TabPanel value="one">First</TabPanel>
        </Tabs>
        <div role="tablist" aria-label="Frozen" tabIndex={0}><button type="button" role="tab" aria-selected="true" tabIndex={-1}>Frozen tab</button></div>
        <div role="tablist" aria-label="Nameless" tabIndex={0}><button type="button" role="tab" aria-selected="true"><svg aria-hidden width="12" height="12" /></button></div>
      </StoryFrame>,
    },
    finds: { "named-and-focusable": [/"Frozen tab" cannot be reached with the keyboard/u, /has no name/u, /^(?![\s\S]*"(?:Steps|One|Two)" cannot)/u] },
  },
  "menu-popup-hands-over-its-stop": {
    story: {
      title: "A menu whose item takes the stop, and one with no enabled item",
      render: () => <StoryFrame>
        <div role="menu" aria-label="Held actions" tabIndex={-1}><div role="menuitem" tabIndex={-1}>Stuck item</div></div>
        <div role="menu" aria-label="Empty actions" tabIndex={-1}><div role="menuitem" aria-disabled="true" tabIndex={-1}>Unavailable</div></div>
      </StoryFrame>,
    },
    finds: { "named-and-focusable": [/"Stuck item" cannot be reached with the keyboard/u, /"Empty actions" cannot be reached with the keyboard/u, /^(?![\s\S]*"Held actions")/u] },
  },
  "switch-ring-on-its-control": {
    story: {
      title: "A switch that rings its control, and an invisible input that rings nothing",
      render: () => <StoryFrame>
        <Switch label="Dry run" checked={false} onCheckedChange={() => undefined} />
        <label><input type="checkbox" style={{ opacity: 0 }} /><span>Plain</span></label>
      </StoryFrame>,
    },
    finds: { "named-and-focusable": [/"Plain" shows no focus ring/u, /^(?![\s\S]*"Dry run")/u] },
  },
  "nested-clip": {
    story: {
      title: "Text cut off by a container its own box fits",
      render: () => <StoryFrame>
        <div style={{ width: 120, overflow: "hidden" }}><div style={{ width: 120, whiteSpace: "nowrap" }}>a long line of text that cannot fit its box</div></div>
        <div style={{ width: 400, overflow: "hidden" }}><div style={{ width: 400, whiteSpace: "nowrap" }}>a short line</div></div>
        <div role="group" aria-label="Row" tabIndex={0} style={{ width: 120, overflowX: "auto" }}><div style={{ paddingLeft: 2000, whiteSpace: "nowrap" }}>a line the keyboard can scroll to</div></div>
        <div style={{ width: 120, overflowX: "auto" }}><div style={{ paddingLeft: 2000, whiteSpace: "nowrap" }}>a line no key scrolls to</div></div>
      </StoryFrame>,
    },
    finds: { "fits-viewport": [/"a long line of text that cannot fit its box" is cut off sideways by its container/u, /"a line no key scrolls to" runs \d+px past the right edge/u, /^(?![\s\S]*(?:"a short line"|"a line the keyboard))/u] },
  },
  "ellipsis-without-full-text": {
    story: {
      title: "A truncated label with no full text, beside one a tooltip trigger names, and a label that wraps",
      render: () => <StoryFrame>
        <div style={{ width: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>a label cut with nothing to read it in full</div>
        <div style={{ width: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title="a label whose title carries it in full">a label whose title carries it in full</div>
        <div style={{ width: 120 }}><span data-one-line>a label that wraps onto two lines</span></div>
      </StoryFrame>,
    },
    finds: { "fits-viewport": [/"a label cut with nothing to read it in full" is cut off sideways/u, /takes \d+ lines; it must stay on one line/u, /^(?![\s\S]*"a label whose title)/u] },
  },
  "dialog-off-shape": {
    story: {
      title: "A dialog with its own body padding and bottom edge",
      ready: '[role="dialog"]',
      render: () => <StoryFrame><Dialog open><DialogContent title="Rerun" size="sm" className="border-b-4">
        <DialogBody className="px-0 py-0"><p>Body</p></DialogBody>
        <DialogFooter><Button>Close</Button></DialogFooter>
      </DialogContent></Dialog></StoryFrame>,
    },
    finds: { "dialogs-share-shape": [/a dialog:sm dialog has body padding 0px; the design system draws it with /u, /a dialog:sm dialog has bottom border 4px /u, /^(?![\s\S]*(?:header|footer) padding)/u] },
  },
  "label-under-title": {
    story: { title: "A queue card whose labels wrap under the title", render: () => <StoryFrame>
      <div data-queue-body className="flex flex-col"><span data-demo-row-title>Ana Example</span><div data-queue-labels>Waiting</div></div>
    </StoryFrame> },
    finds: { "status-label-on-title-line": [/the labels of "Ana Example" sit under the title/u] },
    atBothDesktopWidths: true,
  },
  "label-on-title-line": {
    story: { title: "A queue card whose labels sit on the title's line", render: () => <StoryFrame>
      <div data-queue-body className="flex items-center"><span data-demo-row-title className="min-w-0 flex-1 truncate">Ana Example</span><div data-queue-labels>Waiting</div></div>
    </StoryFrame> },
    finds: {},
    clean: ["status-label-on-title-line"],
  },
  "page-title-27": {
    story: { title: "A page title larger than 20px", render: () => <StoryFrame>
      <PageHeading title="General" className="[&_h1]:!text-[27px]" />
    </StoryFrame> },
    finds: { "page-title-20px": [/the page title "General" is 27px, not 20px/u] },
  },
  "page-title-20": {
    story: { title: "A page title at 20px", render: () => <StoryFrame><PageHeading title="General" /></StoryFrame> },
    finds: {},
    clean: ["page-title-20px"],
  },
  "toast-over-sessions": {
    story: { title: "A toast off centre and over the Sessions panel", ready: "[data-ds-toast-state]", render: () => <StoryFrame><ToastOverSessions /></StoryFrame> },
    finds: { "toast-placement": [/is \d+px off the horizontal centre/u, /overlaps the Sessions panel/u, /runs outside the window/u] },
  },
  "toast-below-top": {
    story: { title: "A centred toast clear of the Sessions bar, lower than its place", ready: "[data-ds-toast-state]", render: () => <StoryFrame><ToastBelowTop /></StoryFrame> },
    finds: { "toast-placement": [/the toast viewport sits 66px .* not 12px/u, /the front toast sits 66px .* not 12px/u, /^(?![\s\S]*(?:horizontal centre|overlaps|outside))/u] },
  },
  "picker-beside-a-request": {
    story: {
      title: "A picker switched off beside a control that waits on its own request",
      render: () => <StoryFrame>
        <ul><li aria-busy>Starting</li></ul>
        <Button aria-haspopup="dialog" disabled aria-busy>Add workers</Button>
        <Button aria-haspopup="menu" disabled>Workflow</Button>
      </StoryFrame>,
    },
    finds: { "no-dead-disabled-control": [/the picker "Workflow" is shown switched off/u, /^(?![\s\S]*"Add workers")/u] },
  },
  "dimmed-with-a-reason": {
    story: {
      title: "A dimmed Add workers that says why beside dimmed controls that do not, and settled beside locked boxes",
      render: () => <StoryFrame>
        <span data-state="closed" aria-label="Sessions are out of date" tabIndex={0}><Button aria-haspopup="dialog" disabled>Add workers</Button></span>
        <Button aria-haspopup="dialog" disabled>Add people</Button>
        <span data-state="closed" aria-label="A dimmed picker whose label repeats its own long name for the tooltip"><Button aria-haspopup="dialog" disabled aria-label="A dimmed picker whose label repeats its own long name for the tooltip">A dimmed picker whose label repeats its own long name for the tooltip</Button></span>
        <section data-settled><div role="group" aria-label="Settled record"><input type="checkbox" aria-label="Include" checked readOnly disabled /></div></section>
        <section><div role="group" aria-label="Locked record"><input type="checkbox" aria-label="Include locked" checked readOnly disabled /></div></section>
        <section data-settled><div role="group" aria-label="Open record"><input type="checkbox" aria-label="Include again" disabled /></div></section>
      </StoryFrame>,
    },
    finds: { "no-dead-disabled-control": [/the picker "Add people" is shown switched off/u, /the picker "A dimmed picker whose label repeats its/u, /every choice in "Locked record" is switched off/u, /every choice in "Open record" is switched off/u, /^(?![\s\S]*(?:"Add workers"|Settled record))/u] },
  },
  "toast-with-a-button": {
    story: { title: "A toast that holds a button", ready: "[data-ds-toast-state]", render: () => <StoryFrame><div data-ds-toast-state="full">Run deleted<Button>Undo</Button></div></StoryFrame> },
    finds: { "toast-text-only": [/the toast "Run deleted\s*Undo" holds 1 control or image/u] },
  },
  "slow-fetch": {
    story: {
      title: "A skeleton held in its fetching region",
      ready: '#fetching [data-slot="skeleton"]',
      slowFetch: { region: "#fetching" },
      render: () => <StoryFrame><section id="fetching" aria-label="Runs"><Skeleton /></section></StoryFrame>,
    },
    finds: {},
    clean: ["skeleton-only-while-fetching"],
  },
  "skeleton-outside-region": {
    story: {
      title: "A skeleton outside the fetching region",
      ready: '#elsewhere [data-slot="skeleton"]',
      slowFetch: { region: "#fetching" },
      render: () => <StoryFrame><section id="fetching" aria-label="Runs"><Skeleton /></section><section id="elsewhere" aria-label="People"><Skeleton /></section></StoryFrame>,
    },
    finds: { "skeleton-only-while-fetching": [/1 skeleton shown outside the fetching region #fetching/u] },
  },
  "skeleton-without-slow-fetch": {
    story: {
      title: "A skeleton in a story that is not a slow fetch",
      ready: '[data-slot="skeleton"]',
      render: () => <StoryFrame><section aria-label="Runs"><Skeleton /></section></StoryFrame>,
    },
    finds: { "skeleton-only-while-fetching": [/1 skeleton shown in a story that is not marked as a slow fetch/u] },
  },
  "late-failure": {
    story: { title: "A request that fails after first paint", settled: "#answered", render: () => <StoryFrame><LateFailure /></StoryFrame> },
    finds: { "declared-diagnostics": [/http 404: GET .*\/missing-slow-state/u] },
  },
} satisfies Record<string, RuleProbe>;

export const RULE_PROBE_ENTRIES = defineSurface("probe", {
  rule: Object.fromEntries(Object.entries(RULE_PROBES).map(([name, probe]) => [name, probe.story])),
  motion: { toast: { title: "Toasts raised by a button over the open Sessions panel, with motion on", render: () => <StoryFrame animated><RaiseToasts /></StoryFrame> } },
});
