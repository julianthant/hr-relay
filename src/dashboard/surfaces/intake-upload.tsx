import { Banner, Dropzone, Refusal } from "../ds/ui.js";
import { useIntakeClient } from "../state/intake-client.js";
import { INTAKE_ACCEPT, INTAKE_DROPZONE_HINT, intakeDropzoneLabel } from "./intake-model.js";
import { useIntakeUpload } from "./intake-upload-model.js";

type UploadProps = { workflowId: string; workflowLabel: string; onOpened: (intakeSessionId: string) => void };

export function SpreadsheetIntake(props: UploadProps) {
  return <WorkflowUpload key={props.workflowId} {...props} />;
}

function WorkflowUpload({ workflowId, workflowLabel, onOpened }: UploadProps) {
  const { state, upload } = useIntakeUpload(useIntakeClient(), workflowId, onOpened);
  const busy = state.phase === "reading" || state.phase === "uploading";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-base)]">
      {state.phase === "refused" && (
        <Refusal title="That file could not be read" code={state.code} outcome="no session was opened">{state.message}</Refusal>
      )}
      {state.phase === "failed" && (
        <Banner tone="danger" title={state.delivery === "unknown" ? "Upload status is unknown" : "The file could not be read"}>
          {state.message}{state.delivery === "unknown" ? " Retry this file to recover its open import." : " No bytes were sent."}
        </Banner>
      )}
      <Dropzone
        label={intakeDropzoneLabel(workflowLabel)}
        accept={INTAKE_ACCEPT}
        hint={INTAKE_DROPZONE_HINT}
        busy={busy}
        busyLabel={state.phase === "uploading" ? "Uploading the file…" : "Reading the file…"}
        onFile={upload}
        className="min-h-[var(--ds-h-dialog-dropzone)] flex-1"
      />
    </div>
  );
}
