import { vi } from "vitest";
/** Queue facts use this shared primitive; a clipped paint must retain its full value. */
import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { createElement as createElement_m0,createElement as createElement_m1 } from "react";
import { renderToStaticMarkup as renderToStaticMarkup_m0,renderToStaticMarkup as renderToStaticMarkup_m1 } from "react-dom/server";
import { describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { Chip as Chip_m0,IconButton as IconButton_m1 } from "../../../src/dashboard/ds/ui.js";

import assert_m2 from "node:assert/strict";
import { createElement as createElement_m2 } from "react";
import { renderToStaticMarkup as renderToStaticMarkup_m2 } from "react-dom/server";
import { describe as describe_m2,it as it_m2 } from "vitest";
import { Banner as Banner_m2 } from "../../../src/dashboard/ds/ui.js";
// @vitest-environment jsdom
import assert_m3 from 'node:assert/strict';
import { act as act_m3,createElement as createElement_m3 } from 'react';
import { createRoot as createRoot_m3 } from 'react-dom/client';
import { it as it_m3 } from 'vitest';
import { PageBreadcrumbs as PageBreadcrumbs_m3 } from '../../../src/dashboard/ds/ui.js';


{


describe_m0("Chip — shared fact semantics", () => {
  it_m0("keeps the label, full hover value, and single-line clipping contract together", () => {
    const html = renderToStaticMarkup_m0(createElement_m0(
      Chip_m0,
      { children: "filed after signing", label: "ticket", title: "ticket filed after signing" },
    ));
    assert_m0.match(html, /ticket/u);
    assert_m0.match(html, /title="ticket filed after signing"/u);
    assert_m0.match(html, /whitespace-nowrap/u);
    assert_m0.match(html, /min-w-0 truncate/u);
  });
});
}

{


describe_m1("IconButton semantics", () => {
  it_m1("forwards the caller's class to the native button", () => {
    const html = renderToStaticMarkup_m1(createElement_m1(IconButton_m1, {
      size: "sm",
      className: "caller-owned-class",
      label: "Mark Jordan Reyes checked by you",
      icon: null,
    }));

    const openingButton = /^<button\b[^>]*>/u.exec(html)?.[0];
    assert_m1.ok(openingButton);
    assert_m1.match(openingButton, /class="[^"]*\bcaller-owned-class\b[^"]*"/u);
  });

  it_m1("uses the required label as the native button's accessible name", () => {
    const html = renderToStaticMarkup_m1(createElement_m1(IconButton_m1, {
      size: "sm",
      label: "Mark Jordan Reyes checked by you",
      icon: null,
    }));

    const openingButton = /^<button\b[^>]*>/u.exec(html)?.[0];
    assert_m1.ok(openingButton);
    assert_m1.match(openingButton, /aria-label="Mark Jordan Reyes checked by you"/u);
  });
});
}

{


function liveRegionClasses(markup: string, role: "alert" | "status"): string {
  const match = new RegExp(`<div class="([^"]+)"(?: [^>]*)? role="${role}"`, "u").exec(markup);
  assert_m2.ok(match?.[1] !== undefined, markup);
  return match[1];
}

describe_m2("the app-wide storage band", () => {

  it_m2("leaves every ordinary Banner on the bordered, rounded card shape", () => {
    const markup = renderToStaticMarkup_m2(createElement_m2(Banner_m2, { title: "Ordinary message" }));
    const classes = liveRegionClasses(markup, "status");

    assert_m2.match(classes, /(?:^| )border(?: |$)/u);
    assert_m2.match(classes, /rounded-\[var\(--ds-radius-md\)\]/u);
    assert_m2.doesNotMatch(classes, /(?:^| )border-b(?: |$)/u);
  });
});
}

{


const _beforeEachFixture0 = () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
};
const _afterEachFixture1 = () => vi.unstubAllGlobals();

it_m3('exposes the current page as text and leaves parent navigation with its guarded owner', async () => {
try {
_beforeEachFixture0();

  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot_m3(host);
  const parent = vi.fn(); const current = vi.fn();
  try {
    await act_m3(async () => root.render(createElement_m3(PageBreadcrumbs_m3, { label: 'Settings breadcrumbs', items: [
      { label: 'Dashboard', onClick: parent }, { label: 'Settings', onClick: current },
    ] })));
    assert_m3.equal(host.querySelector('nav')?.getAttribute('aria-label'), 'Settings breadcrumbs');
    const page = host.querySelector<HTMLElement>('[aria-current="page"]'); assert_m3(page);
    assert_m3.equal(page.textContent, 'Settings'); assert_m3.equal(page.getAttribute('role'), null);
    assert_m3.equal(page.tabIndex, -1); assert_m3.equal(host.querySelectorAll('button').length, 1);
    await act_m3(async () => host.querySelector('button')!.click());
    assert_m3.equal(parent.mock.calls.length, 1); assert_m3.equal(current.mock.calls.length, 0);
    assert_m3.equal(host.querySelector('[aria-current="page"]')?.textContent, 'Settings');
  } finally { await act_m3(async () => root.unmount()); host.remove(); }

} finally {
_afterEachFixture1();
}
});
}
