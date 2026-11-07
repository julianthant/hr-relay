
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
