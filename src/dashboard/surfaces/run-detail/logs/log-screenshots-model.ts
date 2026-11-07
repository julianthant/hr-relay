import type { LogScreenshot } from "./log-feed-model.js";

export type CaptureMode = "width" | "whole" | "actual";
export function captureKindLabel(kind: LogScreenshot["kind"]): string {
  return kind === "fields" ? "Filled fields" : kind === "form" ? "Full form" : kind === "person" ? "Person record" : kind === "browser" ? "Browser" : "Screenshot";
}
export function captureGeometry(capture: Pick<LogScreenshot, "width" | "height">, viewport: { width: number; height: number }, mode: CaptureMode, zoom: number | undefined, rotation: number) {
  if (![capture.width, capture.height].every(value => Number.isFinite(value) && value > 0)) throw new Error("log-screenshot-invalid-dimensions");
  const turned = rotation % 180 !== 0;
  const width = turned ? capture.height : capture.width;
  const height = turned ? capture.width : capture.height;
  const availableWidth = Math.max(1, viewport.width - 32);
  const availableHeight = Math.max(1, viewport.height - 32);
  const scale = zoom ?? (mode === "actual" ? 1 : mode === "whole" ? Math.min(availableWidth / width, availableHeight / height) : availableWidth / width);
  return { scale, width: width * scale, height: height * scale, imageWidth: capture.width * scale, imageHeight: capture.height * scale };
}
export function captureLoadProblem(capture: LogScreenshot, actual: { width: number; height: number }): string | undefined {
  return actual.width === capture.width && actual.height === capture.height ? undefined : `Screenshot dimensions differ: expected ${capture.width} × ${capture.height}, received ${actual.width} × ${actual.height}.`;
}

/** Measure the decoded source independently of its rendered preview. */
export async function captureSourceDimensions(src: string): Promise<{ width: number; height: number }> {
  const image = new Image();
  image.src = src;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}
