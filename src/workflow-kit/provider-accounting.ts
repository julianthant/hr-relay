import type { ProviderRequestStorage, ProviderUsageStorage } from "../rules/providers/provider-accounting.js";
/** Frozen F storage contract. P supplies policy inside one owning authority transaction. */
export interface ProviderAccountingStorage {
 transaction<T>(work:(storage:ProviderAccountingStorage)=>T):T;
 getRequest(requestId:string):ProviderRequestStorage|undefined;
 getUsage(usageId:string):ProviderUsageStorage|undefined;
 listUsage():readonly ProviderUsageStorage[];
 /** Original windows still needed by reserved requests, including zero bounds. */
 reservedWindowIds(scopeId:string,meter:string):readonly string[];
 writeRequest(record:ProviderRequestStorage,expectedVersion:number|null):void;
 writeUsage(record:ProviderUsageStorage,expectedVersion:number|null):void;
}
