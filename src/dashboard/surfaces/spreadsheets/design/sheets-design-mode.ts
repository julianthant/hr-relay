export type SheetsScenario = 'empty' | 'all' | 'missing' | 'many';
export type SheetsStep = 'pick' | 'columns';

const param = (name: string) => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);

export const sheetsDesign = (): boolean => param('relaySheetsDesign') === 'd';
export const sheetsScenario = (): SheetsScenario => { const value = param('relaySheetsScenario'); return value === 'empty' || value === 'missing' || value === 'many' ? value : 'all'; };

export const sheetsParam = (name: string): string | null => param(name);
