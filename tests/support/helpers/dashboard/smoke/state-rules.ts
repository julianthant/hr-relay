/** The operator's rules for every dashboard state. Each rule is one named function that returns what it found
 * wrong, with its own failure message; the check loop runs all of them on every story. */
import type { Page } from "@playwright/test";
import { BANNED_PATTERNS, BANNED_PHRASES, BANNED_TERMS, WORD_LIMITS, type StateRuleName } from "./state-rule-limits.js";
import type { Story } from "./story-catalogue.js";

export interface StateRuleContext {
  readonly page: Page;
  readonly storyId: string;
  readonly story: Story;
  /** Everything `watchPageDiagnostics` recorded while the story rendered. */
  readonly diagnostics: readonly string[];
  /** Dialog shapes seen so far in this run, by kind, so one kind is compared across stories. */
  readonly dialogShapes: Map<string, { readonly storyId: string; readonly shape: string }>;
}

type StateRuleCheck = (context: StateRuleContext) => Promise<readonly string[]>;

const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

export function declaredDiagnostics({ story, diagnostics }: StateRuleContext): Promise<readonly string[]> {
  const declared = story.expects ?? [];
  return Promise.resolve(diagnostics.filter(entry => !declared.some(({ pattern }) => pattern.test(entry))));
}

export function fitsViewport({ page }: StateRuleContext): Promise<readonly string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const scroller = document.scrollingElement ?? document.documentElement;
    const sideways = scroller.scrollWidth - scroller.clientWidth;
    if (sideways > 0) found.push(`the page scrolls sideways by ${String(sideways)}px`);
    const clips = (value: string) => value === "hidden" || value === "clip";
    const scrolls = (value: string) => value === "auto" || value === "scroll";
    for (const element of document.querySelectorAll<HTMLElement>("#root *")) {
      const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent ?? "").join("").trim();
      if (text === "") continue;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      // A 1px box is the screen-reader-only pattern: read aloud, never drawn.
      if (style.visibility === "hidden" || box.width <= 1 || box.height <= 1) continue;
      const label = `"${text.slice(0, 60)}"`;
      if (box.right > window.innerWidth + 1) found.push(`${label} runs ${String(Math.round(box.right - window.innerWidth))}px past the right edge`);
      if (clips(style.overflowX) && element.scrollWidth > element.clientWidth + 1) { found.push(`${label} is cut off sideways`); continue; }
      if (clips(style.overflowY) && element.scrollHeight > element.clientHeight + 1) { found.push(`${label} is cut off at the bottom`); continue; }
      let checkX = true;
      let checkY = true;
      for (let ancestor = element.parentElement; ancestor !== null && ancestor.id !== "root" && (checkX || checkY); ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        const frame = ancestor.getBoundingClientRect();
        if (checkX && clips(ancestorStyle.overflowX) && (box.right > frame.right + 1 || box.left < frame.left - 1)) { found.push(`${label} is cut off sideways by its container`); break; }
        if (checkY && clips(ancestorStyle.overflowY) && (box.bottom > frame.bottom + 1 || box.top < frame.top - 1)) { found.push(`${label} is cut off by its container's height`); break; }
        // Content below a scrolling container's edge is reachable by scrolling, not clipped.
        if (scrolls(ancestorStyle.overflowX)) checkX = false;
        if (scrolls(ancestorStyle.overflowY)) checkY = false;
      }
    }
    return found;
  });
}

