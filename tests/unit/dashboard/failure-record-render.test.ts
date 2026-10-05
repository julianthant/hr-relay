// @vitest-environment jsdom
/** D360 primary layout plus retained D273 diagnostic and Archive behavior. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, it } from "vitest";
import {
  FailureDetailWireSchema,
  type FailureDetailWire,
} from "../../../src/domain/dashboard/run-detail.js";
import { wireResourceSchema } from "../../../src/domain/dashboard/primitives.js";
import { FailureDetailBody } from "../../../src/dashboard/surfaces/shared/run-evidence/trust.js";
import { InlineFailureRecord } from "../../../src/dashboard/surfaces/run-detail/failure/receipt-failure.js";
import { LogsTab } from "../../../src/dashboard/surfaces/run-detail/logs.js";
import { CAPTURE_BUNDLE_A, CAPTURE_BUNDLE_B, captureDetail, captureImage } from "./fixtures/run-captures-app-fixture.js";
import { ArchivedFailureCard } from "../../../src/dashboard/surfaces/archive/archive.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const SUMMARY = "The CRM record named a different person than the one this run was started for.";

/** The run-detail `failure` section's own arm, composed from the wire's own combinator. */
const FailureSectionSchema = wireResourceSchema(FailureDetailWireSchema);

/**
 * A client that answers NOTHING and throws by name if the body reaches for it.
 *
 * Every case here is a resting render or a disclosure press — neither touches
 * the BFF — so a reach for the client is a defect this file wants to hear about
 * rather than absorb.
 */
function refusingClient(): DashboardClient {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, property): unknown {
      throw new Error(`the failure record reached for client.${String(property)} without a press`);
    },
  };
  return new Proxy({}, handler) as unknown as DashboardClient;
}

/**
 * Parsed through the REAL wire schema, so a fixture that drifted off the
 * contract fails here instead of rendering a shape the server cannot serve.
 */
function failureDetail(overrides: Record<string, unknown> = {}): FailureDetailWire {
  return FailureDetailWireSchema.parse({
    runId: "11111111-1111-4111-8111-111111111111",
    failureId: "22222222-2222-4222-8222-222222222222",
    traceId: "pl-141500-a3c1",
    attempt: 2,
    workflowId: "person-lookup",
    nodeId: "cross-verify",
    taskId: "crm/read-onboarding-record",
    fingerprint: "e".repeat(64),
    code: "SUBJECT_MISMATCH",
    summary: SUMMARY,
    transient: false,
    writeState: "not-attempted",
    subject: {
      state: "present",
      expected: { kind: "eid", digest: "1".repeat(64), displayRedacted: "••••5001" },
      observed: { kind: "eid", digest: "2".repeat(64), displayRedacted: "••••4136" },
    },
    page: {
      screen: "crm.onboarding",
      state: "crm.onboarding.record-ready",
      urlRedacted: "https://crm.example/onboarding/[redacted]",
      titleRedacted: "Onboarding record",
    },
    action: { operation: "read", sequence: 3 },
    causeChain: [{
      code: "SUBJECT_MISMATCH",
      summary: "the observed EID did not match the fenced subject",
      role: "primary",
      transient: false,
    }],
    remediation: [{
      kind: "operator-action",
      message: "Confirm which EID is correct at the source before re-running; nothing was written.",
    }],
    sameFingerprintSeen: 1,
    diagnosticBundle: { state: "absent", reason: "no bundle was captured for this failure" },
    occurredAt: "2026-08-25T14:15:00.000Z",
    ...overrides,
  });
}

function renderBody(detail: FailureDetailWire): string {
  return renderToStaticMarkup(
    createElement(DashboardClientProvider, {
      client: refusingClient(),
      children: createElement(FailureDetailBody, { detail }),
    }),
  );
}

/* ── the palette, read from the file that owns it ────────────────────────── */

/*
  Resolved from the vitest root rather than from `import.meta.url`: this file
  declares the `jsdom` environment, where `import.meta.url` is an http URL and
  `fileURLToPath` refuses it. `readFileSync` fails loud if the root ever moves.
*/
const TOKENS_CSS = readFileSync(resolve(process.cwd(), "src/dashboard/ds/theme/tokens.css"), "utf8");

/**
 * The two themes that carry real colour values.
 *
 * The base `:root` block is structural — it aliases `--warning` / `--success`,
 * which only the theme blocks declare — so a "value" read there is the alias
 * text, not a colour.
 */
const THEMES = ["dark", "light"] as const;
type Theme = (typeof THEMES)[number] | "root";

const THEME_SELECTOR: Record<Theme, string> = {
  root: ":root {",
  dark: '[data-demo-theme="dark"],',
  light: '[data-demo-theme="light"],',
};

