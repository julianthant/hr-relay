import assert from "node:assert/strict";
import { it } from "vitest";
import { withBrowserActionNotes, type BrowserAction } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { BrowserLandingStallError, BrowserLoginError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { fillSsoCredentials, submitSsoForm, waitForAuthenticatedLanding } from "../../../../src/backend/systems/browser-shared/ucsd-sso.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createSystemSessionTestWorld } from "../../../support/helpers/backend/system-session-world.js";

const { contextFor, NO_SIGN_IN_FORMS } = createSystemSessionTestWorld();
const CONTINUE = 'input[type="submit"][value*="Continue Log In"], button:has-text("Continue Log In")';
const REMINDER = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";
const BRIDGE = "https://a5.ucsd.edu/continuing";
const APPLICATION = "https://application.example.invalid/home";

async function reminderWorld(repeated: boolean, host = "a5.ucsd.edu", signal = new AbortController().signal) {
  const reminder = new URL(REMINDER);
  reminder.hostname = host;
  const { context, harness } = await contextFor({
    url: reminder.href,
    elements: { ...NO_SIGN_IN_FORMS, "training-reminder": { navigatesTo: repeated ? BRIDGE : APPLICATION } },
    elementsByUrl: { [BRIDGE]: { ...NO_SIGN_IN_FORMS, "training-reminder": { count: 0 } }, [APPLICATION]: { ...NO_SIGN_IN_FORMS, "training-reminder": { count: 0 } } },
  }, signal);
  const budgets: number[] = [];
  let finishLanding: (() => void) | undefined;
  let rejectLanding: ((error: Error) => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  context.page.waitForURL = async (predicate, options) => {
    budgets.push(options?.timeout ?? 0);
    await new Promise<void>((resolve, reject) => {
      finishLanding = () => {
        if (typeof predicate === "function" && predicate(new URL(harness.url()))) resolve();
      };
      rejectLanding = reject;
      deadline = setTimeout(() => reject(new Error("fixture landing deadline")), 100);
    });
  };
  const originalLocator = context.page.locator.bind(context.page);
  context.page.locator = (selector, options) => {
    const locator = originalLocator(selector, options);
    if (selector !== CONTINUE) return locator;
    const originalClick = locator.click.bind(locator);
    locator.click = async options => {
      await originalClick(options);
      finishLanding?.();
    };
    const originalWait = locator.waitFor.bind(locator);
    locator.waitFor = async options => {
      if (options?.state === "hidden") {
        assert.equal(await locator.count(), 0, "the first control must disappear before recurrence");
        if (repeated) await context.page.goto(reminder.href);
        return;
      }
      return originalWait(options);
    };
    return locator;
  };
  const run = () => context.duoCeremony.withCeremony(token => waitForAuthenticatedLanding(
    "ucpath", { ...context, acquisitionRemainingMs: () => 600 }, token,
    url => url === APPLICATION, 60_000,
  ));
  const cleanup = () => {
    clearTimeout(deadline);
    rejectLanding?.(new Error("fixture closed"));
  };
  const land = async () => {
    await context.page.goto(APPLICATION);
    finishLanding?.();
  };
  return { run, cleanup, harness, budgets, context, land };
}

it("continues the visible UCSD training reminder once inside the original landing wait and records no value", async () => {
  const world = await reminderWorld(false);
  let actions: readonly BrowserAction[] = [];
  try {
    await withBrowserActionNotes(manualClock(new Date("2026-08-03T09:00:00Z")), world.run, captured => { actions = captured; });
    assert.equal(world.harness.url(), APPLICATION);
    assert.deepEqual(world.harness.actions(), ["click:training-reminder"]);
    assert.deepEqual(world.budgets, [300]);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.kind, "clicked");
    assert.equal(actions[0]?.targetId, "ucsd.sso.training-reminder-continue");
    assert.equal(Object.hasOwn(actions[0], "value"), false);
  } finally { world.cleanup(); }
});

it("refuses a second UCSD training reminder appearance with its fixed stall code after one click", async () => {
  const world = await reminderWorld(true);
  try {
    await assert.rejects(world.run(), error => {
      assert.ok(error instanceof BrowserLandingStallError);
      assert.equal(error.code, "TRAINING_REMINDER_REPEATED");
      assert.match(error.message, /The UCSD training reminder appeared again after Continue Log In/);
      return true;
    });
    assert.deepEqual(world.harness.actions().filter(action => action.startsWith("click:")), ["click:training-reminder"]);
    assert.deepEqual(world.budgets, [300]);
  } finally { world.cleanup(); }
});

it("does not continue a matching training control on a different host", async () => {
  const world = await reminderWorld(false, "a5.ucsd.edu.example.invalid");
  try {
    await assert.rejects(world.run(), error => {
      assert.ok(error instanceof BrowserLandingStallError);
      assert.equal(error.code, "AUTHENTICATED_LANDING_MISSING");
      return true;
    });
    assert.deepEqual(world.harness.actions(), []);
  } finally { world.cleanup(); }
});

for (const settlement of ["landing", "cancellation"] as const) {
  it(`does not click a reminder that becomes visible after ${settlement} settles`, async () => {
    const controller = new AbortController();
    const world = await reminderWorld(false, "a5.ucsd.edu", controller.signal);
    let showReminder: (() => void) | undefined;
    let markWaiting: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { markWaiting = resolve; });
    const originalLocator = world.context.page.locator.bind(world.context.page);
    world.context.page.locator = (selector, options) => {
      const locator = originalLocator(selector, options);
      if (selector === CONTINUE) locator.waitFor = async () => {
        await new Promise<void>(resolve => { showReminder = resolve; markWaiting?.(); });
      };
      return locator;
    };
    try {
      const run = world.run();
      const settled = settlement === "cancellation"
        ? assert.rejects(run, error => error instanceof BrowserLoginError && /cancelled/.test(error.detail))
        : run;
      await waiting;
      assert.ok(showReminder);
      if (settlement === "cancellation") controller.abort();
      else await world.land();
      await settled;
      showReminder();
      await Promise.resolve();
      assert.deepEqual(world.harness.actions().filter(action => action.startsWith("click:")), []);
    } finally { world.cleanup(); }
  });
}

