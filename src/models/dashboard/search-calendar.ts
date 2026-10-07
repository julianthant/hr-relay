const formatter=new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"});
/** The index and result wire use the same Pacific partition, independent of the host timezone. */
export function searchPartitionDay(at:Date):string {
  const parts=Object.fromEntries(formatter.formatToParts(at).map(part=>[part.type,part.value]));
  if(parts.year===undefined||parts.month===undefined||parts.day===undefined)throw new Error("search-partition-date-invalid");
  return `${parts.year}-${parts.month}-${parts.day}`;
}
