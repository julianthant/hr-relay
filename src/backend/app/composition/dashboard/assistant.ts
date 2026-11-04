import { AssistantSubjectSchema, type AssistantSubject } from '../../../../models/dashboard/assistant.js';
import { AssistantLocalEvidenceCitationSchema, type AssistantLocalEvidenceCitation } from '../../../../models/dashboard/assistant.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildRunDetail, type RunDetailQueryDeps } from '../../../runs/queries/run-detail.js';
import type { AssistantReadAllowlist } from '../../../assistant/tools.js';
import { AssistantContextError } from '../../../assistant/context.js';
import { TargetNotFoundError } from '../../../runs/commands/refusals.js';
import type { SchemaBoundCanonicalValue } from '../../../../models/validation/schema-bound-value.js';
import { deriveSchemaHash } from '../../../../models/validation/schema-bound-value.js';
import { canonicalJsonStringify, JsonValueSchema } from '../../../../rules/validation/canonical-json.js';
import type { Clock } from '../../../../rules/time/clock.js';
import type { IdFactory } from '../../../../rules/identity/identifiers.js';
import { workflowPlanning, type AnyWorkflowDescriptor } from '../../../../workflow-kit/workflow.js';
import type { AssistantPlanner, AssistantPlanningContext } from '../../../assistant/proposal.js';
import type { AssistantSubjectBroker } from '../../../assistant/service.js';
import { selectActiveRunSettings } from '../../../runs/settings/run-settings.js';
import type { AuthorityDatabase } from '../../../storage/sqlite/authority-database.js';

export function createAssistantReadAllowlist(options: Readonly<{ runDetail: RunDetailQueryDeps; assertCurrent(): void }>): AssistantReadAllowlist {
  return {
    selectedRun(subjectRef) {
      const selection = /^run_([a-f0-9-]{36})_([1-9][0-9]*)$/u.exec(subjectRef ?? '');
      if (selection === null || !z.uuid().safeParse(selection[1]).success || !Number.isSafeInteger(Number(selection[2]))) throw new AssistantContextError('ASSISTANT_READ_UNAVAILABLE');
      const runId = selection[1], rowRevision = Number(selection[2]);
      function project() {
        options.assertCurrent();
        const detail = (() => {
          try { return buildRunDetail(options.runDetail, runId); }
          catch (error) { if (error instanceof TargetNotFoundError) throw new AssistantContextError('ASSISTANT_READ_UNAVAILABLE'); throw error; }
        })();
        if (detail.runId !== runId || detail.rowRevision !== rowRevision) throw new AssistantContextError('ASSISTANT_READ_STALE');
        const events = detail.timeline.events.slice(-10).map(({ native, at, label, state, notRun }) => ({ native: native ?? null, at, label, state, notRun }));
        const sources = { status: detail.header, gate: detail.gate, outcome: detail.outcome,
          timeline: { total: detail.timeline.events.length, events } };
        const citations = Object.entries(sources).map(([source, value]) => {
          const quote = canonicalJsonStringify(value);
          return AssistantLocalEvidenceCitationSchema.parse({ kind: 'local-run', runId, rowRevision, source, quote,
            digest: createHash('sha256').update(canonicalJsonStringify({ runId, rowRevision, source, quote })).digest('hex') });
        });
        options.assertCurrent();
        return { detail, citations };
      }
      const captured = project(), identity = canonicalJsonStringify(captured.citations);
      const assertCurrent = () => {
        if (canonicalJsonStringify(project().citations) !== identity) throw new AssistantContextError('ASSISTANT_READ_STALE');
      };
      const { header, gate, outcome } = captured.detail;
      const events = captured.detail.timeline.events;
      const lines = [`${header.title}: ${header.status}.`, `Workflow: ${header.workflowId}. Attempt: ${header.attempt}.`,
        gate.state === 'open' ? `Waiting for operator review: ${gate.label}.` : gate.state === 'resolved' ? `Operator review: ${gate.resolution} by ${gate.resolvedBy}.` : `Review: ${gate.reason}.`,
        outcome.state === 'terminal' ? `Outcome: ${outcome.result}${outcome.rehearsal === true ? ' (dry-run preview)' : ''}. Completed: ${outcome.completedAt}.` : `Outcome unavailable: ${outcome.reason}.`,
        events.length === 0 ? 'No timeline events are recorded.' : `Latest recorded steps (${Math.min(10, events.length)} of ${events.length}):\n${events.slice(-10).map(event => `${event.at} · ${event.label}: ${event.state}${event.notRun.state === 'present' ? ` (${event.notRun.reason})` : ''}`).join('\n')}`,
        'These are local recorded facts. They do not authorize an action or prove an external transaction beyond its recorded outcome.'];
      return { text: lines.join('\n\n'), citations: captured.citations, assertCurrent,
        validateCitation(value: AssistantLocalEvidenceCitation) {
          assertCurrent();
          const parsed = AssistantLocalEvidenceCitationSchema.parse(value);
          if (!captured.citations.some(citation => canonicalJsonStringify(citation) === canonicalJsonStringify(parsed))) throw new AssistantContextError('ASSISTANT_CONTEXT_UNAVAILABLE');
          return parsed;
        } };
    },
  };
}

