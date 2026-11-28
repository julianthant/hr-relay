/** The operator's rules for every dashboard state. Each rule is one named function that returns what it found
 * wrong, with its own failure message; the check loop runs all of them on every story. */
import { expect, type Page } from "@playwright/test";
import { usesIndependentDialogReferences } from "./gallery-shards.js";
import { BANNED_PATTERNS, BANNED_PHRASES, BANNED_TERMS, WORD_LIMITS, type StateRuleName } from "./state-rule-limits.js";
import { DIALOG_REFERENCE_SURFACE, DIALOG_REFERENCE_VARIANTS } from "./story-catalogue.js";
import type { Story } from "./story-catalogue.js";

export interface StateRuleContext {
  readonly page: Page;
  readonly storyId: string;
  readonly story: Story;
  /** Everything the page has reported so far; `settle` waits for requests still in flight to finish and report. */
  readonly diagnostics: { readonly seen: readonly string[]; readonly settle: () => Promise<void> };
  /** The shape each kind of dialog is held to in this run, by kind and viewport. */
  readonly dialogShapes: Map<string, { readonly storyId: string; readonly shape: Readonly<Record<string, string>> }>;
  readonly recordTabStop?: (activeElement: string) => void;
}

type StateRuleCheck = (context: StateRuleContext) => Promise<readonly string[]>;

const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

export async function declaredDiagnostics({ page, story, diagnostics }: StateRuleContext): Promise<readonly string[]> {
  // A story whose requests start late names the point where they have answered.
  if (story.settled !== undefined) await expect(page.locator(story.settled).first(), "the story's settled point").toBeVisible();
  await diagnostics.settle();
  const declared = story.expects ?? [];
  return diagnostics.seen.filter(entry => !declared.some(({ pattern }) => pattern.test(entry)));
}

export function fitsViewport({ page }: StateRuleContext): Promise<readonly string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const scroller = document.scrollingElement ?? document.documentElement;
    const sideways = scroller.scrollWidth - scroller.clientWidth;
    if (sideways > 0) found.push(`the page scrolls sideways by ${String(sideways)}px`);
    const clips = (value: string) => value === "hidden" || value === "clip";
    const scrolls = (value: string) => value === "auto" || value === "scroll";
    const range = document.createRange();
    for (const element of document.querySelectorAll<HTMLElement>("body *:not(script, style)")) {
      const nodes = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
      if (nodes.length === 0) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden") continue;
      // Where the text itself is drawn, which can run past the box that holds it.
      const drawn = nodes.flatMap(node => { range.selectNodeContents(node); return [...range.getClientRects()]; }).filter(rect => rect.width > 0 && rect.height > 0);
      if (drawn.length === 0) continue;
      const left = Math.min(...drawn.map(rect => rect.left));
      const right = Math.max(...drawn.map(rect => rect.right));
      // A line's rectangle is taller than its letters; the middle 0.7em is where the ink is.
      const ink = Number.parseFloat(style.fontSize) * 0.35;
      const top = Math.min(...drawn.map(rect => (rect.top + rect.bottom) / 2 - ink));
      const bottom = Math.max(...drawn.map(rect => (rect.top + rect.bottom) / 2 + ink));
      const label = `"${nodes.map(node => node.textContent ?? "").join("").trim().slice(0, 60)}"`;
      const cuts: string[] = [];
      const text = nodes.map(node => node.textContent ?? "").join("").trim();
      // An ellipsis is accepted only where the full text is reachable: a title, or a hover/focus trigger named with it.
      const tooltipStates = ["closed", "delayed-open", "instant-open"];
      const reachable = () => { if (text === "") return false; for (let holder: HTMLElement | null = element; holder !== null; holder = holder.parentElement) {
        if ((holder.getAttribute("title") ?? "").includes(text)) return true;
        // A tooltip trigger opens on hover and focus; tabs and collapsibles also carry data-state, but not these.
        const trigger = tooltipStates.includes(holder.getAttribute("data-state") ?? "") && !holder.hasAttribute("aria-expanded") && holder.getAttribute("role") !== "tab";
        if (trigger && (holder.getAttribute("aria-label") ?? "").includes(text)) return true;
      } return false; };
      if (element.hasAttribute("data-one-line")) {
        const lines = new Set(drawn.map(rect => Math.round(rect.top)));
        if (lines.size > 1) found.push(`${label} takes ${String(lines.size)} lines; it must stay on one line`);
      }
      let ellipsed = false;
      let checkX = true;
      let checkY = true;
      let inRow = false;
      let unseen = false;
      for (let frameElement: HTMLElement | null = element; frameElement !== null && frameElement !== document.body && (checkX || checkY); frameElement = frameElement.parentElement) {
        const frameStyle = getComputedStyle(frameElement);
        const box = frameElement.getBoundingClientRect();
        // A 1px clipping box is the screen-reader-only pattern: read aloud, never drawn.
        if (box.width <= 1 || box.height <= 1) { unseen = true; break; }
        // Clipping happens at the inside of the border.
        const frameLeft = box.left + frameElement.clientLeft;
        const frameTop = box.top + frameElement.clientTop;
        const by = frameElement === element ? "" : " by its container";
        if (checkX && clips(frameStyle.overflowX) && (right > frameLeft + frameElement.clientWidth + 1 || left < frameLeft - 1)) {
          if (frameStyle.textOverflow === "ellipsis" && reachable()) ellipsed = true;
          else cuts.push(`${label} is cut off sideways${by}`);
          checkX = false;
        }
        if (checkY && clips(frameStyle.overflowY) && (bottom > frameTop + frameElement.clientHeight + 1 || top < frameTop - 1)) { cuts.push(`${label} is cut off at the ${bottom > frameTop + frameElement.clientHeight + 1 ? "bottom" : "top"}${by}`); checkY = false; }
        // A row that scrolls sideways, fits the window and takes the keyboard may run past its right edge.
        if (scrolls(frameStyle.overflowX) && frameElement.tabIndex >= 0 && box.right <= window.innerWidth + 1) inRow = true;
        // Text past a scrolling container's edge is reachable by scrolling, not clipped.
        if (scrolls(frameStyle.overflowX)) checkX = false;
        if (scrolls(frameStyle.overflowY)) checkY = false;
      }
      if (unseen) continue;
      if (!ellipsed && !inRow && right > window.innerWidth + 1) found.push(`${label} runs ${String(Math.round(right - window.innerWidth))}px past the right edge`);
      found.push(...cuts);
    }
    return found;
  });
}