function themeBlock(theme: Theme): string {
  const start = TOKENS_CSS.indexOf(`\n${THEME_SELECTOR[theme]}`);
  if (start < 0) throw new Error(`ds/tokens.css declares no ${theme} block`);
  const end = TOKENS_CSS.indexOf("\n}", start);
  if (end < 0) throw new Error(`ds/tokens.css never closes its ${theme} block`);
  return TOKENS_CSS.slice(start, end);
}

function declaration(block: string, name: string): string | undefined {
  const match = new RegExp(`--${name}:\\s*([^;]+);`, "u").exec(block);
  return match === null ? undefined : match[1].trim();
}

/** The colour `--{name}` paints in `theme`, following one `var()` alias at a time. */
function tokenValue(theme: Theme, name: string): string {
  const block = themeBlock(theme);
  const first = declaration(block, name) ?? declaration(themeBlock("root"), name);
  if (first === undefined) throw new Error(`ds/tokens.css declares no --${name} in the ${theme} theme`);
  let value: string = first;
  for (let hop = 0; hop < 4 && value.startsWith("var(--"); hop += 1) {
    const alias = value.slice("var(--".length, value.indexOf(")"));
    const resolved: string | undefined = declaration(block, alias) ?? declaration(themeBlock("root"), alias);
    if (resolved === undefined) {
      throw new Error(`ds/tokens.css leaves --${name} pointing at an undeclared --${alias} in ${theme}`);
    }
    value = resolved;
  }
  if (value.startsWith("var(")) throw new Error(`--${name} never resolves to a colour in ${theme}`);
  return value;
}

/** The `--ds-*` token the write-state sentence is painted with. */
function writeStateToneToken(html: string): string {
  const paragraph = /What this run left behind<\/div><p class="([^"]*)"/u.exec(html);
  assert.ok(paragraph !== null, "the write-state sentence did not render under its own label");
  // The COLOUR token specifically — the paragraph's class list also names
  // spacing tokens, and reading the first `--ds-*` it finds would compare every
  // arm's `--ds-space-hair` and call three tones distinct.
  const token = /text-\[color:var\(--(ds-[a-z0-9-]+)\)\]/u.exec(paragraph[1]);
  assert.ok(token !== null, `the write-state sentence carries no ds token: ${paragraph[1]}`);
  return token[1];
}

/** The sentence itself — the channel that survives two arms sharing one colour. */
function writeStateSentence(html: string): string {
  const paragraph = /What this run left behind<\/div><p class="[^"]*">([^<]*)</u.exec(html);
  assert.ok(paragraph !== null, "the write-state sentence did not render under its own label");
  return paragraph[1];
}

let mountedRoot: Root | undefined;

