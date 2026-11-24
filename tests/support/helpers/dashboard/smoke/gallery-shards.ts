/** These story groups use the design system reference page for any dialogs they show.
 * Other groups share one worker for dialog kinds whose first story supplies the reference. */
export function usesIndependentDialogReferences(storyId: string): boolean {
  const [surface, group] = storyId.split("/");
  if (surface === "shell") return group !== "filter" && group !== "search";
  return ["queue", "sign-in", "run-panel", "analytics", "assistant"].includes(surface);
}