export function createAssistantPlanningAdapters(options: Readonly<{
  database: Pick<AuthorityDatabase, 'authority' | 'withAuthorityReadSnapshot' | 'getMeta'>;
  descriptors: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
  subjects: { search(query: string): readonly AssistantSubject[]; resolve(subjectRef: string): AssistantSubject };
  submission(descriptor: AnyWorkflowDescriptor, subject: AssistantSubject): unknown;
  assertSubjectBinding(descriptor: AnyWorkflowDescriptor, subject: AssistantSubject, input: SchemaBoundCanonicalValue): void;
  clock: Clock;
  ids: IdFactory;
  planTtlMs: number;
}>): { subjects: AssistantSubjectBroker; planner: AssistantPlanner } {
  function project(subject: AssistantSubject): AssistantSubject {
    return AssistantSubjectSchema.parse({ subjectRef: subject.subjectRef, displayName: subject.displayName,
      ...(subject.employeeId === undefined ? {} : { employeeId: subject.employeeId }) });
  }
  function currentSubject(subjectRef: string) {
    const subject = project(options.subjects.resolve(subjectRef));
    if (subject.subjectRef !== subjectRef) throw new Error('assistant-subject-binding-unavailable');
    return subject;
  }
  function context(workflowId: string, subject: AssistantSubject): AssistantPlanningContext {
    return options.database.withAuthorityReadSnapshot(() => {
      const descriptor = options.descriptors.resolve(workflowId);
      if (descriptor === undefined || descriptor.protectedInputs !== undefined && descriptor.protectedInputs.length > 0) throw new Error('assistant-proposal-refused');
      const { authority } = options.database;
      authority.runtimeConfig.requireSettingsCurrent();
      const snapshot = selectActiveRunSettings(authority);
      const generation = options.database.getMeta().authorityGeneration;
      const inputHash = deriveSchemaHash(descriptor.input, 'input'), canonicalHash = deriveSchemaHash(descriptor.canonicalInput, 'output');
      const submission = JsonValueSchema.parse(options.submission(descriptor, currentSubject(subject.subjectRef)));
      const submissionKey = canonicalJsonStringify(submission);
      const subjectKey = JSON.stringify(subject);
      const assertCurrent = () => options.database.withAuthorityReadSnapshot(() => {
        authority.runtimeConfig.requireSettingsCurrent();
        const active = selectActiveRunSettings(authority), current = options.descriptors.resolve(workflowId);
        if (active.configSnapshotId !== snapshot.configSnapshotId || active.fingerprint !== snapshot.fingerprint
          || options.database.getMeta().authorityGeneration !== generation || current === undefined
          || current.version !== descriptor.version || current.contractFingerprint !== descriptor.contractFingerprint
          || deriveSchemaHash(current.input, 'input') !== inputHash || deriveSchemaHash(current.canonicalInput, 'output') !== canonicalHash
          || JSON.stringify(currentSubject(subject.subjectRef)) !== subjectKey
          || canonicalJsonStringify(JsonValueSchema.parse(options.submission(current, currentSubject(subject.subjectRef)))) !== submissionKey) throw new Error('assistant-proposal-stale');
      });
      assertCurrent();
      return { subject, deps: { authority: options.database, clock: options.clock, ids: options.ids, planTtlMs: options.planTtlMs },
        request: { descriptor, submissions: [submission], dryRun: true, priority: 'interactive', shape: 'single',
          configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, plannedBy: snapshot.config.actor.id,
          browserMode: snapshot.config.browser.headless ? 'headless' : 'headed', captureBrowserScreenshots: snapshot.config.features.debugScreenshots },
        assertCurrent,
        assertSubjectBinding(input: SchemaBoundCanonicalValue) {
          const planning = workflowPlanning(descriptor);
          const expected = JsonValueSchema.parse(planning.parseCanonicalInput(planning.parseInput(submission).input));
          if (input.schemaHash !== canonicalHash || canonicalJsonStringify(input.value) !== canonicalJsonStringify(expected)) throw new Error('assistant-subject-binding-unavailable');
          options.assertSubjectBinding(descriptor, currentSubject(subject.subjectRef), input);
          assertCurrent();
        },
      };
    });
  }
  return {
    subjects: {
      async search(query, signal) {
        signal.throwIfAborted();
        return options.subjects.search(query).map(project);
      },
      async resolve(subjectRef, signal) { signal.throwIfAborted(); return currentSubject(subjectRef); },
    },
    planner: { context },
  };
}
