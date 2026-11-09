export type SheetsDesign = 'a' | 'b' | 'c' | 'd';
export type SheetsScenario = 'empty' | 'all' | 'missing' | 'many';
export type SheetsStep = 'pick' | 'columns';

const param = (name: string) => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);

export const sheetsDesign = (): SheetsDesign | undefined => { const value = param('relaySheetsDesign'); return value === 'a' || value === 'b' || value === 'c' || value === 'd' ? value : undefined; };
export const sheetsScenario = (): SheetsScenario => { const value = param('relaySheetsScenario'); return value === 'empty' || value === 'missing' || value === 'many' ? value : 'all'; };
export const sheetsStep = (): SheetsStep | undefined => { const value = param('relaySheetsStep'); return value === 'pick' || value === 'columns' ? value : undefined; };

export const sheetsParam = (name: string): string | null => param(name);
