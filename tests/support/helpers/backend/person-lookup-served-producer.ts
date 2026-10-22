import { descriptorSetHash } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { createRunExecutorTestWorld } from "./run-executor-world.js";
import { personLookupQueuedRun, sessionFactoryHarness, healthyCrmDriver } from "../phase1f-executor-harness.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import type { SearchPersonOrgOutput } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { personLookupModule } from "../registered-workflows.js";
import { RUN_ID } from "../../fixtures/phase1f-run-fixtures.js";
import type { RunLogSnapshot } from "../../../../src/dashboard/state/run-wiring-adapter.js";

export async function personLookupServedProducer(person?: SearchPersonOrgOutput) {
  const world=createRunExecutorTestWorld();
  const sessions=sessionFactoryHarness({ucpath:()=>createDeterministicUcpathPersonOrgDriver(person),crm:()=>healthyCrmDriver()});
  const harness=world.executorHarness({sessions});
  const {database,clock,stateRoot}=harness.authority;
  try {
    const claimed=world.enqueueAndClaim(database,personLookupQueuedRun({includeCrmDates:true,dryRun:true}),clock.now().toISOString());
    createTimelineEmitter({repository:database.authority.timelineEvents,clock}).emit(runQueuedSpanEvent({run:claimed.run,actorId:LOCAL_OPERATOR_ACTOR_ID,title:personLookupModule.descriptor.label}));
    const outcome=await executeClaimedRun({...harness.deps,taskNotes:createNoteTimelineWriter({repository:database.authority.timelineEvents,clock})},{...claimed,signal:world.SIGNAL});
    if(outcome.state!=="done")throw new Error(`synthetic Person Lookup producer outcome ${outcome.state}`);
    const run=database.authority.runs.get(RUN_ID);if(run===undefined)throw Error("synthetic producer run missing");
    const runReader=new RunRecordService({database,clock,ids:{uuid:()=>"eeeeeeee-0001-4000-8000-000000000001"},publishQueued:()=>{}});
    const projection=createOperatorProjection({database,stateRoot,clock,reader:runReader,appVersion:"0.1.0",descriptorSetHash:descriptorSetHash([personLookupModule.descriptor.contractFingerprint]),
      ledger:createTransactionHistory(database.authority),descriptors:{resolve:workflow=>workflow===personLookupModule.descriptor.id?personLookupModule.descriptor:undefined}});
    projection.ingestFromTimeline();
    const deps=createOperatorRunDetail({database,stateRoot,projection,runReader});
    const detail=buildRunDetail(deps,run.envelope.runId);
    const section=buildRunLogsSection(deps,run.envelope.runId,projection.runFold(run.envelope.runId),run);if(section.section!=="logs")throw Error("synthetic producer Logs missing");
    const snapshot:RunLogSnapshot={detail,logs:section.payload,sections:[],confirmedActionBindings:section.payload.confirmedActionBindings,
      actionEvidence:{state:"available",events:section.payload.confirmedActions ?? [],missingPages:[]},unavailableEvidence:[]};
    return{harness,run,projection,deps,snapshot,dispose:world.cleanup};
  }catch(error){await world.cleanup();throw error;}
}
