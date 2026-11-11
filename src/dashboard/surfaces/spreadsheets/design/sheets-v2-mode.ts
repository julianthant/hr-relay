import type { Scenario } from './sheets-v2-model.js';
import { mockParam } from '../../../app/mock-surfaces.js';

const param = mockParam;

export const sheetsScenario = (): Scenario => { const value = param('relaySheetsScenario'); return value === 'many' || value === 'empty' ? value : 'all'; };
export const sheetsParam = (name: string): string | null => param(name);