it("reports a training reminder click failure explicitly without a retry or action value", async () => {
  const world = await reminderWorld(false);
  const originalLocator = world.context.page.locator.bind(world.context.page);
  world.context.page.locator = (selector, options) => {
    const locator = originalLocator(selector, options);
    if (selector === CONTINUE) locator.click = async () => { throw new Error("fixture click failed"); };
    return locator;
  };
  try {
    await assert.rejects(world.run(), error => error instanceof BrowserLoginError
      && /Continue Log In control could not be clicked/.test(error.detail));
    assert.deepEqual(world.harness.actions(), []);
  } finally { world.cleanup(); }
});

it("refuses a same-URL reminder replacement even when the control never appears hidden", async () => {
  const { context, harness } = await contextFor({
    url: REMINDER,
    elements: { ...NO_SIGN_IN_FORMS, "training-reminder": { navigatesTo: REMINDER } },
  });
  const originalLocator = context.page.locator.bind(context.page);
  context.page.locator = (selector, options) => {
    const locator = originalLocator(selector, options);
    const originalWait = locator.waitFor.bind(locator);
    if (selector === CONTINUE) locator.waitFor = async options => {
      if (options?.state === "hidden") throw new Error("fixture control never becomes hidden");
      return originalWait(options);
    };
    return locator;
  };
  let deadline: ReturnType<typeof setTimeout> | undefined;
  context.page.waitForURL = async (_predicate, options) => await new Promise<void>((_resolve, reject) => {
    deadline = setTimeout(() => reject(new Error("fixture landing deadline")), options?.timeout);
  });
  try {
    await assert.rejects(context.duoCeremony.withCeremony(token => waitForAuthenticatedLanding(
      "ucpath", { ...context, acquisitionRemainingMs: () => 600 }, token,
      url => url === APPLICATION, 60_000,
    )), error => error instanceof BrowserLandingStallError && error.code === "TRAINING_REMINDER_REPEATED");
    assert.deepEqual(harness.actions(), ["click:training-reminder"]);
  } finally { clearTimeout(deadline); }
});

