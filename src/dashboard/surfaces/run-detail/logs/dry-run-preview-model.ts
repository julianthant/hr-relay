export interface DryRunPreviewStage {
  id: string;
  label: string;
  state: "exercised" | "unavailable" | "skipped";
  detail: string;
  sample?: { label: string; value: string };
}