afterEach(async () => {
  const root = mountedRoot;
  mountedRoot = undefined;
  if (root !== undefined) {
    await act(async () => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
});

/** Mounts the real body and presses its disclosure — `renderToStaticMarkup` cannot press. */
async function mountOpenRecord(detail: FailureDetailWire): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoot = root;
  await act(async () => {
    root.render(createElement(DashboardClientProvider, {
      client: refusingClient(),
      children: createElement(FailureDetailBody, { detail }),
    }));
  });
  const toggle = host.querySelector<HTMLButtonElement>("[data-panel-failure-toggle]");
  assert.ok(toggle !== null, "the disclosure trigger did not render");
  await act(async () => {
    toggle.click();
  });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  return host;
}

/** The archive's own failure card — the record's SECOND consumer. */
function renderArchivedCard(detail: FailureDetailWire): string {
  return renderToStaticMarkup(
    createElement(DashboardClientProvider, {
      client: refusingClient(),
      children: createElement(ArchivedFailureCard, { failure: detail }),
    }),
  );
}

function renderRecord(failure: Record<string, unknown>): string {
  return renderToStaticMarkup(
    createElement(DashboardClientProvider, {
      client: refusingClient(),
      children: createElement(InlineFailureRecord, {
        failure: FailureSectionSchema.parse(failure),
        errorNotes: [],
        runId: "11111111-1111-4111-8111-111111111111",
        aiAdvisory: { state: "unavailable", code: "not-configured", reason: "no advisory is configured" },
      }),
    }),
  );
}

/* ── the head says the FACT, not the category (E2/E4/E5/E6) ──────────────── */

describe("the failure record's head (E2/E4/E5/E6)", () => {
  it("leads with a concise classification and preserves the recorded facts in Details", () => {
    const html = renderRecord({ state: "available", value: failureDetail() });

    // E4: the constant `This run failed` said what the status pill, the outcome
    // bar and the danger tint had all already said, while the ONE sentence this
    // run wrote about itself waited a line below in body copy.
    assert.ok(html.includes(SUMMARY), "the head does not say the run's own summary");
    assert.ok(!html.includes("This run failed"), "the head still leads with the category");
    // E5/E6, both in the head, both beside the summary.
    assert.match(html, /code<\/span><span[^>]*>SUBJECT_MISMATCH/u);
    assert.ok(html.includes("permanent — the same input will fail again"));
    assert.ok(!html.includes("transient — a later attempt may differ"));
    // E2: the anchor's accessible name is the record's own sentence.
    assert.ok(html.includes(`aria-label="Failure record — Employee identity mismatch"`));
  });

  it("says the OPPOSITE permanence when the wire says transient", () => {
    const html = renderRecord({ state: "available", value: failureDetail({ transient: true }) });
    assert.ok(html.includes("transient — a later attempt may differ"));
    assert.ok(!html.includes("permanent — the same input will fail again"));
  });

  it("keeps the category arm for the record the wire could NOT serve", () => {
    // The one place `This run failed` is still the whole of what is known. It
    // must NOT grow a code, a permanence chip or a borrowed summary — that
    // would be the surface authoring a record the projection refused.
    const html = renderRecord({ state: "missing", reason: "the failure record was never projected" });
    assert.ok(html.includes("Failure details unavailable"));
    assert.ok(html.includes("the failure record was never projected"));
    assert.ok(html.includes('aria-label="Failure record — Failure details unavailable"'));
    assert.ok(!html.includes("permanent"), "an unserved record grew a permanence claim");
    assert.ok(!html.includes("transient"), "an unserved record grew a permanence claim");
    assert.ok(html.includes("Write state unavailable"));
    assert.ok(!html.includes("No write attempted"), "an unserved record grew a write state");
  });
});

/* ── the record's SECOND consumer: the archive's own card (finding 1) ────── */

describe("the archived failure card (unit F8c finding 1)", () => {
  /*
    The head facts moved into `InlineFailureRecord`'s JSX at F8b and the
    archive's card — which renders `FailureDetailBody` and nothing above it —
    silently lost all three. An archived failed run then printed its write
    state, its remediation and its diagnosis under a bare `Failure record`
    label, with the run's OWN sentence, its code and its permanence nowhere on
    the surface. Nothing failed: the card is grammatical without them.
  */
  it("says the run's own summary, its code and its permanence — the same head the live record leads with", () => {
    const html = renderArchivedCard(failureDetail());

    assert.ok(html.includes(SUMMARY), "the archived card does not say the run's own summary");
    assert.match(html, /code<\/span><span[^>]*>SUBJECT_MISMATCH/u);
    assert.ok(
      html.includes("permanent — the same input will fail again"),
      "the archived card does not say whether a retry can differ",
    );
    // The body it has always drawn is untouched — this is a head, not a rewrite.
    assert.ok(html.includes("What this run left behind"));
    assert.ok(html.includes("What is safe to retry"));
  });

  it("states the OPPOSITE permanence when the wire says transient", () => {
    // The negative control: a head hard-coded to one arm would pass the case
    // above and be wrong on every transient failure in the archive.
    const html = renderArchivedCard(failureDetail({ transient: true }));
    assert.ok(html.includes("transient — a later attempt may differ"));
    assert.ok(!html.includes("permanent — the same input will fail again"));
  });
});

/* ── the record's semantics (findings 3 and 4) ───────────────────────────── */

describe("the record's accessible structure (unit F8c findings 3/4)", () => {
  /*
    HTML-AAM computes NO accessible name for a generic element, so an
    `aria-label` on a role-less `<div>` names nothing — this bundle's own dated
    lesson (`src/dashboard/CLAUDE.md`, 2026-08-26, the timeline segment), one
    surface later. The record is a focusable container (`tabIndex={-1}`, the
    outcome bar's `Open failure` lands on it), so the name has to survive the
    landing.
  */
  it("gives the record's frame a role, so its aria-label names something", () => {
    const html = renderRecord({ state: "available", value: failureDetail() });
    assert.match(
      html,
      /<div [^>]*role="group"[^>]*aria-label="Failure record — /u,
      "the record's aria-label still sits on a role-less div",
    );
  });

  it("gives the write-state block the same semantics as the sibling it sits beside", () => {
    // `What is safe to retry` is a named `<section>`; `What this run left
    // behind` — the sentence both files call the most important one on a
    // failed run — was an unnamed `<div>` with a caps label inside it.
    const html = renderBody(failureDetail());
    assert.match(
      html,
      /<section aria-label="What this run left behind"/u,
      "the write-state block is weaker than its sibling",
    );
    assert.match(html, /<section aria-label="What is safe to retry"/u);
  });
});

/* ── the head's permanence is a SENTENCE, not a token (finding 5) ────────── */

describe("the permanence reading (unit F8c finding 5)", () => {
  /*
    `Chip`'s own docstring: "if a fact cannot survive truncation it is not a
    chip — put it on the row's `MetaLine`, on its own line, where it can wrap."
    `permanent — the same input will fail again` is a sentence with an em dash;
    inside a `w-fit` clipped token it read `permanent — the same inp…` and
    recovered the cut on `title` alone, which is a fact reachable by pointer
    and by nobody else (the F5b lesson, twice already in this directory).
  */
  it("never clips the permanence sentence, and never hides it on a title", () => {
    for (const html of [
      renderRecord({ state: "available", value: failureDetail() }),
      renderArchivedCard(failureDetail({ transient: true })),
    ]) {
      const root = document.createElement("div");
      root.innerHTML = html;
      const leaves = [...root.querySelectorAll("*")].filter(
        (element) => element.children.length === 0 && /^(permanent|transient) — /u.test(element.textContent),
      );
      assert.equal(leaves.length, 1, `the permanence reading rendered ${String(leaves.length)} times`);

      // Walk the whole chain: a clip on ANY ancestor cuts the sentence, which
      // is how the 44px touch target became 44x24 two units ago.
      const chain: Element[] = [];
      let walk: Element | null = leaves[0] ?? null;
      while (walk !== null && walk !== root) {
        chain.push(walk);
        walk = walk.parentElement;
      }

      for (const node of chain) {
        // `getAttribute`, not `className`: on an SVG element the property is an
        // `SVGAnimatedString` and `.includes` on it is silently always false.
        const classes: string = node.getAttribute("class") ?? "";
        assert.ok(
          !classes.includes("whitespace-nowrap") && !classes.includes("truncate"),
          `the permanence sentence is clipped by \`${classes}\``,
        );
        assert.equal(
          node.getAttribute("title"),
          null,
          "the permanence sentence is recovered on a title, which is a pointer-only fact",
        );
      }
    }
  });

  /*
    The same rule, one fact over (unit F10c). `record <uuid>` was a `Chip`, and
    a `Chip` is `w-fit` and clips — so in the archive's ~400px detail rail it
    read `record aa11bb22-0…` with no `title` at all, which is worse than the
    pointer-only defect above: the id an operator has to quote in a bug report
    was reachable by NOBODY. It rides the head's `MetaLine` now, where it wraps.
  */
  it("never clips the failure record's id, and never hides it on a title", () => {
    const detail = failureDetail();
    for (const html of [
      renderRecord({ state: "available", value: detail }),
      renderArchivedCard(detail),
    ]) {
      const root = document.createElement("div");
      root.innerHTML = html;
      // The DEEPEST element holding it — `MetaLine` wraps each item in a span
      // that also carries the ` · ` separator, so a childless-leaf filter would
      // find nothing and pass for the wrong reason.
      const holding = [...root.querySelectorAll("*")]
        .filter((element) => element.textContent.includes(detail.failureId));
      const leaves = holding.filter(
        (element) => ![...element.children].some((child) => child.textContent.includes(detail.failureId)),
      );
      assert.equal(leaves.length, 1, `the record id rendered ${String(leaves.length)} times`);

      let walk: Element | null = leaves[0] ?? null;
      while (walk !== null && walk !== root) {
        const classes: string = walk.getAttribute("class") ?? "";
        assert.ok(
          !classes.includes("truncate") && !classes.includes("w-fit"),
          `the record id is clipped by \`${classes}\``,
        );
        assert.equal(walk.getAttribute("title"), null, "the record id is recovered on a title alone");
        walk = walk.parentElement;
      }
    }
  });
});

/* ── the disclosure, and what it may not hide (E15) ──────────────────────── */

describe("the diagnostic disclosure (E15)", () => {
  it("hides DIAGNOSIS and nothing else while it is closed", () => {
    const html = renderBody(failureDetail());

    // Behind the press: classification, the cause chain, the fingerprint, the
    // bundle and the fingerprint's history.
    assert.ok(!html.includes("Cause chain"), "the cause chain rendered on a closed record");
    assert.ok(!html.includes("occurred"), "the classification rendered on a closed record");
    assert.ok(!html.includes("pl-141500-a3c1"), "the trace rendered on a closed record");
    assert.ok(!html.includes("crm.onboarding"), "the page state rendered on a closed record");
    assert.ok(!html.includes("First time"), "the fingerprint history rendered on a closed record");
    assert.ok(!html.includes("no diagnostic bundle"), "the bundle arm rendered on a closed record");

    assert.ok(html.includes("expected eid ••••5001"));
    assert.ok(html.includes("observed eid ••••4136"));
    // NEVER behind the press. Both of these are the ruling, not the layout:
    // the write state is the difference between a safe retry and a duplicate
    // termination, and "why can I not just retry this" is a question a hidden
    // control never answers.
    assert.ok(html.includes("What this run left behind"), "the write-state block was hidden");
    assert.ok(
      html.includes("This run wrote nothing — no write was attempted."),
      "the write-state sentence was hidden",
    );
    assert.ok(html.includes("What is safe to retry"), "the remediation section was hidden");
    assert.ok(
      html.includes("Confirm which EID is correct at the source"),
      "the served remediation was hidden",
    );
  });

  it("offers the diagnosis as a real control, not a hover", () => {
    const html = renderBody(failureDetail());
    // A disclosure trigger is a control (the timeline segment's own lesson).
    assert.match(html, /<button[^>]*aria-expanded="false"[^>]*data-panel-failure-toggle=""/u);
    assert.ok(html.includes("Show the diagnostic record"));
    assert.ok(!html.includes("Hide the diagnostic record"));
  });

  it("names the OPPOSITE act once it is open, and reveals the diagnosis", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mountedRoot = root;
    await act(async () => {
      root.render(createElement(DashboardClientProvider, {
        client: refusingClient(),
        children: createElement(FailureDetailBody, { detail: failureDetail() }),
      }));
    });

    const toggle = host.querySelector<HTMLButtonElement>("[data-panel-failure-toggle]");
    assert.ok(toggle !== null, "the disclosure trigger did not render");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.ok(!host.textContent.includes("Cause chain"));

    await act(async () => {
      toggle.click();
    });

    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.ok(toggle.textContent.includes("Hide the diagnostic record"));
    assert.ok(host.textContent.includes("Cause chain"), "the cause chain stayed hidden after the press");
    assert.ok(host.textContent.includes("pl-141500-a3c1"), "the classification stayed hidden after the press");
    assert.ok(
      host.textContent.includes("First time this fingerprint has been seen."),
      "the fingerprint history stayed hidden after the press",
    );
    // Still there — a disclosure that swallows the two unconditional facts on
    // OPEN would pass every closed-state assertion above.
    assert.ok(host.textContent.includes("What this run left behind"));
    assert.ok(host.textContent.includes("What is safe to retry"));
  });

  it("re-hides the diagnosis on a second press", async () => {
    const host = await mountOpenRecord(failureDetail());
    const toggle = host.querySelector<HTMLButtonElement>("[data-panel-failure-toggle]");
    assert.ok(toggle !== null);
    await act(async () => {
      toggle.click();
    });
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.ok(!host.textContent.includes("Cause chain"), "the disclosure is a one-way door");
  });
});