export async function noBannedText({ page }: StateRuleContext): Promise<readonly string[]> {
  const texts = await page.evaluate(() => {
    // The whole document: dialogs, menus and toasts mount in portals beside the story root.
    // A path control shows the chosen folder on purpose (middle-truncated); that one value is not an operator leak.
    const shownPaths = new Set([...document.body.querySelectorAll(".ds-path-value")].map(element => element.textContent?.trim()));
    const lines = document.body.innerText.split("\n").filter(line => !shownPaths.has(line.trim()));
    for (const element of document.body.querySelectorAll("[aria-label], [title], [placeholder], [alt]")) {
      for (const attribute of ["aria-label", "title", "placeholder", "alt"]) lines.push(element.getAttribute(attribute) ?? "");
    }
    return [...new Set(lines.map(line => line.trim()).filter(line => line !== ""))];
  });
  const found: string[] = [];
  for (const text of texts) {
    for (const phrase of BANNED_PHRASES) if (text.toLowerCase().includes(phrase.toLowerCase())) found.push(`"${phrase}" in "${text}"`);
    for (const term of BANNED_TERMS) if (new RegExp(String.raw`\b${escapePattern(term)}s?\b`, "iu").test(text)) found.push(`the internal term "${term}" in "${text}"`);
    for (const { name, pattern } of BANNED_PATTERNS) if (pattern.test(text)) found.push(`a ${name} in "${text}"`);
  }
  return found;
}

export function wordLimits({ page }: StateRuleContext): Promise<readonly string[]> {
  return page.evaluate(limits => {
    const found: string[] = [];
    for (const [kind, { limit, selector }] of Object.entries(limits)) {
      const elements = new Set(document.querySelectorAll<HTMLElement>(`body :is(${selector})`));
      // A dialog names its description through aria-describedby, whatever element holds it.
      if (kind === "description") {
        for (const dialog of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
          for (const id of (dialog.getAttribute("aria-describedby") ?? "").split(/\s+/u)) {
            const described = id === "" ? null : document.getElementById(id);
            if (described !== null) elements.add(described);
          }
        }
      }
      for (const element of elements) {
        const text = element.innerText.trim();
        const words = text === "" ? 0 : text.split(/\s+/u).length;
        if (words > limit) found.push(`the ${kind} "${text}" has ${String(words)} words; the limit is ${String(limit)}`);
      }
    }
    return found;
  }, WORD_LIMITS);
}

