/**
 * A VIOLATING fixture for `duo-ceremony-lease.test.ts` (D267).
 *
 * This is the EXACT shape every store login recipe shipped before the lease:
 * one `flow` that navigates to the entry route and then drives the SSO form
 * and the Duo assertion itself, presenting no token anywhere. It is checked in
 * so the guard's walker is executed against a real violation — a scan that
 * resolved nothing would pass over the whole tree and report clean. The
 * helpers are declared locally (the real ones no longer type-check without a
 * token), which is also why this file can never be imported by the runtime.
 */
declare function defineVerifiedLoginRecipe(input: unknown): unknown;
declare function waitForSsoForm(system: string, context: unknown): Promise<void>;
declare function fillSsoCredentials(system: string, context: unknown): Promise<void>;
declare function submitSsoForm(system: string, context: unknown): Promise<void>;
declare function waitForAuthenticatedLanding(
  system: string,
  context: unknown,
  landed: (url: string) => boolean,
  timeoutMs: number,
): Promise<void>;

const SYSTEM = "onbase";

export const onbaseLoginRecipe = defineVerifiedLoginRecipe({
  system: SYSTEM,
  verify: async (): Promise<{ authenticated: false; reason: string }> => ({ authenticated: false, reason: "fixture" }),
  flow: async (context: { page: { goto: (url: string) => Promise<void> } }): Promise<string> => {
    await context.page.goto("https://onbase.example/login");
    await waitForSsoForm(SYSTEM, context);
    await fillSsoCredentials(SYSTEM, context);
    await submitSsoForm(SYSTEM, context);
    await waitForAuthenticatedLanding(SYSTEM, context, (url) => url.includes("/app"), 60_000);
    return "logged-in";
  },
});