/* ── the write-state block and its tones (E8/E9) ─────────────────────────── */

describe("the write-state block (E8/E9)", () => {
  it("gives the sentence its own labelled, bordered frame", () => {
    const html = renderBody(failureDetail());
    // The label and the sentence must live in ONE box: a SectionLabel loose in
    // the body flow is the drift this row is about.
    assert.match(
      html,
      /border[^"]*"><[^>]*>What this run left behind<\/[^>]*><p[^>]*>This run wrote nothing/u,
    );
  });

  it("colours the six arms by what they left behind, not one weight for all", () => {
    const settled = renderBody(failureDetail({ writeState: "not-attempted" }));
    const parked = renderBody(failureDetail({ writeState: "unknown" }));
    const left = renderBody(failureDetail({ writeState: "committed" }));

    assert.ok(settled.includes("--ds-success-fg"), "a run that wrote nothing did not read as settled");
    // The negative control: if the tone stopped arriving, all three would still
    // be grammatical and only their equality would say so.
    assert.ok(!parked.includes("--ds-success-fg"));
    assert.ok(!left.includes("--ds-success-fg"));
  });

  /*
    A TONE IS A COLOUR, and two tokens that resolve to the same colour are one
    tone wearing two names (unit F8c finding 2).

    `WRITE_STATE_TONE` claimed three: `--ds-success-fg`, `--ds-status-parked-fg`
    and `--ds-status-waiting-fg`. The first is green; the other two are the
    SAME amber in the dark theme and in the light theme — so the vocabulary
    said three and the screen said two, and a reader auditing the map could not
    tell that `unknown` and `left-behind` are indistinguishable to the
    operator. This reads `ds/tokens.css` for the same reason
    `archive-window.test.ts` does: a restated constant is a claim about a file
    somebody else owns, and only that file can settle it.
  */
  it("paints no distinction the palette cannot draw", () => {
    const arms = {
      "not-attempted": renderBody(failureDetail({ writeState: "not-attempted" })),
      unknown: renderBody(failureDetail({ writeState: "unknown" })),
      committed: renderBody(failureDetail({ writeState: "committed" })),
    } as const;

    const byToken = new Map<string, string[]>();
    for (const [state, html] of Object.entries(arms)) {
      const token = writeStateToneToken(html);
      byToken.set(token, [...(byToken.get(token) ?? []), state]);
    }

    // Every DECLARED tone must be a colour of its own, in every theme.
    const tokens = [...byToken.keys()];
    for (const theme of THEMES) {
      const painted = new Map<string, string>();
      for (const token of tokens) {
        const value = tokenValue(theme, token);
        const twin = painted.get(value);
        assert.equal(
          twin,
          undefined,
          `the ${theme} theme paints --${token} and --${String(twin)} the same (${value}), `
            + "so the write-state block claims a tone it cannot draw",
        );
        painted.set(value, token);
      }
    }

    // …and the arms that SHARE a colour are told apart by the sentence, which
    // is the channel that survives the palette budget (D232: one accent and
    // five semantic hues, and every amber one means "a human is involved").
    for (const states of byToken.values()) {
      const sentences = new Set(states.map((state) => writeStateSentence(arms[state as keyof typeof arms])));
      assert.equal(sentences.size, states.length, `${states.join(" and ")} read alike in colour AND in words`);
    }
  });
});

/* ── the classification's tones and arms (E22/E30) ───────────────────────── */

describe("the classification, once disclosed (E5/E6)", () => {
  it("draws `code` ONCE and permanence nowhere — both are head facts now", async () => {
    const host = await mountOpenRecord(failureDetail());
    const text = host.textContent;

    // `code` moved to the head (E5), which `log-panel.tsx` owns. The cause
    // chain's `primary — SUBJECT_MISMATCH` is a DIFFERENT fact that happens to
    // share the string, so the claim is a COUNT: a copy left behind in the
    // classification MetaLine would print the code twice on one record.
    assert.equal(
      text.split("SUBJECT_MISMATCH").length - 1,
      1,
      `the code is drawn more than once in the body: ${text}`,
    );
    // Permanence (E6) has no counterpart in the body at all.
    assert.ok(!text.includes("permanent — the same input"), "permanence is still drawn in the body");
    assert.ok(!text.includes("transient — a later attempt"), "permanence is still drawn in the body");
    // The classification's own facts are still here and unmoved.
    assert.ok(text.includes("occurred"));
    assert.ok(text.includes("attempt 2"));
    assert.ok(text.includes("node cross-verify"));
  });
});

describe("the observed subject reads as the thing that is wrong (E22)", () => {
  it("tones the OBSERVED half in danger and leaves the expected half alone", async () => {
    const host = await mountOpenRecord(failureDetail());

    const observed = host.querySelector<HTMLElement>("span.text-\\[color\\:var\\(--ds-danger\\)\\]");
    assert.ok(observed !== null, "the observed subject carries no danger tone");
    assert.ok(observed.textContent.startsWith("observed eid"), `the danger tone landed on: ${observed.textContent}`);
    // Redaction is unchanged and not re-derived: the served display wins.
    assert.ok(observed.textContent.includes("••••4136"));
    assert.ok(!observed.textContent.includes("2".repeat(64)), "the raw digest leaked past the served display");
    // The expected half is the same fact class and must NOT be shouted at.
    assert.ok(host.textContent.includes("expected eid ••••5001"));
  });
});

/* D: live annotations use durable reads; archived bodies never request a live annotation. */
import { vi } from "vitest";
import { CommandRequestSchema } from "../../../src/domain/commands.js";
import type { RunDetailSectionResponse } from "../../../src/domain/dashboard/run-detail.js";

function annotatedDetail(version = 1, resolved = false): FailureDetailWire {
  const detail = failureDetail();
  return failureDetail({ resolution: { capability: { state: "available" }, capture: {
    runId: detail.runId, failureId: detail.failureId,
    resolution: resolved ? { status: "resolved", version, by: "local-operator", at: detail.occurredAt, note: "Updated page control." }
      : { status: "unresolved", version },
  } } });
}
function failureResponse(detail: FailureDetailWire): RunDetailSectionResponse {
  return { section: "failure", payload: { state: "available", value: detail } };
}
async function mountResolution(client: DashboardClient, detail = annotatedDetail()) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); mountedRoot = root;
  await act(async () => root.render(createElement(DashboardClientProvider, { client,
    children: createElement(FailureDetailBody, { detail, liveContext: { actorId: "local-operator", nowIso: detail.occurredAt } }),
  })));
  return host;
}
function namedButton(host: HTMLElement, name: string) {
  const button = [...host.querySelectorAll("button")].find(candidate => candidate.textContent === name);
  assert.ok(button, `missing button ${name}`); return button;
}