export function toastTextOnly({ page }: StateRuleContext): Promise<readonly string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const toast of document.querySelectorAll<HTMLElement>('[data-ds-toast-state]')) {
      const box = toast.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      const extras = toast.querySelectorAll("button, a[href], input, select, textarea, img, video");
      if (extras.length > 0) found.push(`the toast "${toast.innerText.trim().slice(0, 60)}" holds ${String(extras.length)} control or image; a toast is text only`);
    }
    return found;
  });
}

/** Toasts sit top centre, 12px from the top, inside the window and off the Sessions panel, whatever height the panel is. */
export function toastPlacement({ page }: StateRuleContext): Promise<readonly string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const panel = document.querySelector('[aria-label="Session Panel"]')?.getBoundingClientRect();
    const shown = [...document.querySelectorAll<HTMLElement>('[data-ds-toast-state]')].filter(toast => { const box = toast.getBoundingClientRect(); return box.width > 1 && box.height > 1; });
    if (shown.length === 0) return found;
    const viewport = document.querySelector('[data-slot="toast-viewport"]');
    const front = shown.find(toast => getComputedStyle(toast).getPropertyValue("--toast-index").trim() === "0");
    if (viewport === null || front === undefined) return ["a toast is shown without a viewport or a front toast"];
    for (const [part, element] of [["toast viewport", viewport], ["front toast", front]] as const) {
      const top = element.getBoundingClientRect().top;
      if (Math.abs(top - 12) > 1) found.push(`the ${part} sits ${String(Math.round(top))}px from the window's top edge, not 12px`);
    }
    for (const toast of shown) {
      const box = toast.getBoundingClientRect();
      const label = `the toast "${toast.innerText.trim().slice(0, 60)}"`;
      const offCentre = Math.abs((box.left + box.right) / 2 - window.innerWidth / 2);
      if (offCentre > 2) found.push(`${label} is ${String(Math.round(offCentre))}px off the horizontal centre`);
      if (panel !== undefined && box.bottom > panel.top && box.top < panel.bottom && box.left < panel.right && panel.left < box.right) found.push(`${label} overlaps the Sessions panel`);
      if (box.top < 0 || box.left < 0 || box.right > window.innerWidth || box.bottom > window.innerHeight) found.push(`${label} runs outside the window`);
    }
    return found;
  });
}

export function skeletonOnlyWhileFetching({ page, story }: StateRuleContext): Promise<readonly string[]> {
  return page.evaluate(region => {
    const skeletons = [...document.querySelectorAll('[data-slot="skeleton"]')];
    if (skeletons.length === 0) return [];
    if (region === null) return [`${String(skeletons.length)} skeleton shown in a story that is not marked as a slow fetch`];
    const outside = skeletons.filter(skeleton => skeleton.closest(region) === null).length;
    return outside === 0 ? [] : [`${String(outside)} skeleton shown outside the fetching region ${region}`];
  }, story.slowFetch?.region ?? null);
}

interface DialogShape { readonly kind: string; /** The design-system dialog this is, when it is one: its size, and whether it has the banded header and footer. */ readonly variant: string | null; readonly shape: Readonly<Record<string, string>> }

/** Runs in the page. What each open dialog is drawn with: its edge, its title and the padding of each part. */
function measureDialogs(): DialogShape[] {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')]
    .filter(dialog => dialog.getBoundingClientRect().width > 1)
    .map(dialog => {
      const style = getComputedStyle(dialog);
      const title = dialog.querySelector('h1, h2, h3, [data-slot$="title"]');
      const shape: Record<string, string> = { radius: style.borderRadius, padding: style.padding };
      for (const edge of ["Top", "Right", "Bottom", "Left"] as const) {
        shape[`${edge.toLowerCase()} border`] = `${style[`border${edge}Width`]} ${style[`border${edge}Style`]} ${style[`border${edge}Color`]}`;
      }
      if (title !== null) shape["title size"] = getComputedStyle(title).fontSize;
      // The dashboard's dialogs pad their parts, not the dialog: the header, the body and the footer each carry their own.
      for (const part of dialog.children) {
        if (part.getBoundingClientRect().height <= 1) continue;
        const name = title !== null && part.contains(title) ? "header" : part.matches("footer, [data-slot$=\"footer\"]") ? "footer" : "body";
        shape[`${name} padding`] ??= getComputedStyle(part).padding;
      }
      // A form or layout wrapper around the parts is not the body: read the design system's own body.
      const body = dialog.querySelector('[data-slot="dialog-body"]');
      if (body !== null) shape["body padding"] = getComputedStyle(body).padding;
      const size = dialog.getAttribute("data-size");
      const variant = size === null ? null : `${size}${dialog.hasAttribute("data-band") ? "-band" : ""}`;
      return { kind: [dialog.getAttribute("role"), variant ?? dialog.getAttribute("data-slot") ?? ""].join(":"), variant, shape };
    });
}

