/** What every Spreadsheets story mounts: the real page on the in-page library server. */
import { DashboardClientProvider } from "../../../../../../src/dashboard/state/client-context.js";
import { SheetsV2 } from "../../../../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2.js";
import type { SheetsStoryServer } from "../../../../fixtures/dashboard/spreadsheets-story-fixtures.js";
import { StoryFrame } from "./story-frame.js";

export function SpreadsheetsHost({ server }: { server: SheetsStoryServer }) {
  return <StoryFrame><DashboardClientProvider client={server.client}><main className="min-h-0 flex-1 overflow-y-auto px-8 py-6"><SheetsV2 /></main></DashboardClientProvider></StoryFrame>;
}
