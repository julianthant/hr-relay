import type { ProviderRequestStorage, ProviderUsageStorage } from "../domain/provider-accounting.js";
/** Frozen F storage contract. P supplies policy inside one owning authority transaction. */
export interface ProviderAccountingStorage {
 transaction<T>(work:(storage:ProviderAccountingStorage)=>T):T;
 getRequest(requestId:string):ProviderRequestStorage|undefined;
 getUsage(usageId:string):ProviderUsageStorage|undefined;
 listUsage():readonly ProviderUsageStorage[];
 writeRequest(record:ProviderRequestStorage,expectedVersion:number|null):void;
 writeUsage(record:ProviderUsageStorage,expectedVersion:number|null):void;
}
