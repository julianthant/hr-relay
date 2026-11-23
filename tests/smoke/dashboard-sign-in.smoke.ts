import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";
import { FIXTURE_LOGIN, startSignedOut } from "../support/helpers/dashboard/served-fixtures/seeded-signed-out.js";

test("wrong password clears on Sign up and a successful login reveals the complete dashboard", async ({ dashboard, page, seeded }, testInfo) => {
  const signIn = Promise.withResolvers<void>();
  const boot = Promise.withResolvers<void>();
  await startSignedOut(page, signIn.promise);
  await page.route("**/api/v1/bootstrap", async route => {
    await boot.promise;
    await route.continue();
  });
  const url = new URL("/", seeded.baseUrl);
  url.searchParams.set("day", seeded.day);
  const signInError = page.getByRole("alert").filter({ hasText: "That email and password did not match a profile on this computer." });
  const password = page.getByLabel("Password", { exact: true });
  const submit = page.getByRole("button", { name: "Log in", exact: true });
  try {
    await page.goto(url.toString());
    await expect(page.getByRole("heading", { name: "Log in to Relay" })).toBeVisible();
    await page.getByLabel("Work email").fill(FIXTURE_LOGIN.email);
    await password.fill("wrong-password");
    await submit.click();
    await expect(signInError).toBeVisible();
    await page.getByRole("link", { name: "Sign up" }).click();
    await expect(page.getByRole("heading", { name: "Create your profile" })).toBeVisible();
    await expect(signInError).toHaveCount(0);
    await page.getByRole("link", { name: "Log in" }).click();
    await expect(signInError).toHaveCount(0);

    await page.getByLabel("Work email").fill(FIXTURE_LOGIN.email);
    await password.fill(FIXTURE_LOGIN.password);
    await submit.click();
    const waiting = page.getByRole("button", { name: "Logging in…" });
    await expect(waiting).toBeDisabled();
    await expect(waiting).toHaveAttribute("aria-busy", "true");

    const loader = page.getByRole("status", { name: "Starting Relay" });
    const row = `[data-demo-row-id="${dashboard.runId("doneRun")}"]`;
    signIn.resolve();
    await expect(loader).toBeVisible();
    await expect(dashboard.sidebar).toBeHidden();
    const frames = await page.evaluateHandle(queueRow => {
      const frames: { loader: boolean; ready: boolean; skeleton: boolean }[] = [];
      let readyFrames = 0;
      const visible = (selector: string) => [...document.querySelectorAll(selector)].some(node =>
        node.getClientRects().length > 0 && getComputedStyle(node).visibility === "visible");
      const record = () => {
        const ready = visible(queueRow);
        if (ready) readyFrames += 1;
        frames.push({ loader: visible("[data-startup-loading]"), ready,
          skeleton: visible('[data-slot="skeleton"], [data-loading-layout]') });
        if (readyFrames < 2) requestAnimationFrame(record);
      };
      record();
      return frames;
    }, row);
    try {
      boot.resolve();
      await expect(dashboard.queue.locator(row)).toBeVisible();
      await expect.poll(() => frames.evaluate(samples => samples.filter(sample => sample.ready).length)).toBeGreaterThanOrEqual(2);
    } finally {
      await testInfo.attach("sign-in startup frames", { body: JSON.stringify(await frames.jsonValue()), contentType: "application/json" });
    }
    const samples = await frames.jsonValue();
    expect(samples[0]).toMatchObject({ loader: true, ready: false });
    const revealed = samples.filter(frame => !frame.loader);
    expect(revealed.length).toBeGreaterThanOrEqual(2);
    expect(revealed.every(frame => frame.ready && !frame.skeleton), "every frame after the loader contains the finished queue").toBe(true);
  } finally {
    signIn.resolve();
    boot.resolve();
  }
});
