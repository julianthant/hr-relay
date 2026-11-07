import assert from "node:assert/strict";
import { afterEach,it } from "vitest";
import { spreadsheetCsvRow } from "../../../../src/backend/runs/exports/spreadsheet-csv.js";

const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const dispose of cleanup.splice(0))dispose();});

it("escapes formula and control prefixes but preserves numeric cells and RFC 4180 meaning",()=>{
  const values=["=1+1","+cmd","-1+2","@SUM(A1)","  =1","\t=1","\r@cmd","\n+cmd","\u0001=1"];
  for(const value of values)assert.ok(spreadsheetCsvRow([value]).replace(/^"/u,"").startsWith("'"));
  assert.equal(spreadsheetCsvRow([-42,12.5,'a,"b"\nc']),'-42,12.5,"a,""b""\nc"');
});
