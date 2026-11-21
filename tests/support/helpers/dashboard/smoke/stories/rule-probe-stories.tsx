/** Planted violations that prove each state rule bites, on the dashboard's real primitives. Never part of the catalogue. */
import { useEffect, useState } from "react";
import {
  ActionBar, ActionBarRow, Button, Dialog, DialogBody, DialogContent, DialogFooter, Skeleton, useToasts,
} from "../../../../../../src/dashboard/ds/ui.js";
import type { StateRuleName } from "../state-rule-limits.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

export interface RuleProbe {
  readonly story: Story;
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
  return <div className="fixed inset-x-0 top-0"><ActionBar><ActionBarRow label="Queue actions"><Button>Start run</Button></ActionBarRow></ActionBar></div>;
}

/** Shows its skeleton until a late request settles, then drops it; the request answers 404. */
function SlowFetch() {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => { void fetch("/missing-slow-state").finally(() => { setLoading(false); }); }, 600);
    return () => { window.clearTimeout(timer); };
  }, []);
  return <section id="fetching" aria-label="Runs">{loading ? <Skeleton /> : <p>Loaded</p>}</section>;
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
    finds: { "named-and-focusable": [/has no name/u, /"Skipped" cannot be reached with Tab/u, /^(?![\s\S]*"Reached")/u] },
  },
  "toast-over-toolbar": {
    story: { title: "A toast over the queue toolbar", ready: "[data-ds-toast-state]", render: () => <StoryFrame><ToastOverToolbar /></StoryFrame> },
    finds: { "toast-text-only": [/covers the toolbar "Queue actions"/u] },
  },
  "slow-fetch": {
    story: {
      title: "A skeleton that goes when a failing request settles",
      ready: '#fetching [data-slot="skeleton"]',
      settled: "#fetching p",
      slowFetch: { region: "#fetching" },
      render: () => <StoryFrame><SlowFetch /></StoryFrame>,
    },
    finds: { "declared-diagnostics": [/http 404: GET .*\/missing-slow-state/u] },
    clean: ["skeleton-only-while-fetching"],
  },
} satisfies Record<string, RuleProbe>;

export const RULE_PROBE_ENTRIES = defineSurface("probe", {
  rule: Object.fromEntries(Object.entries(RULE_PROBES).map(([name, probe]) => [name, probe.story])),
});
