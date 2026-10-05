import { CrossDateSearchQuerySchema } from "../../../domain/dashboard/search.js";
export const EMPTY_SEARCH_FILTERS=Object.freeze({scope:"",from:"",to:"",workflow:"",subject:"",actor:"",state:"",version:"",failure:"",evidence:"",shape:"",dryRun:"",system:""});
export type SearchFilterDraft={ [Key in keyof typeof EMPTY_SEARCH_FILTERS]:string };
export function searchQueryFromDraft(q:string,draft:SearchFilterDraft) {
  const {scope,...filters}=draft;
  return CrossDateSearchQuerySchema.parse({q,scope:scope||"all",limit:20,facets:Object.fromEntries(Object.entries(filters)
    .filter(([,value])=>value!=="").map(([key,value])=>[key,key==="version"?Number(value):key==="dryRun"?value==="true":value]))});
}
