import type { ExplorerSpec, SpecOutcome } from "./explorer-spec.js";

const other: SpecOutcome = { value: "other", label: "Anything else", then: "The run stops with a failure card.", stops: true };

/** Stand-in for the served Explorer contract until the backend generates it from the workflow definition. */
export const PERSON_LOOKUP_SPEC: ExplorerSpec = {
  workflow: { id: "person-lookup", title: "Person Lookup" },
  options: [
    { id: "path", label: "Lookup path", choices: [{ value: "search", label: "Search" }, { value: "match", label: "Match" }] },
    { id: "by", label: "Search by", choices: [{ value: "name", label: "Name" }, { value: "eid", label: "Employee ID" }] },
    { id: "crm", label: "CRM cross-check", choices: [{ value: "on", label: "On" }, { value: "off", label: "Off" }] },
    { id: "dates", label: "CRM dates", choices: [{ value: "none", label: "Not requested" }, { value: "requested", label: "Requested" }] },
  ],
  steps: [
    { id: "sessions", title: "Open browser sessions", description: [], checks: [], blocks: [], sessions: [{ system: "UCPath" }, { system: "CRM", when: { crm: ["on"] } }] },
    {
      id: "search", title: "Search for person", system: "UCPath",
      description: [{ text: "Searches UCPath by employee ID.", when: { by: ["eid"] } }, { text: "Searches UCPath by name." }],
      checks: [{ text: "Keeps HDH departments only" }],
      blocks: [
        { kind: "card", title: "Person Organizational Summary", mode: "fill", rows: [
          { label: "Employee ID", value: "10000001", source: "search-eid", when: { by: ["eid"] } },
          { label: "Last name", value: "Morrow", source: "search-last", when: { by: ["name"] } },
          { label: "First name", value: "Bea", source: "search-first", when: { by: ["name"] } },
        ] },
        { kind: "click", target: "Search" },
        { kind: "pick", title: "Search results", columns: ["Name", "Employee ID", "Department", "HR status"], when: { search: ["several"] },
          rows: [
            { cells: ["Morrow, Bea A.", "10000001", "Campus Dining Operations", "Active"] },
            { cells: ["Morrow, Bea", "10000042", "Housing Operations", "Active"] },
            { cells: ["Morrow, Beatrice", "10000077", "HDH Catering", "On leave"], warning: true },
          ],
          other: { label: "Enter employee ID", placeholder: "8 digits" },
          question: { title: "Which Bea Morrow is this run about?", context: "Logs asks you to pick one, or to type the employee ID." } },
        { kind: "card", title: "Search results", mode: "read", when: { search: ["one", "none", "down", "other"] }, rows: [
          { label: "Employee ID", value: "10000001", when: { search: ["one"] } },
          { label: "Name", value: "Morrow, Bea A.", when: { search: ["one"] } },
          { label: "Department", value: "Campus Dining Operations", when: { search: ["one"] } },
          { label: "Results", value: { by: "search", values: { none: "No people found" }, otherwise: "Not read" }, when: { search: ["none", "down", "other"] } },
        ] },
        { kind: "decision", id: "search", label: "Search result", initial: "several", outcomes: [
          { value: "one", label: "One person found", then: "Continues to Cross-check identity." },
          { value: "several", label: "Several people match", then: "Waits for you to pick one in Logs, then continues.", when: { by: ["name"] } },
          { value: "none", label: "Nobody found", then: "The run ends as Not found.", stops: true },
          { value: "down", label: "UCPath does not load", then: "The run stops with a failure card.", stops: true },
          other,
        ] },
      ],
    },
    {
      id: "crm", title: "Cross-check identity", system: "CRM", when: { crm: ["on"] },
      description: [{ text: "Compares the person with their CRM onboarding record." }],
      checks: [{ text: "Employee ID agrees with UCPath" }],
      blocks: [
        { kind: "card", title: "CRM onboarding search", mode: "fill", rows: [{ label: "Name", value: "Morrow, Bea A.", source: "crm-name" }] },
        { kind: "card", title: "CRM onboarding record", mode: "read", when: { crm_result: ["agree", "differ", "other"] }, rows: [
          { label: "Employee ID", value: { by: "crm_result", values: { differ: "10000420" }, otherwise: "10000001" } },
          { label: "Start date", value: "03/14/2031" },
        ] },
        { kind: "decision", id: "crm_result", label: "CRM cross-check result", initial: "agree", outcomes: [
          { value: "agree", label: "Records agree", then: "Continues to Read employment status." },
          { value: "differ", label: "Records differ", then: "The run ends as Undetermined.", stops: true },
          { value: "missing", label: "No CRM record", then: "Continues without the CRM check." },
          other,
        ] },
      ],
    },
    {
      id: "status", title: "Read employment status", system: "UCPath",
      description: [{ text: "Reads department, HR status and hire date." }],
      checks: [],
      blocks: [
        { kind: "card", title: "Workforce Job Summary", mode: "read", rows: [
          { label: "Department", value: "Campus Dining Operations" },
          { label: "HR status", value: { by: "status", values: { active: "Active", inactive: "Inactive", missing: "Not found" }, otherwise: "Not read" } },
          { label: "Hire date", value: "03/14/2031" },
        ] },
        { kind: "decision", id: "status", label: "Employment status result", initial: "active", outcomes: [
          { value: "active", label: "Active", then: "The run ends as Active." },
          { value: "inactive", label: "Inactive", then: "The run ends as Inactive." },
          { value: "missing", label: "Not found", then: "The run ends as Not found." },
          other,
        ] },
      ],
    },
    {
      id: "dates", title: "Read CRM dates", system: "CRM", when: { dates: ["requested"] },
      description: [{ text: "Reads the employment date from the CRM onboarding history." }], checks: [],
      blocks: [{ kind: "card", title: "CRM onboarding history", mode: "read", rows: [{ label: "Employment date", value: "03/14/2031" }] }],
    },
  ],
  sources: {
    "search-eid": { origin: "Run input", detail: "The employee ID entered when the run starts." },
    "search-last": { origin: "Run input", detail: "The last name entered when the run starts." },
    "search-first": { origin: "Run input", detail: "The first name entered when the run starts." },
    "crm-name": { reads: [{ system: "UCPath", page: "Search results", field: "Name", step: "search" }], detail: "The CRM onboarding search uses the name UCPath returned." },
  },
};