/** The design system's own dialog of this size, drawn alone in a second page at the same viewport. */
async function designSystemDialogShape(page: Pick<Page, "context" | "url">, variant: string): Promise<DialogShape["shape"]> {
  const reference = await page.context().newPage();
  try {
    await reference.goto(new URL("/", page.url()).href);
    await reference.evaluate(story => {
      const mount: unknown = Reflect.get(window, "mount");
      if (typeof mount !== "function") throw new Error("the gallery page exposes no mount function");
      Reflect.apply(mount, window, [{ story }]);
    }, `${DIALOG_REFERENCE_SURFACE}/dialog/${variant}`);
    await expect(reference.locator('[role="dialog"]'), `the reference ${variant} dialog`).toBeVisible();
    const [measured] = await reference.evaluate(measureDialogs);
    if (measured === undefined) throw new Error(`the reference ${variant} dialog could not be measured`);
    return measured.shape;
  } finally {
    await reference.close();
  }
}

type DialogRuleContext = Pick<StateRuleContext, "storyId" | "story" | "dialogShapes"> & {
  readonly page: Pick<Page, "viewportSize" | "evaluate" | "context" | "url">;
};

export async function dialogsShareShape({ page, storyId, story, dialogShapes }: DialogRuleContext): Promise<readonly string[]> {
  const viewport = page.viewportSize();
  const found: string[] = [];
  for (const { kind, variant, shape } of await page.evaluate(measureDialogs)) {
    if ((variant === null || !DIALOG_REFERENCE_VARIANTS.includes(variant)) && usesIndependentDialogReferences(storyId)) {
      throw new Error(`${storyId} draws ${kind} with a cross-story reference. Move its story group to the shared-reference gallery shard.`);
    }
    const key = `${kind} at ${String(viewport?.width)}x${String(viewport?.height)}`;
    let reference = dialogShapes.get(key);
    // A dialog built on the design system is held to the design system's own dialog of that size.
    if (reference === undefined && variant !== null && DIALOG_REFERENCE_VARIANTS.includes(variant)) {
      reference = { storyId: "the design system", shape: await designSystemDialogShape(page, variant) };
      dialogShapes.set(key, reference);
    }
    // Any other kind is held to the first story that draws it and is not a recorded break of this rule.
    if (reference === undefined) {
      if (story.knownFailures?.["dialogs-share-shape"] === undefined) dialogShapes.set(key, { storyId, shape });
      continue;
    }
    for (const [part, drawn] of Object.entries(shape)) {
      const expected = reference.shape[part];
      if (expected !== undefined && expected !== drawn) found.push(`a ${kind} dialog has ${part} ${drawn}; ${reference.storyId} draws it with ${expected}`);
    }
  }
  return found;
}