for (const settlement of ["landing", "cancellation"] as const) {
  it(`drains an active reminder click before ${settlement} releases the action scope`, async () => {
    const controller = new AbortController();
    const world = await reminderWorld(false, "a5.ucsd.edu", controller.signal);
    let releaseClick: (() => void) | undefined;
    const clickSettlement = new Promise<void>(resolve => { releaseClick = resolve; });
    let markClickStarted: (() => void) | undefined;
    const clickStarted = new Promise<void>(resolve => { markClickStarted = resolve; });
    const originalLocator = world.context.page.locator.bind(world.context.page);
    world.context.page.locator = (selector, options) => {
      const locator = originalLocator(selector, options);
      const originalClick = locator.click.bind(locator);
      if (selector === CONTINUE) locator.click = async options => {
        await originalClick(options);
        markClickStarted?.();
        await clickSettlement;
      };
      return locator;
    };
    let drained = false;
    let settled = false;
    let actions: readonly BrowserAction[] = [];
    const run = withBrowserActionNotes(manualClock(new Date("2026-08-03T09:00:00Z")), world.run, captured => {
      actions = captured;
      drained = true;
    }).finally(() => { settled = true; });
    const checked = settlement === "cancellation"
      ? assert.rejects(run, error => error instanceof BrowserLoginError && /cancelled/.test(error.detail))
      : run;
    try {
      await clickStarted;
      if (settlement === "cancellation") controller.abort();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(settled, false, "an initiated click is still owned by the landing wait");
      assert.equal(drained, false, "action notes must stay open until click completion");
      releaseClick?.();
      await checked;
      assert.equal(actions.length, 1);
      assert.equal(actions[0]?.targetId, "ucsd.sso.training-reminder-continue");
      assert.equal(Object.hasOwn(actions[0], "value"), false);
      assert.deepEqual(world.harness.actions(), ["click:training-reminder"]);
    } finally {
      releaseClick?.();
      await checked.catch(() => undefined);
      world.cleanup();
    }
  });
}

it("does not retarget an initiated click to a control in a replacement document", async () => {
  const world = await reminderWorld(false);
  let releaseClick: (() => void) | undefined;
  const actionable = new Promise<void>(resolve => { releaseClick = resolve; });
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const originalLocator = world.context.page.locator.bind(world.context.page);
  world.context.page.locator = (selector, options) => {
    const locator = originalLocator(selector, options);
    if (selector !== CONTINUE) return locator;
    const originalClick = locator.click.bind(locator);
    locator.click = async options => {
      markStarted?.();
      await actionable;
      await originalClick(options);
    };
    const originalHandle = locator.elementHandle.bind(locator);
    locator.elementHandle = async options => {
      const handle = await originalHandle(options);
      assert.ok(handle);
      const boundClick = handle.click.bind(handle);
      handle.click = async options => {
        markStarted?.();
        await actionable;
        await boundClick(options);
      };
      return handle;
    };
    return locator;
  };
  const checked = assert.rejects(world.run(), error => error instanceof BrowserLoginError
    && /Continue Log In control could not be clicked/.test(error.detail)
    && error.cause instanceof Error && /original element detached/.test(error.cause.message));
  try {
    await started;
    await world.context.page.goto("https://other.example.invalid/reminder");
    releaseClick?.();
    await checked;
    assert.deepEqual(world.harness.actions().filter(action => action.startsWith("click:")), []);
  } finally {
    releaseClick?.();
    await checked.catch(() => undefined);
    world.cleanup();
  }
});

