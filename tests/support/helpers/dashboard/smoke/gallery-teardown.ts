import { existsSync } from "node:fs";
import { DESKTOP_VIEWPORTS } from "./dashboard-page.js";
import { STATE_FRAMES_DIR, writeStateFrameIndex } from "./gallery-fixtures.js";
import { CATALOGUE } from "./stories/catalogue.js";

export default function writeGalleryIndex(): void {
  if (existsSync(STATE_FRAMES_DIR)) writeStateFrameIndex(CATALOGUE, DESKTOP_VIEWPORTS.map(viewport => viewport.width));
}