export function primaryButtonAccent({ page }: StateRuleContext): Promise<readonly string[]> {
  return page.evaluate(() => {
    const host = document.querySelector("[data-app-root]") ?? document.body;
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("the gallery page cannot read colours");
    const rgba = (color: string): [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
      return [red, green, blue, alpha];
    };
    const token = (name: string) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = `var(${name})`;
      host.append(probe);
      const color = rgba(getComputedStyle(probe).backgroundColor);
      probe.remove();
      return color;
    };
    const luminance = ([red, green, blue]: readonly number[]) => [red, green, blue].map(channel => {
      const value = (channel ?? 0) / 255;
      return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
    const contrast = (first: readonly number[], second: readonly number[]) => {
      const [light, dark] = [luminance(first), luminance(second)].sort((left, right) => right - left);
      return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
    };
    const accent = token("--ds-accent");
    const canvasSurface = token("--ds-surface-page");
    const off = token("--ds-button-off-bg");
    const same = (first: readonly number[], second: readonly number[]) => first.every((channel, index) => Math.abs(channel - (second[index] ?? 0)) <= 2);
    const found: string[] = [];
    for (const button of document.querySelectorAll<HTMLElement>('body :is(button, [role="button"], a[data-slot="button"])')) {
      if (button.getAttribute("role") === "checkbox") continue;
      const box = button.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      const fill = rgba(getComputedStyle(button).backgroundColor);
      // The Button primary variant declares the accent fill and its ink; a button that carries either is primary
      // whatever it ends up painted with. Any other loud solid fill is a primary in all but name.
      const declared = button.className.includes("bg-[var(--ds-accent)]") || button.className.includes("text-[color:var(--ds-accent-fg)]");
      const loud = fill[3] >= 250 && contrast(fill, canvasSurface) >= 3;
      if (!declared && !loud) continue;
      // A dialog's confirm with nothing to save is the flat off grey, not a second accent.
      if (button.matches(":disabled") && same(fill, off)) continue;
      if (fill[3] < 250 || fill.some((channel, index) => Math.abs(channel - (accent[index] ?? 0)) > 2)) {
        const paint = fill[3] < 250 ? "has no solid fill" : `is filled rgb(${fill.slice(0, 3).join(", ")})`;
        found.push(`the button "${(button.getAttribute("aria-label") ?? button.innerText).trim().slice(0, 40)}" ${paint}, `
          + `not the accent rgb(${accent.slice(0, 3).join(", ")})`);
      }
    }
    return found;
  });
}

export function noDeadDisabledControl({ page }: StateRuleContext): Promise<readonly string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const disabled = (element: Element) => element.matches(':disabled, [aria-disabled="true"]');
    const name = (element: Element) => (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40);
    for (const control of document.querySelectorAll<HTMLElement>('body :is(select, [role="combobox"], [aria-haspopup])')) {
      if (!disabled(control) || control.getBoundingClientRect().width <= 1) continue;
      // A control held off while its own request is in flight says so on itself: that is a lock, not a dead control.
      if (control.matches('[aria-haspopup][aria-busy="true"]')) continue;
      // A dimmed control that keeps its place and gives its reason in a tooltip (the trigger's label) is explained, not dead.
      // The trigger is a wrapper around it; tabs and disclosure triggers carry the same data-state but are not tooltips.
      let explained = false;
      for (let holder = control.parentElement; holder !== null; holder = holder.parentElement) {
        const tooltip = ["closed", "delayed-open", "instant-open"].includes(holder.getAttribute("data-state") ?? "") && !holder.hasAttribute("aria-expanded") && holder.getAttribute("role") !== "tab";
        const reason = (holder.getAttribute("aria-label") ?? "").trim();
        const own = (control.getAttribute("aria-label") ?? control.textContent ?? "").trim();
        if (tooltip && reason !== "" && reason !== own) { explained = true; break; }
      }
      if (explained) continue;
      if (control instanceof HTMLSelectElement && [...control.options].filter(option => !option.disabled).length > 1) continue;
      found.push(`the picker "${name(control)}" is shown switched off with nothing to choose`);
    }
    for (const group of document.querySelectorAll('body :is([role="radiogroup"], [role="group"], fieldset)')) {
      // A switched-off, checked box on a card marked settled is a value on show, not a choice left to make.
      const choices = [...group.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"], [role="switch"]')]
        .filter(choice => !(disabled(choice) && choice.closest("[data-settled]") !== null && ((choice as HTMLInputElement).checked || choice.getAttribute("aria-checked") === "true")));
      if (choices.length > 0 && choices.every(disabled)) found.push(`every choice in "${name(group)}" is switched off`);
    }
    return found;
  });
}

const CONTROL_SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="checkbox"], '
  + '[role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="combobox"], [tabindex]';

// Playwright widens literal unions across evaluate, so the step is a plain string: "tag" | "stop" | "focus" | "clean".
interface FocusProbeStep { readonly step: string; readonly selector?: string; readonly index?: string }
interface FocusProbeControl {
  readonly index: string;
  readonly label: string;
  /** Inside a widget whose members arrow keys move between. */
  readonly composite: boolean;
  /** The native radio group this belongs to: Tab stops on one member and the browser's arrow keys reach the rest. */
  readonly radios: string | null;
}
interface FocusProbeResult {
  readonly controls: readonly FocusProbeControl[];
  /** Where keyboard focus is now: a tagged control, some other element, or nothing. */
  readonly stop: { readonly index: string | null; readonly nowhere: boolean; readonly ring: boolean; readonly element: string };
}

