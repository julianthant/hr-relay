import type { Scenario } from './sheets-v2-model.js';

const param = (name: string) => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);

export const sheetsDesign = (): boolean => param('relaySheetsDesign') === 'v2';
export const sheetsScenario = (): Scenario => { const value = param('relaySheetsScenario'); return value === 'many' || value === 'empty' ? value : 'all'; };
export const sheetsParam = (name: string): string | null => param(name);
