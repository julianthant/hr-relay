import type { AssistantFailureCode } from "../../../../src/models/dashboard/assistant.js";
import type { JsonValue } from "../../../../src/rules/validation/canonical-json.js";

type Call = Readonly<{ tool: string; args: JsonValue }>;
type EditScenario = Readonly<{ name: string; message: string; calls: readonly Call[]; largestRequest: number; total: number;
  refusal?: AssistantFailureCode; changeWorkbookAfterRead?: boolean; maskedSource?: string; expectedLink?: string; expectedName?: string }>;

const readSheet = { tool: "read_spreadsheets", args: { view: "list", sheet: null, limit: 5 } } as const;
const readSetting = { tool: "read_settings", args: { key: "browser.headless" } } as const;
const sharePointUrl = "https://example.sharepoint.com/sites/hr/Tracker.xlsx";
const quotedName = 'Tracker "West" \\ Archive';

// Budgets leave roughly ten percent above the served scenario measurements.
export const editScenarios = [{
  name: "Rename a workbook",
  message: "Rename the only spreadsheet to Summer tracker.",
  calls: [readSheet, { tool: "change_spreadsheet", args: { change: { action: "rename", sheet: "[[S1.g1]]", source: "Summer tracker" } } }],
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Save a setting",
  message: "Turn headless browser mode off.",
  calls: [readSetting, { tool: "change_settings", args: { key: "browser.headless", operation: "disable", source: "off" } }],
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Refuse a missing source",
  refusal: "ASSISTANT_VALUE_NEEDS_SOURCE",
  message: "Rename the only spreadsheet to a new name.",
  calls: [readSheet, { tool: "change_spreadsheet", args: { change: { action: "rename", sheet: "[[S1.g1]]", source: null } } }],
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Refuse a stale workbook read",
  message: "Rename the only spreadsheet to Winter tracker.",
  calls: [readSheet, { tool: "change_spreadsheet", args: { change: { action: "rename", sheet: "[[S1.g1]]", source: "Winter tracker" } } }],
  changeWorkbookAfterRead: true, refusal: "ASSISTANT_EDIT_STALE",
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Refuse a credential setting",
  message: "Change the SharePoint roster credential to replacement.",
  calls: [{ tool: "change_settings", args: { key: "sharepointOnboardingRosterUrl", operation: "set-text", source: "replacement" } }],
  refusal: "ASSISTANT_EDIT_REFUSED",
  largestRequest: 4_550, total: 4_550,
}, {
  name: "Refuse part of an operator word",
  message: "Show my browser configuration.",
  calls: [readSetting, { tool: "change_settings", args: { key: "browser.headless", operation: "enable", source: "on" } }],
  refusal: "ASSISTANT_VALUE_NEEDS_SOURCE",
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Refuse text from a generated redaction",
  message: "Set the operator label to relay.sample@example.invalid.",
  calls: [{ tool: "read_settings", args: { key: "actor.label" } },
    { tool: "change_settings", args: { key: "actor.label", operation: "set-text", source: "email" } }],
  maskedSource: "relay.sample@example.invalid", refusal: "ASSISTANT_VALUE_NEEDS_SOURCE",
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Refuse a question about a setting",
  message: "Is headless mode off?",
  calls: [readSetting, { tool: "change_settings", args: { key: "browser.headless", operation: "disable", source: "off" } }],
  refusal: "ASSISTANT_VALUE_NEEDS_SOURCE",
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Refuse a setting target substituted by the provider",
  message: "Set Screen width to 2048.",
  calls: [{ tool: "read_settings", args: { key: "display.screenHeight" } },
    { tool: "change_settings", args: { key: "display.screenHeight", operation: "set-json", source: "2048" } }],
  refusal: "ASSISTANT_VALUE_NEEDS_SOURCE",
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Refuse a workbook rename in a question",
  message: "Is the only spreadsheet named Winter tracker?",
  calls: [readSheet, { tool: "change_spreadsheet", args: { change: { action: "rename", sheet: "[[S1.g1]]", source: "Winter tracker" } } }],
  refusal: "ASSISTANT_VALUE_NEEDS_SOURCE",
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Refuse a value copied from the target name",
  message: 'Rename spreadsheet "Autumn tracker" to Winter tracker.',
  calls: [readSheet, { tool: "change_spreadsheet", args: { change: { action: "rename", sheet: "[[S1.g1]]", source: "Autumn tracker" } } }],
  refusal: "ASSISTANT_VALUE_NEEDS_SOURCE",
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Refuse a workbook target substituted by the provider",
  message: 'Rename spreadsheet "Other tracker" to Winter tracker.',
  calls: [readSheet, { tool: "change_spreadsheet", args: { change: { action: "rename", sheet: "[[S1.g1]]", source: "Winter tracker" } } }],
  refusal: "ASSISTANT_VALUE_NEEDS_SOURCE",
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Refuse an unquoted SharePoint URL when the provider drops the final period",
  message: `Link the only spreadsheet to ${sharePointUrl}.`,
  calls: [readSheet, { tool: "change_spreadsheet", args: { change: { action: "link", sheet: "[[S1.g1]]", source: sharePointUrl } } }],
  refusal: "ASSISTANT_VALUE_NEEDS_SOURCE",
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Refuse a final period included in the provider's unquoted SharePoint URL",
  message: `Link the only spreadsheet to ${sharePointUrl}.`,
  calls: [readSheet, { tool: "change_spreadsheet", args: { change: { action: "link", sheet: "[[S1.g1]]", source: sharePointUrl + "." } } }],
  refusal: "ASSISTANT_VALUE_NEEDS_SOURCE",
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Link the exact quoted SharePoint URL with a final period",
  message: `Link the only spreadsheet to ${JSON.stringify(sharePointUrl + ".")}.`,
  calls: [readSheet, { tool: "change_spreadsheet", args: { change: { action: "link", sheet: "[[S1.g1]]", source: sharePointUrl + "." } } }],
  expectedLink: sharePointUrl + ".",
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Rename to an exact quoted name with escaped characters",
  message: `Rename the only spreadsheet to ${JSON.stringify(quotedName)}.`,
  calls: [readSheet, { tool: "change_spreadsheet", args: { change: { action: "rename", sheet: "[[S1.g1]]", source: quotedName } } }],
  expectedName: quotedName,
  largestRequest: 4_700, total: 9_300,
}, {
  name: "Replace a long cell",
  message: "Set the only spreadsheet worksheet 1, row 2, column 1 to Reviewed.",
  calls: [readSheet, { tool: "change_spreadsheet", args: { change: { action: "set-cell", sheet: "[[S1.g1]]",
    worksheet: 1, row: 2, column: 1, format: "text", source: "Reviewed" } } }],
  largestRequest: 4_700, total: 9_300,
}] as const satisfies readonly EditScenario[];