/** Runs in the page. Tags every control an operator can use, then reports each keyboard stop and how it is drawn. */
function focusProbe(input: FocusProbeStep): FocusProbeResult {
  // A control drawn as a 1px box (a hidden radio or checkbox) shows its focus on the label that stands in for it.
  const stoodInFor = (element: Element): readonly Element[] => {
    const box = element.getBoundingClientRect();
    // A switch's input is laid over its whole row at opacity 0 so the row takes the click; the ring a keyboard user sees
    // is drawn on the visible control beside it (WCAG 2.4.7 asks that a ring be visible, not that it sit on the input).
    const overlay = element instanceof HTMLInputElement && getComputedStyle(element).opacity === "0";
    // A text field's focus mark is its caret plus the field's border stepping up, drawn on the box around the input.
    const field = element.matches("input:not([type=checkbox], [type=radio], [type=range]), textarea") ? element.closest('[data-slot="search-field-group"], .ds-secret-input') : null;
    if (field !== null) return [element, field];
    if (!(element instanceof HTMLInputElement) || box.width > 1 && box.height > 1 && !overlay) return [element];
    return [...element.labels ?? []].flatMap(label => [label, ...label.querySelectorAll("*")]).filter(part => part !== element);
  };
  const look = (element: Element): string => JSON.stringify(stoodInFor(element).map(part => {
    const style = getComputedStyle(part);
    const outline = style.outlineStyle === "none" || Number.parseFloat(style.outlineWidth) === 0 ? "none" : `${style.outlineWidth} ${style.outlineColor}`;
    return [outline, style.boxShadow, style.borderColor, style.backgroundColor];
  }));
  const controls: FocusProbeControl[] = [];
  let stop: FocusProbeResult["stop"] = { index: null, nowhere: true, ring: false, element: "(none)" };
  const report = () => {
    const active = document.activeElement;
    if (active === null) return;
    const index = active.getAttribute("data-state-rule-control");
    const attributes = ["id", "role", "tabindex", "aria-label"].flatMap(name => {
      const value = active.getAttribute(name);
      return value === null ? [] : [` ${name}=${JSON.stringify(value)}`];
    });
    stop = { index, nowhere: active === document.body, ring: index !== null && look(active) !== active.getAttribute("data-state-rule-look"),
      element: `<${active.localName}${attributes.join("")}>` };
  };
  if (input.step === "tag") {
    // Focus styles ease in; measure where they settle.
    const still = document.createElement("style");
    still.setAttribute("data-state-rule-still", "");
    still.textContent = "* { transition: none !important; }";
    document.head.append(still);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const composite = '[role="radiogroup"], [role="tablist"], [role="menu"], [role="menubar"], [role="listbox"], [role="toolbar"], [role="grid"], [role="tree"]';
    for (const element of document.querySelectorAll<HTMLElement>(`body :is(${input.selector ?? "*"})`)) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || getComputedStyle(element).visibility === "hidden") continue;
      const shown = stoodInFor(element).filter(part => { const partBox = part.getBoundingClientRect(); return partBox.width > 1 && partBox.height > 1; });
      if (shown.length === 0) continue;
      if (element.matches(':disabled, [aria-disabled="true"]') || element.closest('[inert], [aria-hidden="true"]') !== null) continue;
      // A tab list hands its Tab stop to the active tab, so the tabs are the stops; the list counts as reached only while that tab can take focus.
      if (element.getAttribute("role") === "tablist" && element.querySelector('[role="tab"][aria-selected="true"]:not(:disabled, [aria-disabled="true"])') !== null) continue;
      // A menu popup hands its stop to its items the same way; one with no enabled item still counts.
      if (element.getAttribute("role") === "menu" && element.querySelector('[role^="menuitem"]:not(:disabled, [aria-disabled="true"])') !== null) continue;
      if (element.getAttribute("tabindex") === "-1") {
        // Settings names the highlighted row so it can announce the destination; its controls still have their own stops.
        const settingsPath = element.getAttribute("data-settings-path");
        if (settingsPath !== null && element.matches('div[role="group"]')
          && element.closest("[data-settings-target]")?.getAttribute("data-settings-target") === settingsPath) continue;
        // A dialog surface or bare region can receive programmatic focus without adding a Tab stop.
        if (!element.matches('a[href], button, input, select, textarea, [role]:not([role="dialog"], [role="alertdialog"])')) continue;
      }
      const index = String(controls.length);
      element.setAttribute("data-state-rule-control", index);
      element.setAttribute("data-state-rule-look", look(element));
      const stoodIn = shown[0] instanceof HTMLElement && shown[0] !== element ? shown[0].innerText : element.innerText;
      const text = (element.getAttribute("aria-label") ?? stoodIn).trim().slice(0, 40);
      const radio = element instanceof HTMLInputElement && element.type === "radio";
      controls.push({ index, label: text === "" ? `<${element.tagName.toLowerCase()} class="${element.className.slice(0, 60)}">` : `"${text}"`,
        composite: !radio && element.closest(composite) !== null, radios: radio ? `${element.form?.id ?? ""}/${element.name}` : null });
    }
  } else if (input.step === "stop") {
    report();
  } else if (input.step === "focus") {
    document.querySelector<HTMLElement>(`[data-state-rule-control="${input.index ?? ""}"]`)?.focus();
    report();
  } else {
    document.querySelector("[data-state-rule-still]")?.remove();
    for (const element of document.querySelectorAll("[data-state-rule-control]")) {
      element.removeAttribute("data-state-rule-control");
      element.removeAttribute("data-state-rule-look");
    }
  }
  return { controls, stop };
}

