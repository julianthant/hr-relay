import { z } from "zod";

export const TaskRunNoteKindSchema = z.enum([
  "contact-advice-withheld",
  "roster-match-completed",
  "task-log-limit-reached",
  "browser-action-limit-reached",
]);
export type TaskRunNoteKind = z.infer<typeof TaskRunNoteKindSchema>;

const TASK_RUN_NOTE_MESSAGES: Readonly<Record<TaskRunNoteKind, string>> = Object.freeze({
  "contact-advice-withheld": "contact advisory withheld fields whose classification forbids provider use",
  "roster-match-completed": "roster match completed",
  "task-log-limit-reached": "Further task log messages were omitted after the 256-message run limit.",
  "browser-action-limit-reached": "Further browser actions were omitted after the 256-action operation limit.",
});

export function taskRunNoteMessage(kind: TaskRunNoteKind): string {
  return TASK_RUN_NOTE_MESSAGES[TaskRunNoteKindSchema.parse(kind)];
}
