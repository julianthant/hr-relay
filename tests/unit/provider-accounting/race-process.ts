import { z } from "zod";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { createGenericProviderAccounting } from "../../../src/backend/storage/sqlite/provider-accounting.js";
const send=(value:unknown)=>{if(process.send===undefined)throw new Error("race process requires IPC");process.send(value);};
const disconnect=process.disconnect?.bind(process);
if(disconnect===undefined)throw new Error("race process requires IPC");
process.once("message",(input:unknown)=>{
 const {path,request}=z.strictObject({path:z.string(),request:z.unknown()}).parse(input);
 const db=AuthorityDatabase.open({path,busyTimeoutMs:5000,migrationOwner:"provider-race"});
 send({state:"ready"});
 process.once("message",()=>{
  const attemptedAt=Date.now();
  try{
   const result=db.withAuthorityTransaction(()=>{
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);
    return createGenericProviderAccounting(db.authority.providerAccounting).reserve(request);
   });
   send({state:"result",outcome:result.state,pid:process.pid,attemptedAt,finishedAt:Date.now()});
  }finally{db.close();disconnect();}
 });
});