describe("D live failure resolution", () => {
  it("keeps archived/shared rendering read-only while displaying captured status, actor, time and note", () => {
    const html = renderBody(annotatedDetail(2, true));
    assert.match(html, /Resolved/u); assert.match(html, /local-operator/u); assert.match(html, /Updated page control/u);
    assert.doesNotMatch(html, /Mark resolved|>Reopen<|Resolution note \(optional\)/u);
  });
  it("submits exact target/actor/version and waits for durable readback before showing success", async () => {
    let current = annotatedDetail(); let finish: (() => void) | undefined;
    const client = { runSection: async () => failureResponse(current), executeCommand: async (input: unknown) => {
      const command = CommandRequestSchema.parse(input); assert.equal(command.family, "failure-resolution");
      if (command.family !== "failure-resolution") throw new Error("wrong command family");
      assert.deepEqual(command.target, { runId: current.runId, failureId: current.failureId, expectedVersion: 1 });
      assert.equal(command.requestedBy, "local-operator");
      await new Promise<void>(resolve => { finish = resolve; });
      current = annotatedDetail(2, true);
      return { state: "applied", commandId: command.commandId, affectedTargets: [{ family: "failure-resolution", runId: current.runId, failureId: current.failureId }] };
    } } as unknown as DashboardClient;
    const host = await mountResolution(client);
    await act(async () => namedButton(host, "Mark resolved").click());
    assert.equal(namedButton(host, "Saving…").disabled, true); assert.match(host.textContent ?? "", /Unresolved/u);
    assert.ok(finish); await act(async () => finish?.());
    assert.equal(namedButton(host, "Reopen").disabled, false); assert.match(host.textContent ?? "", /Updated page control/u);
  });
  it("shows a refusal and readback failure without an optimistic resolved label", async () => {
    let readsFail = false;
    const client = { runSection: async () => { if (readsFail) throw new Error("Synthetic read unavailable"); return failureResponse(annotatedDetail()); },
      executeCommand: async () => { readsFail = true; return { state: "rejected", commandId: "11111111-1111-4111-8111-111111111111", code: "invalid-state", message: "Annotation version changed" }; },
    } as unknown as DashboardClient;
    const host = await mountResolution(client);
    await act(async () => namedButton(host, "Mark resolved").click());
    assert.match(host.textContent ?? "", /Annotation version changed/u); assert.match(host.textContent ?? "", /Synthetic read unavailable/u);
    assert.match(host.textContent ?? "", /Unresolved/u); assert.equal(namedButton(host, "Mark resolved").disabled, true);
  });
  it("observes another process without a run-version change and stops polling on unmount", async () => {
    vi.useFakeTimers();
    try {
      let current = annotatedDetail(); let reads = 0; let signal: AbortSignal | undefined;
      const client = { runSection: async (_run: string, _section: string, _cursor: string | undefined, inputSignal: AbortSignal) => {
        reads++; signal = inputSignal; return failureResponse(current);
      } } as unknown as DashboardClient;
      const host = await mountResolution(client);
      current = annotatedDetail(2, true);
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      assert.equal(reads, 2); assert.ok(namedButton(host, "Reopen"));
      await act(async () => mountedRoot?.unmount()); mountedRoot = undefined;
      assert.equal(signal?.aborted, true);
      await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); assert.equal(reads, 2);
    } finally { vi.useRealTimers(); }
  });
  it("rejects a different failure returned by a read and stops its obsolete read on selection change", async () => {
    let resolveOld: ((response: RunDetailSectionResponse) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    const client = { runSection: async (_run: string, _section: string, _cursor: string | undefined, signal: AbortSignal) => {
      oldSignal = signal;
      return await new Promise<RunDetailSectionResponse>(resolve => { resolveOld = resolve; });
    } } as unknown as DashboardClient;
    const host = await mountResolution(client);
    const wrong = failureDetail({ failureId: "33333333-3333-4333-8333-333333333333" });
    assert.ok(resolveOld); await act(async () => resolveOld?.(failureResponse(wrong)));
    assert.match(host.textContent ?? "", /did not match/u);
    assert.equal(namedButton(host, "Mark resolved").disabled, true);
    await act(async () => mountedRoot?.render(createElement(DashboardClientProvider, { client,
      children: createElement(FailureDetailBody, { detail: annotatedDetail(2, true) }),
    })));
    assert.equal(oldSignal?.aborted, true); assert.doesNotMatch(host.textContent ?? "", /Mark resolved|Reopen/u);
  });
});


