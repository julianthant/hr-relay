import assert from "node:assert/strict";
import type { Page } from "playwright";
import { describe, it } from "vitest";
import { withBrowserActionNotes, type BrowserAction } from "../../../../../src/backend/systems/browser-shared/action-notes.js";
import { createKualiRrssDocumentDriver } from "../../../../../src/backend/systems/kuali/driver/interpreter.js";
import { KUALI_RRSS_SAVE_BUTTON } from "../../../../../src/models/ui/kuali-rrss-document.js";
import type { MutationCapability } from "../../../../../src/models/ui/driver.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";

describe("Kuali current session effects", () => {
  it("refuses the click after revocation during the first field fill", async () => {
    let current = true;
    const events: string[] = [];
    const control = {
      first: () => control,
      waitFor: async () => undefined,
      count: async () => 1,
      fill: async () => { events.push("fill"); current = false; },
      click: async () => { events.push("click"); },
    };
    const page = { goto: async () => null, getByRole: () => control } as unknown as Page;
    const driver = createKualiRrssDocumentDriver(() => {
      if (!current) throw new Error("session revoked");
    }, page, systemClock);

    const captured: BrowserAction[] = [];
    const stalePublications: BrowserAction[] = [];
    await assert.rejects(withBrowserActionNotes(systemClock,
      () => driver.readActionListForDocument({ documentNumber: "123456" }),
      actions => { captured.push(...actions); },
      action => { if (!current) stalePublications.push(action); }), /session revoked/u);
    assert.deepEqual(events, ["fill"]);
    assert.deepEqual(stalePublications, []);
    assert.deepEqual(captured.map(action => action.kind), ["opened"]);
  });

  it("requires the sequencer's minted capability before browser access", async () => {
    let accessed = false;
    const page = { getByRole: () => { accessed = true; throw new Error("unexpected browser access"); } } as unknown as Page;
    const driver = createKualiRrssDocumentDriver(() => undefined, page, systemClock);
    await assert.rejects(driver.commit(KUALI_RRSS_SAVE_BUTTON, {} as MutationCapability), /not minted/u);
    assert.equal(accessed, false);
  });
});
