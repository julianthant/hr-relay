/** These surfaces use the design system reference page for any dialogs they show.
 * Other surfaces share one worker for dialog kinds whose first story supplies the reference. */
export function usesIndependentDialogReferences(surface: string): boolean {
  return ["queue", "shell", "sign-in", "run-panel"].includes(surface);
}