export async function namedAndFocusable({ page, recordTabStop }: StateRuleContext): Promise<readonly string[]> {
  const found: string[] = [];
  // A story may open focused. Blur on its own turn so a state-driven ring (React Aria) is gone before the unfocused look is read.
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  const { controls } = await page.evaluate(focusProbe, { step: "tag", selector: CONTROL_SELECTOR });
  try {
    for (const { index, label } of controls) {
      // The browser's own accessible name: hidden text and decorative images do not count. Zero would wait for ever.
      const named = await expect(page.locator(`[data-state-rule-control="${index}"]`)).toHaveAccessibleName(/\S/u, { timeout: 250 })
        .then(() => true, () => false);
      if (!named) found.push(`${label} has no name`);
    }
    // Blurring a control leaves Chromium's Tab starting point there. Follow the browser's wrap through the
    // document so a walk beginning mid-page also reaches the earlier controls.
    const rings = new Map<string, boolean>();
    const tabStops = new Set<string>();
    const byIndex = new Map(controls.map(control => [control.index, control]));
    const members = controls.filter(control => control.composite).length;
    let wrapped = false;
    let lastTabIndex: number | undefined;
    for (let presses = 0; presses < controls.length * 2 + 20 && rings.size < controls.length; presses += 1) {
      await page.keyboard.press("Tab");
      const { stop } = await page.evaluate(focusProbe, { step: "stop" });
      const control = stop.index === null ? undefined : byIndex.get(stop.index);
      recordTabStop?.(control === undefined ? stop.element : `${stop.element} ${control.label.replace(/\s+/gu, " ")}`);
      if (stop.nowhere) {
        if (wrapped) break;
        wrapped = true;
        tabStops.clear();
        continue;
      }
      if (stop.index === null) continue;
      const tabIndex = Number(stop.index);
      // A later control after body means focus was dropped mid-page.
      if (wrapped && tabStops.size === 0 && lastTabIndex !== undefined && tabIndex > lastTabIndex) break;
      if (tabStops.has(stop.index)) break;
      tabStops.add(stop.index);
      lastTabIndex = tabIndex;
      if (rings.has(stop.index)) continue;
      rings.set(stop.index, stop.ring);
      if (control?.composite !== true) continue;
      for (const key of ["ArrowRight", "ArrowDown"]) {
        for (let moves = 0; moves < members; moves += 1) {
          const before = (await page.evaluate(focusProbe, { step: "stop" })).stop.index;
          await page.keyboard.press(key);
          // A widget may move focus a tick after the key (Radix does); give it a moment before reading where focus went.
          let moved = (await page.evaluate(focusProbe, { step: "stop" })).stop;
          for (let waited = 0; waited < 10 && moved.index === before; waited += 1) {
            await page.waitForTimeout(20);
            moved = (await page.evaluate(focusProbe, { step: "stop" })).stop;
          }
          if (moved.index === null || rings.has(moved.index)) break;
          rings.set(moved.index, moved.ring);
        }
      }
    }
    // The browser moves between the radios of one native group with arrow keys, which would also change the choice;
    // once Tab has reached the group, look at each other member's focus without choosing it.
    const reachedGroups = new Set(controls.filter(control => control.radios !== null && rings.has(control.index)).map(control => control.radios));
    for (const { index, radios } of controls) {
      if (radios === null || rings.has(index) || !reachedGroups.has(radios)) continue;
      const { stop } = await page.evaluate(focusProbe, { step: "focus", index });
      if (stop.index === index) rings.set(index, stop.ring);
    }
    for (const { index, label } of controls) {
      const ring = rings.get(index);
      if (ring === undefined) found.push(`${label} cannot be reached with the keyboard`);
      // The dashboard marks keyboard focus with its focus fill (DESIGN.md); an outline, shadow or edge change also counts.
      else if (!ring) found.push(`${label} shows no focus ring`);
    }
  } finally {
    await page.evaluate(focusProbe, { step: "clean" });
  }
  return found;
}

