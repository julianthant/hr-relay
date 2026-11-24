/** Planted violations that prove each state rule bites, on the dashboard's real primitives. Never part of the catalogue. */
import { useEffect, useState } from "react";
import {
  ActionBar, ActionBarRow, Button, Dialog, DialogBody, DialogContent, DialogFooter, IconButton, SegmentedChoice, Skeleton, Switch, Tab, TabList, TabPanel, Tabs, useToasts,
} from "../../../../../../src/dashboard/ds/ui.js";
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

function ToastOverToolbar() {
  const { toast } = useToasts();
  // After the provider's own effects: it starts listening for toasts once it has mounted.
  useEffect(() => {
    const timer = window.setTimeout(() => { toast({ tone: "danger", sticky: true, title: "Run unavailable", description: "This run is no longer in the queue." }); }, 0);
    return () => { window.clearTimeout(timer); };
  }, [toast]);
  return <div className="fixed inset-x-0" style={{ bottom: "calc(var(--ds-toast-inset-bottom) - 1rem)" }}><ActionBar><ActionBarRow label="Queue actions"><Button>Start run</Button></ActionBarRow></ActionBar></div>;
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
      </StoryFrame>,
    },
    finds: { "fits-viewport": [/"a long line of text that cannot fit its box" is cut off sideways by its container/u, /^(?![\s\S]*"a short line")/u] },
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
  "toast-over-toolbar": {
    story: { title: "A toast over the queue toolbar", ready: "[data-ds-toast-state]", render: () => <StoryFrame><ToastOverToolbar /></StoryFrame> },
    finds: { "toast-text-only": [/covers the toolbar "Queue actions"/u] },
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
});
