export interface DryRunPreviewStage {
  id: string;
  label: string;
  state: "exercised" | "not-clicked" | "unavailable" | "skipped";
  detail: string;
}
