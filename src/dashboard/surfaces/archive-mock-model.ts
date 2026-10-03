import type { ArchiveBrowseState } from '../app/archive-route-model.js';
import type { DsStatus } from '../ds/ui.js';
import { SavedRuntimeVersionIndexWireSchema } from '../../domain/dashboard/archive.js';
export type MockArchiveFolder = Readonly<{
    dashboardKey: string;
    workflow: string;
}>;
export type MockArchiveOutcome = 'verifiedDone' | 'doneWarnings' | 'failed' | 'cancelled';
export type MockArchiveRun = Readonly<{
    id: string;
    number: number;
    title: string;
    person: string;
    employeeId: string;
    email: string;
    workflow: string;
    workflowLabel: string;
    dashboard: string;
    workflowVersion: string;
    outcome: MockArchiveOutcome;
    completed: string;
    archived: string;
    elapsed: string;
    document: string;
    location: string;
    settings: readonly (readonly [
        string,
        string
    ])[];
    fields: readonly (readonly [
        string,
        string
    ])[];
    steps: readonly Readonly<{
        label: string;
        status: DsStatus | 'notStarted';
        duration: string;
    }>[];
    files: readonly Readonly<{
        name: string;
        content: string;
    }>[];
}>;
export const MOCK_ARCHIVE_CURRENT = '1.4';
export const MOCK_ARCHIVE_WORKFLOWS = [
    { id: 'archive-demo-separation', label: 'Separations', version: '1.13', steps: ['Read Kuali request', 'Read timecard', 'Confirm employee identity', 'File termination', 'Finalize Kuali document'] },
    { id: 'archive-demo-hiring', label: 'Onboarding', version: '1.7', steps: ['Read CRM request', 'Confirm employee identity', 'Create job data', 'Verify hire', 'Complete onboarding packet'] },
    { id: 'archive-demo-contact', label: 'Emergency Contact', version: '1.4', steps: ['Read contact request', 'Confirm employee identity', 'Update emergency contact', 'Verify contact'] },
    { id: 'archive-demo-lookup', label: 'Person lookup', version: '1.3', steps: ['Search UCPath', 'Cross verification', 'Active status', 'Read CRM dates'] },
] as const;
export const MOCK_ARCHIVE_VERSIONS = SavedRuntimeVersionIndexWireSchema.parse({
    revision: 1, dashboard: { major: 1, minor: 4 }, changes: [],
    workflows: MOCK_ARCHIVE_WORKFLOWS.map(row => ({ workflowId: row.id, label: row.label, version: { major: 1, minor: Number(row.version.split('.')[1]) } })),
});
export const MOCK_ARCHIVE_REPORT_SECTIONS = [
    { id: 0, label: 'Workflow details' }, { id: 2, label: 'Logs' },
    { id: 3, label: 'Saved settings' }, { id: 4, label: 'Retained files' },
] as const;
const people = ['Jordan Lee', 'Alex Morgan', 'Taylor Chen', 'Casey Reed', 'Sam Rivera', 'Morgan Blake', 'Avery Jones', 'Riley Park', 'Drew Ellis', 'Jamie Brooks', 'Sofia Hernández-Williams', 'Quinn Lane', 'Rowan Bell', 'Skyler Kim', 'Charlie Reed', 'Cameron Davis'];
const locations = ['Seventh College dining', 'Sixth College market', 'Warren College dining', 'Campus café'];
export const MOCK_ARCHIVE_RUNS: readonly MockArchiveRun[] = Array.from({ length: 30 }, (_, index) => {
    const definition = MOCK_ARCHIVE_WORKFLOWS[index % 4], person = people[index % people.length];
    const outcome: MockArchiveOutcome = (['verifiedDone', 'doneWarnings', 'failed', 'cancelled'] as const)[Math.floor(index / 4) % 4];
    const dashboard = index < 16 ? '1.3' : index < 26 ? '1.2' : 'unrecorded';
    const day = index < 16 ? 25 - Math.floor(index / 4) : index < 26 ? 18 - Math.floor((index - 16) / 4) : 5;
    const month = index < 16 ? '09' : index < 26 ? '08' : '07';
    const number = 48216 + index, employeeId = `DEMO-${1042 + index}`, document = `DEMO-DOC-${number}`;
    const completed = `2026-${month}-${String(day).padStart(2, '0')}T${String(9 + index % 6).padStart(2, '0')}:${String(31 - index % 30).padStart(2, '0')}:00-07:00`;
    const workflowVersion = dashboard === 'unrecorded' ? 'Not recorded' : `1.${Math.max(0, Number(definition.version.split('.')[1]) - (dashboard === '1.3' ? 1 : 2))}`;
    const fields: readonly (readonly [
        string,
        string
    ])[] = definition.label === 'Separations' ? [['Document number', document], ['Last day worked', mockArchiveDate(completed)], ['Separation date', mockArchiveDate(new Date(Date.parse(completed) + 86400000).toISOString())], ['Reason', 'Appointment ended'], ['Supervisor', 'Robin Cooper'], ['Work location', locations[index % 4]]] : definition.label === 'Onboarding' ? [['Document number', document], ['Hire type', 'New hire'], ['Start date', mockArchiveDate(new Date(Date.parse(completed) + 14 * 86400000).toISOString())], ['Position number', `DEMO-POS-${6000 + index}`], ['Supervisor', 'Robin Cooper'], ['Work location', locations[index % 4]]] : definition.label === 'Emergency Contact' ? [['Contact name', 'Morgan Lee'], ['Relationship', 'Sibling'], ['Phone', '(202) 555-0146'], ['Preferred contact', 'Yes'], ['Request number', document], ['Work location', locations[index % 4]]] : [['Employee ID', employeeId], ['Preferred name', person.split(' ')[0]], ['Employment status', 'Active'], ['Appointment', 'Student employee'], ['Work location', locations[index % 4]], ['Verified systems', 'UCPath and CRM']];
    const failedStep = definition.steps.length - 2;
    const steps = definition.steps.map((label, step) => ({ label, status: outcome === 'failed' ? (step === failedStep ? 'failed' : step > failedStep ? 'notStarted' : 'verifiedDone') : outcome === 'cancelled' ? (step > 1 ? 'notStarted' : 'verifiedDone') : outcome === 'doneWarnings' && step === definition.steps.length - 1 ? 'doneWarnings' : 'verifiedDone', duration: outcome === 'cancelled' && step > 1 || outcome === 'failed' && step > failedStep ? '—' : `${8 + step * 12 + index % 5}s` })) satisfies MockArchiveRun['steps'];
    const elapsedSeconds = steps.reduce((total, step) => total + (step.duration === '—' ? 0 : Number.parseInt(step.duration, 10)), 0) + 14 + index % 40;
    const content = `Fictional Archive mock\n${person}\n${definition.label}\n${document}\nOutcome: ${outcome}\nNo real transaction was performed.\n`;
    return { id: `archive-demo-run-${number}`, number, title: `${definition.label === 'Person lookup' ? 'Employment verification' : definition.label === 'Emergency Contact' ? 'Contact update' : definition.label === 'Separations' ? 'Appointment ended' : 'Student appointment'} · ${person}`, person, employeeId, email: person.toLowerCase().replace(/[^a-z ]/g, '').replaceAll(' ', '.') + '@example.com', workflow: definition.id, workflowLabel: definition.label, dashboard, workflowVersion, outcome, completed, archived: dashboard === '1.3' ? '2026-09-26T10:00:00-07:00' : dashboard === '1.2' ? '2026-08-19T10:00:00-07:00' : '2026-07-06T10:00:00-07:00', elapsed: `${Math.floor(elapsedSeconds / 60)}m ${String(elapsedSeconds % 60).padStart(2, '0')}s`, document, location: locations[index % 4], settings: [['Browser mode', 'Headed'], ['Priority', 'Interactive'], ['Dry run', 'Off'], ['Capture screenshots', 'On'], ['Step selection', 'Workflow defaults']], fields, steps, files: [{ name: `request-${number}.txt`, content }, { name: `saved-settings-${number}.json`, content: JSON.stringify({ mock: true, employeeId, workflow: definition.label, document, priority: 'interactive', browserMode: 'headed' }, null, 2) }, ...(outcome === 'failed' ? [{ name: `failure-${number}.txt`, content: 'Fictional failure: UCPath confirmation was unavailable. The following step was not started.' }] : [])] };
});
export function mockArchiveScope(folder: MockArchiveFolder | null): readonly MockArchiveRun[] | null {
    if (folder === null)
        return MOCK_ARCHIVE_RUNS;
    const rows = MOCK_ARCHIVE_RUNS.filter(row => row.dashboard === folder.dashboardKey && row.workflow === folder.workflow);
    return rows.length === 0 ? null : rows;
}
export function mockArchiveFilter(rows: readonly MockArchiveRun[], browse: ArchiveBrowseState): readonly MockArchiveRun[] {
    const f = browse.filters, search = f.search?.trim().toLocaleLowerCase() ?? '';
    return rows.filter(row => (!search || JSON.stringify([row.title, row.person, row.employeeId, row.email, row.document, row.location, row.workflowLabel, row.dashboard, row.workflowVersion, row.fields, row.settings]).toLocaleLowerCase().includes(search)) &&
        (f.dashboardVersion === undefined || row.dashboard === `${f.dashboardVersion.major}.${f.dashboardVersion.minor}`) && (f.workflow === undefined || row.workflow === f.workflow) &&
        (f.outcome === undefined || (f.outcome === 'done' ? row.outcome === 'verifiedDone' || row.outcome === 'doneWarnings' : row.outcome === f.outcome)) &&
        (f.title === undefined || row.title.toLocaleLowerCase().includes(f.title.toLocaleLowerCase())) &&
        (f.descriptorVersion === undefined || row.workflowVersion === f.descriptorVersion) &&
        (!f.from || Date.parse(row.completed) >= Date.parse(f.from)) && (!f.to || Date.parse(row.completed) <= Date.parse(f.to)) &&
        (!f.capturedFrom || Date.parse(row.archived) >= Date.parse(f.capturedFrom)) && (!f.capturedTo || Date.parse(row.archived) <= Date.parse(f.capturedTo)));
}
export function mockArchiveDate(value: string) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)); }
export function mockArchiveDateBoundary(value: string, end = false): string | undefined { return value === '' ? undefined : `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`; }
export function mockArchiveResultLabel(outcome: MockArchiveOutcome): string {
    return { verifiedDone: 'Verified', doneWarnings: 'Completed with warnings', failed: 'Failed', cancelled: 'Cancelled' }[outcome];
}
export function mockArchiveExport(rows: readonly MockArchiveRun[], format: 'json' | 'csv'): string {
    if (format === 'json')
        return JSON.stringify({ mock: true, records: rows }, null, 2);
    const csv = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    return [['Run', 'Subject', 'Employee ID', 'Workflow', 'Dashboard version', 'Workflow version', 'Result', 'Completed', 'Document'], ...rows.map(row => [String(row.number), row.person, row.employeeId, row.workflowLabel, row.dashboard, row.workflowVersion, mockArchiveResultLabel(row.outcome), row.completed, row.document])].map(row => row.map(csv).join(',')).join('\r\n');
}
