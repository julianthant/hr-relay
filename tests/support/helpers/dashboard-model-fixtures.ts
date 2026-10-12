





export function createDashboardModelFixtures() {
  const RUN_1 = "11111111-1111-4111-8111-111111111111";

  const RUN_2 = "22222222-2222-4222-8222-222222222222";

  const ITEM_1 = "33333333-3333-4333-8333-333333333333";

  const NOTE_1 = "44444444-4444-4444-8444-444444444444";

  const RECORD_1 = "55555555-5555-4555-8555-555555555555";

  const ARTIFACT_1 = "66666666-6666-4666-8666-666666666666";

  const NOTIFICATION_1 = "77777777-7777-4777-8777-777777777777";

  const SESSION_1 = "88888888-8888-4888-8888-888888888888";

  const HASH_A = "a".repeat(64);

  const HASH_B = "b".repeat(64);

  const NOW = "2026-07-31T17:00:00.000Z";

  const QUEUE = {
    runId: RUN_1,
    itemId: ITEM_1,
    workflowId: "onboarding",
    traceId: "on-120000-1111",
    attempt: 1,
    lineage: { state: "root" },
    actorId: "local-operator",
    appVersion: { state: "present", value: "1.0.0" },
    descriptorVersion: 1,
    descriptorHash: HASH_A,
    configFingerprint: HASH_B,
    resolvedInstances: [{ system: "ucpath", instance: "prod" }],
    dryRun: false,
  priority: "interactive",
  runNumber: { state: "present", value: 1 },
  session: { state: "absent", reason: "This fixture has no run session." },
  containment: "root",
  linkedRuns: [],
  facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
    startedAt: NOW,
    updatedAt: NOW,
    endedAt: { state: "absent", reason: "run is running" },
    gateOpenedAt: { state: "absent", reason: "run is running and is not waiting on a gate" },
    displayName: { state: "absent", reason: "the operator has not renamed this run" },
    title: "Onboard employee",
    subtitle: { state: "present", value: "EID ••••1234" },
    status: "running",
    liveMessage: { state: "present", value: "Searching UCPath" },
    warnings: { state: "absent", reason: "run is running and has not produced a terminal result" },
    pipeline: [{ id: "search", label: "Search", state: "active" }],
    panelKind: "run",
    availableSections: ["logs", "receipt", "context-data"],
    // The row's served controls, bound to `rowRevision` as their CAS target.
    actions: [
      {
        key: "cancel", label: "Cancel run", intent: "destructive", icon: "cancel",
        placement: ["footer", "menu"], kind: "command", command: "cancel", expectedVersion: 1,
        confirm: {
          title: "Cancel this run",
          body: "This stops the run where it is and settles it cancelled.",
          confirmLabel: "Cancel the run",
          tone: "destructive",
        },
      },
      {
        key: "rename", label: "Rename run\u2026", intent: "neutral", icon: "rename",
        placement: ["menu"], kind: "command", command: "rename", expectedVersion: 1,
      },
    ],
    rowRevision: 1,
    surfaceKind: "single",
  };

  const DAY = {
    day: "2026-07-31",
    descriptorHash: HASH_A,
    projectionGeneration: 1,
    snapshotCursor: "pc:1",
    monthCounts: [{ day: "2026-07-31", count: 1 }],
    workflowCounts: [{ workflowId: "onboarding", count: 1, statusCounts: [{ status: "running", count: 1 }] }],
    statusCounts: [{ status: "running", count: 1 }],
    queueSurfaces: [QUEUE],
    workerPools: [],
    workerCards: [{
      workerId: "ucpath-worker",
      workflowId: "onboarding",
      state: "working",
      directive: "run",
      startedAt: NOW,
      currentRun: { state: "present", runId: RUN_1, traceId: "on-120000-1111" },
      browsers: [{ sessionId: SESSION_1, system: "ucpath", openedAt: NOW }],
      leaseVersion: 3,
      revision: 1,
    }],
    notifications: [{ kind: "notification", channel: "inbox", count: 1, publicationId: "a".repeat(64), trigger: "verified-done", readState: "unread", notificationId: NOTIFICATION_1, actorId: "local-operator", severity: "info", title: "Run started", state: "unread", occurredAt: NOW, revision: 1, context: { state: "available", workflow: "Onboarding", subject: "Onboard employee" } }],
  };

  const DETAIL = {
    runId: RUN_1,
    rowRevision: 1,
    panelKind: "run",
    header: { runId: RUN_1, traceId: "on-120000-1111", workflowId: "onboarding", actorId: "local-operator", title: "Onboard employee", status: "running", attempt: 1 },
    timeline: { events: [{ noteId: NOTE_1, sequence: 0, at: NOW, label: "Started", state: "active", notRun: { state: "absent", reason: "this step ran" } }] },
    gate: { state: "absent", reason: "no gate is open" },
    outcome: { state: "absent", reason: "run is active" },
    context: { dataFacts: 2, evidenceFacts: 1, attempts: 1 },
    availableSections: ["logs", "receipt", "context-data"],
  };

  const NOTE_PAGE = {
    runId: RUN_1,
    notes: [{ noteId: NOTE_1, runId: RUN_1, sequence: 0, at: NOW, level: "info", message: "Started" }],
    nextCursor: { state: "absent", reason: "end-of-page" },
  };

  const REVIEW_PAGE = {
    runId: RUN_1,
    records: [{ recordId: RECORD_1, runId: RUN_1, recordRevision: 1, label: "Employee", state: "pending", evidence: [] }],
  };

  const PEOPLE_PAGE = {
    parentRunId: RUN_1,
    members: [{ runId: RUN_2, parentRunId: RUN_1, rowRevision: 1, label: "Employee", status: "queued" }],
    total: 1,
    nextCursor: { state: "absent", reason: "end-of-page" },
  };

  const ARTIFACT = {
    state: "available",
    value: {
      artifactId: ARTIFACT_1,
      sha256: HASH_A,
      byteLength: 100,
      sensitivity: "redacted",
      redaction: "applied",
      mediaKind: "image",
      mediaType: "image/png",
      width: 1280,
      height: 720,
    },
  };
  return { RUN_1, RUN_2, NOTE_1, RECORD_1, HASH_A, HASH_B, NOW, QUEUE, DAY, DETAIL, NOTE_PAGE, REVIEW_PAGE, PEOPLE_PAGE, ARTIFACT, ARTIFACT_1 };
}