export async function noBannedText({ page }: StateRuleContext): Promise<readonly string[]> {
  const texts = await page.evaluate(() => {
    const root = document.getElementById("root");
    if (root === null) throw new Error("the gallery page has no #root");
    const lines = root.innerText.split("\n");
    for (const element of root.querySelectorAll("[aria-label], [title], [placeholder], [alt]")) {
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
      for (const element of document.querySelectorAll<HTMLElement>(`#root :is(${selector})`)) {
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
    const drawn = (element: Element) => { const box = element.getBoundingClientRect(); return box.width > 1 && box.height > 1; };
    const chrome = [...document.querySelectorAll('[role="toolbar"], h1, h2, h3, [data-slot$="title"]')]
      .filter(element => drawn(element) && element.closest('[data-slot="toast"]') === null);
    for (const toast of document.querySelectorAll<HTMLElement>('[data-slot="toast"]')) {
      if (!drawn(toast)) continue;
      const label = `the toast "${toast.innerText.trim().slice(0, 60)}"`;
      const extras = toast.querySelectorAll("button, a[href], input, select, textarea, img, video");
      if (extras.length > 0) found.push(`${label} holds ${String(extras.length)} control or image; a toast is text only`);
      const box = toast.getBoundingClientRect();
      for (const element of chrome) {
        const other = element.getBoundingClientRect();
        if (box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom) {
          found.push(`${label} covers ${element.matches('[role="toolbar"]') ? "a toolbar" : `the title "${(element.textContent ?? "").trim().slice(0, 40)}"`}`);
        }
      }
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

export async function dialogsShareShape({ page, storyId, dialogShapes }: StateRuleContext): Promise<readonly string[]> {
  const dialogs = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')]
    .filter(dialog => dialog.getBoundingClientRect().width > 1)
    .map(dialog => {
      const style = getComputedStyle(dialog);
      const title = dialog.querySelector('h1, h2, h3, [data-slot$="title"]');
      return {
        kind: [dialog.getAttribute("role"), dialog.getAttribute("data-size") ?? dialog.getAttribute("data-slot") ?? ""].join(":"),
        shape: `radius ${style.borderRadius}; border ${style.borderTopWidth} ${style.borderTopColor}; padding ${style.padding}; `
          + `title size ${title === null ? "none" : getComputedStyle(title).fontSize}`,
      };
    }));
  const found: string[] = [];
  for (const { kind, shape } of dialogs) {
    const first = dialogShapes.get(kind);
    if (first === undefined) dialogShapes.set(kind, { storyId, shape });
    else if (first.shape !== shape) found.push(`a ${kind} dialog is drawn with ${shape}, but ${first.storyId} draws it with ${first.shape}`);
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
    const found: string[] = [];
    for (const button of document.querySelectorAll<HTMLElement>('#root :is(button, [role="button"], a[data-slot="button"])')) {
      const box = button.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      const fill = rgba(getComputedStyle(button).backgroundColor);
      // A primary button is the loud one: a solid fill that stands out from the page.
      if (fill[3] < 250 || contrast(fill, canvasSurface) < 3) continue;
      if (fill.some((channel, index) => Math.abs(channel - (accent[index] ?? 0)) > 2)) {
        found.push(`the button "${(button.getAttribute("aria-label") ?? button.innerText).trim().slice(0, 40)}" is filled rgb(${fill.slice(0, 3).join(", ")}), `
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
    for (const control of document.querySelectorAll<HTMLElement>('#root :is(select, [role="combobox"], [aria-haspopup])')) {
      if (!disabled(control) || control.getBoundingClientRect().width <= 1) continue;
      if (control instanceof HTMLSelectElement && [...control.options].filter(option => !option.disabled).length > 1) continue;
      found.push(`the picker "${name(control)}" is shown switched off with nothing to choose`);
    }
    for (const group of document.querySelectorAll('#root :is([role="radiogroup"], [role="group"], fieldset)')) {
      const choices = [...group.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"], [role="switch"]')];
      if (choices.length > 0 && choices.every(disabled)) found.push(`every choice in "${name(group)}" is switched off`);
    }
    return found;
  });
}

export async function namedAndFocusable({ page }: StateRuleContext): Promise<readonly string[]> {
  // A key press puts the page in keyboard mode, where focus rings are drawn.
  await page.keyboard.press("Shift");
  return page.evaluate(() => {
    const found: string[] = [];
    // Focus styles ease in; measure where they settle.
    const still = document.createElement("style");
    still.textContent = "* { transition: none !important; }";
    document.head.append(still);
    const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="checkbox"], '
      + '[role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="combobox"], [tabindex]:not([tabindex="-1"])';
    const textOf = (id: string) => document.getElementById(id)?.textContent ?? "";
    const look = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return { outline: style.outlineStyle === "none" || Number.parseFloat(style.outlineWidth) === 0 ? "none" : `${style.outlineWidth} ${style.outlineColor}`,
        shadow: style.boxShadow, border: style.borderColor, fill: style.backgroundColor };
    };
    for (const element of document.querySelectorAll<HTMLElement>(`#root :is(${selector})`)) {
      const box = element.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1 || element.matches(':disabled, [aria-disabled="true"]') || element.closest("[inert]") !== null) continue;
      const labels = element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
        ? [...(element.labels ?? [])].map(label => label.textContent ?? "") : [];
      const name = [element.getAttribute("aria-label"), (element.getAttribute("aria-labelledby") ?? "").split(/\s+/u).map(textOf).join(" "),
        element.innerText, element.getAttribute("title"), element.getAttribute("placeholder"), ...labels,
        ...[...element.querySelectorAll("img[alt], svg[aria-label]")].map(image => image.getAttribute("alt") ?? image.getAttribute("aria-label"))]
        .map(part => (part ?? "").trim()).find(part => part !== "");
      const label = name === undefined ? `<${element.tagName.toLowerCase()} class="${element.className.slice(0, 60)}">` : `"${name.slice(0, 40)}"`;
      if (name === undefined) found.push(`${label} has no name`);
      const before = look(element);
      element.focus({ preventScroll: true });
      if (document.activeElement !== element) { found.push(`${label} cannot take keyboard focus`); continue; }
      const after = look(element);
      element.blur();
      // The dashboard marks keyboard focus with its focus fill (DESIGN.md); an outline, shadow or edge change also counts.
      const ring = after.outline !== "none" || after.shadow !== before.shadow || after.border !== before.border || after.fill !== before.fill;
      if (!ring) found.push(`${label} shows no focus ring`);
    }
    still.remove();
    return found;
  });
}

/** Every rule, in the order the check loop runs them. The focus rule runs last because it moves focus. */
export const STATE_RULES: Readonly<Record<StateRuleName, { readonly check: StateRuleCheck; readonly failure: string }>> = Object.freeze({
  "declared-diagnostics": { check: declaredDiagnostics, failure: "console errors, page errors, failed requests or HTTP errors the story does not declare" },
  "fits-viewport": { check: fitsViewport, failure: "sideways scroll or clipped text at this size" },
  "no-banned-text": { check: noBannedText, failure: "text an operator must never read" },
  "word-limits": { check: wordLimits, failure: "titles, descriptions or errors over their word limit" },
  "toast-text-only": { check: toastTextOnly, failure: "a toast that holds more than text or covers a toolbar or title" },
  "skeleton-only-while-fetching": { check: skeletonOnlyWhileFetching, failure: "a skeleton outside a slow fetch or outside its fetching region" },
  "dialogs-share-shape": { check: dialogsShareShape, failure: "dialogs of one kind that differ in radius, border, title size or padding" },
  "primary-button-accent": { check: primaryButtonAccent, failure: "a primary button that is not the one accent" },
  "no-dead-disabled-control": { check: noDeadDisabledControl, failure: "a control shown switched off with nothing to choose" },
  "named-and-focusable": { check: namedAndFocusable, failure: "an interactive element with no name or no visible focus ring" },
});
