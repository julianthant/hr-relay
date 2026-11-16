import { z } from 'zod';
import { WorkbookIdSchema } from './workbooks.js';
const name = z.string().refine(value => value.trim().length > 0);
export const PlannedRunOutputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('worksheet-archives'), state: z.literal('after-row-choice') }),
  z.strictObject({ kind: z.literal('workbook'), name, rowSubject: z.enum(['person', 'record']),
    rows: z.discriminatedUnion('state', [z.strictObject({ state: z.literal('known'), count: z.number().int().nonnegative() }), z.strictObject({ state: z.literal('after-review') })]) }),
  z.strictObject({ kind: z.literal('worksheet-archive'), sheetId: WorkbookIdSchema, worksheetName: name, folderName: name, archiveName: name,
    people: z.array(z.strictObject({ rowId: WorkbookIdSchema, label: name })).min(1)
      .refine(people => new Set(people.map(person => person.rowId)).size === people.length) }),
]);
export type PlannedRunOutput = z.infer<typeof PlannedRunOutputSchema>;