describe("approved F2 outcome-first Logs", () => {
  it("places exact failure screenshots once and leaves unrelated captures in the gallery", () => {
    const value = failureDetail({ diagnosticBundle: { state: "present", bundleId: CAPTURE_BUNDLE_A } });
    const linked = captureImage();
    const unrelated = { ...captureImage("00000000-0000-4000-8000-000000000799"),
      origins: [{ bundleId: CAPTURE_BUNDLE_B, originKind: "failure" as const }] };
    const detail = captureDetail(value.runId, { outcome: { state: "terminal", result: "failed", completedAt: value.occurredAt } });
    const html = renderToStaticMarkup(createElement(DashboardClientProvider, {
      client: refusingClient(), children: createElement(LogsTab, {
        detail, failure: { state: "available", value }, notes: { runId: value.runId, rows: [], notes: [], nextCursor: { state: "absent", reason: "end-of-page" } },
        captures: { state: "available", runId: value.runId, generation: 1, selectedId: undefined, select: () => undefined,
          items: [linked, unrelated].map(capture => ({ capture, downloadUrl: `/artifacts/${capture.artifact.artifactId}` })) },
        parked: undefined, gateActions: [], onResolveGate: () => undefined, onResolvePark: () => undefined,
        decisionRef: () => undefined, failureRef: () => undefined, parkedRef: () => undefined,
        workflowLabel: "Fixture workflow", currentAppVersion: "0.1.0", servedDescriptorHash: undefined,
        aiAdvisory: { state: "unavailable", code: "not-configured", reason: "No advisory configured" },
        nowIso: value.occurredAt, actorId: "fixture-operator",
      }),
    }));
    const host = document.createElement("div"); host.innerHTML = html;
    const failure = host.querySelector('[data-panel-failure-record]');
    const gallery = host.querySelector('[aria-label="Run captures"]');
    const linkedControl = `button[aria-label="Open capture ${linked.artifact.artifactId}"]`;
    assert.ok(failure?.querySelector(linkedControl));
    assert.equal(host.querySelectorAll(linkedControl).length, 1);
    assert.equal(gallery?.querySelector(linkedControl), null);
    assert.ok(gallery?.querySelector(`button[aria-label="Open capture ${unrelated.artifact.artifactId}"]`));
    assert.equal(failure?.querySelector(".operation-capture time"), null, "Legacy origins must not acquire an invented capture timestamp");
  });
  function primary(value: FailureDetailWire): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = renderRecord({ state: "available", value });
    const details = host.querySelector(".operation-outcome-details");
    assert.ok(details instanceof HTMLElement);
    assert.equal(details.hasAttribute("open"), false);
    assert.ok(details.textContent?.includes(value.summary));
    assert.ok(details.textContent?.includes(value.failureId));
    for (const remediation of value.remediation) assert.ok(details.textContent?.includes(remediation.message));
    details.remove();
    return host;
  }
  it("keeps raw errors, IDs and follow-up controls out of the primary layout", () => {
    const value = failureDetail();
    const host = primary(value);
    assert.ok(host.textContent?.includes("Employee identity mismatch"));
    assert.ok(host.textContent?.includes("No write attempted"));
    assert.ok(host.textContent?.includes("••••5001"));
    assert.ok(host.textContent?.includes("••••4136"));
    assert.ok(!host.textContent?.includes(value.summary));
    assert.ok(!host.textContent?.includes(value.failureId));
    assert.ok(!host.textContent?.includes(value.code));
    assert.ok(!host.textContent?.includes("Problem follow-up"));
    assert.ok(!host.textContent?.includes("no advisory is configured"));
  });
  it.each([
    ["not-attempted", "No write attempted"], ["prepared", "Staged · not submitted"],
    ["attempting", "Submission outcome unsettled"], ["committed", "Submitted · verification incomplete"],
    ["verified", "Write committed and verified"], ["unknown", "Write outcome unknown"],
  ] as const)("keeps %s distinct while Details is closed", (writeState, label) => {
    const host = primary(failureDetail({ writeState, action: { operation: "commit" } }));
    assert.ok(host.textContent?.includes(label));
    if (writeState === "unknown" || writeState === "attempting") assert.ok(host.textContent?.includes("Do not retry this submission."));
    if (writeState === "committed" || writeState === "verified") assert.ok(host.textContent?.includes("Do not submit"));
  });
  it.each(["retry-when-served", "operator-action", "configuration", "code-change", "no-safe-action"] as const)("keeps the %s next step visible and its complete message in Details", kind => {
    const value = failureDetail({ remediation: [{ kind, message: `Required correction for ${kind}` }] });
    const host = primary(value);
    const next = host.querySelector('[aria-label="What is safe to retry"]');
    assert.ok(next?.textContent?.includes("Next step"));
    assert.ok(next?.textContent && next.textContent.length > 20);
    assert.ok(!host.textContent?.includes(`Required correction for ${kind}`));
    if (kind === "retry-when-served") assert.ok(next.textContent.includes("only when this run offers a retry action"));
    if (kind === "no-safe-action") assert.ok(next.textContent.includes("No safe recovery action"));
  });
  it("keeps unclassified failures honest without parsing their raw message", () => {
    const host = primary(failureDetail({ code: "UNMAPPED_ERROR", summary: "SUBJECT_MISMATCH session expired and allegedly saved" }));
    assert.ok(host.textContent?.includes("Step could not be completed"));
    assert.ok(!host.textContent?.includes("Employee identity mismatch"));
    assert.ok(!host.textContent?.includes("session expired"));
  });
});