it("drains a timed-out active click within its original budget and retains cancellation plus click failure", async () => {
  const controller = new AbortController();
  const world = await reminderWorld(false, "a5.ucsd.edu", controller.signal);
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const originalLocator = world.context.page.locator.bind(world.context.page);
  world.context.page.locator = (selector, options) => {
    const locator = originalLocator(selector, options);
    if (selector === CONTINUE) locator.click = async options => {
      assert.ok(options?.timeout && options.timeout > 0 && options.timeout <= 300);
      markStarted?.();
      await new Promise<void>((_resolve, reject) => {
        setTimeout(() => reject(new Error("fixture click deadline")), options.timeout);
      });
    };
    return locator;
  };
  let actions: readonly BrowserAction[] = [];
  const checked = assert.rejects(withBrowserActionNotes(manualClock(new Date("2026-08-03T09:00:00Z")), world.run,
    captured => { actions = captured; }), error => error instanceof BrowserLoginError
    && /cancelled/.test(error.detail) && error.cause instanceof AggregateError
    && error.cause.errors.some(cause => cause instanceof BrowserLoginError
      && /Continue Log In control could not be clicked/.test(cause.detail)));
  try {
    await started;
    controller.abort();
    await checked;
    assert.deepEqual(actions, []);
    assert.deepEqual(world.harness.actions(), []);
  } finally { world.cleanup(); }
});

it("retains both click and bound-element disposal failures", async () => {
  const world = await reminderWorld(false);
  const originalLocator = world.context.page.locator.bind(world.context.page);
  world.context.page.locator = (selector, options) => {
    const locator = originalLocator(selector, options);
    const originalHandle = locator.elementHandle.bind(locator);
    if (selector === CONTINUE) locator.elementHandle = async options => {
      const handle = await originalHandle(options);
      assert.ok(handle);
      handle.click = async () => { throw new Error("fixture click failed"); };
      handle.dispose = async () => { throw new Error("fixture disposal failed"); };
      return handle;
    };
    return locator;
  };
  try {
    await assert.rejects(world.run(), error => error instanceof BrowserLoginError
      && error.cause instanceof AggregateError
      && error.cause.errors.some(cause => cause instanceof Error && cause.message === "fixture click failed")
      && error.cause.errors.some(cause => cause instanceof Error && cause.message === "fixture disposal failed"));
    assert.deepEqual(world.harness.actions(), []);
  } finally { world.cleanup(); }
});


for (const revokeAfterUsername of [false, true]) {
  it(`fences the next credential action after username fill (revoked: ${revokeAfterUsername})`, async () => {
    const { context, harness } = await contextFor({ url: REMINDER });
    let current = true;
    const refusal = new Error("fixture browser owner revoked");
    const guarded = { ...context, assertCurrent: () => { if (!current) throw refusal; } };
    const originalLocator = context.page.locator.bind(context.page);
    context.page.locator = (selector, options) => {
      const locator = originalLocator(selector, options);
      if (selector.includes("ssousername")) {
        const fill = locator.fill.bind(locator);
        locator.fill = async (value, options) => {
          await fill(value, options);
          if (revokeAfterUsername) current = false;
        };
      }
      return locator;
    };
    const operation = context.duoCeremony.withCeremony(async token => {
      await fillSsoCredentials("ucpath", guarded, token);
      await submitSsoForm("ucpath", guarded, token);
    });
    if (revokeAfterUsername) await assert.rejects(operation, error => error === refusal);
    else await operation;
    assert.equal(harness.filled().length, revokeAfterUsername ? 1 : 2);
    assert.deepEqual(harness.actions(), revokeAfterUsername ? [] : ["click:sso-submit"]);
  });
}