/** A queue card's labels (status, dry run, counts) sit at the right of the title's line; a long title gives way before they wrap under it. */
export function statusLabelOnTitleLine({ page }: StateRuleContext): Promise<readonly string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const body of document.querySelectorAll<HTMLElement>("[data-queue-body]")) {
      const title = body.querySelector<HTMLElement>("[data-demo-row-title]")?.getBoundingClientRect();
      const labels = body.querySelector<HTMLElement>("[data-queue-labels]")?.getBoundingClientRect();
      if (title === undefined || labels === undefined || labels.width <= 1) continue;
      const name = body.querySelector<HTMLElement>("[data-demo-row-title]")?.textContent?.trim().slice(0, 40) ?? "";
      if (labels.top >= title.bottom || labels.bottom <= title.top) found.push(`the labels of "${name}" sit under the title, not on its line`);
      else if (labels.left < title.right) found.push(`the labels of "${name}" overlap the title`);
    }
    return found;
  });
}

/** Every page title is 20px, except inside Settings, where the operator asked on 2026-11-25 "the title needs to be bigger and more spacing between it and the bottom is needed": those are 28px. */
export function pageTitle20px({ page }: StateRuleContext): Promise<readonly string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const title of document.querySelectorAll<HTMLElement>(".ds-page-heading-title")) {
      if (title.getBoundingClientRect().width <= 1) continue;
      const expected = title.closest(".settings-takeover") === null ? "20px" : "28px";
      const size = getComputedStyle(title).fontSize;
      if (size !== expected) found.push(`the page title "${title.textContent?.trim().slice(0, 40) ?? ""}" is ${size}, not ${expected}`);
    }
    return found;
  });
}

/** Every rule. The check loop runs them in `STATE_RULE_NAMES` order: focus near the end because it moves focus, diagnostics last so late failures count. */
export const STATE_RULES: Readonly<Record<StateRuleName, { readonly check: StateRuleCheck; readonly failure: string }>> = Object.freeze({
  "fits-viewport": { check: fitsViewport, failure: "sideways scroll or clipped text at this size" },
  "no-banned-text": { check: noBannedText, failure: "text an operator must never read" },
  "word-limits": { check: wordLimits, failure: "titles, descriptions or errors over their word limit" },
  "toast-text-only": { check: toastTextOnly, failure: "a toast that holds more than text" },
  "toast-placement": { check: toastPlacement, failure: "a toast that is off top centre, outside the window or over the Sessions panel" },
  "skeleton-only-while-fetching": { check: skeletonOnlyWhileFetching, failure: "a skeleton outside a slow fetch or outside its fetching region" },
  "dialogs-share-shape": { check: dialogsShareShape, failure: "dialogs of one kind that differ in radius, border, title size or padding" },
  "primary-button-accent": { check: primaryButtonAccent, failure: "a primary button that is not the one accent" },
  "no-dead-disabled-control": { check: noDeadDisabledControl, failure: "a control shown switched off with nothing to choose" },
  "named-and-focusable": { check: namedAndFocusable, failure: "an interactive element with no name or no visible focus ring" },
  "status-label-on-title-line": { check: statusLabelOnTitleLine, failure: "a queue card whose status label wraps under the title" },
  "page-title-20px": { check: pageTitle20px, failure: "a page title that is not 20px (28px inside Settings)" },
  "declared-diagnostics": { check: declaredDiagnostics, failure: "console errors, page errors, failed requests or HTTP errors the story does not declare" },
});
