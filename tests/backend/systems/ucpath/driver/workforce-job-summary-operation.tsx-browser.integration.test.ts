import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

/** One auto-opened employee record, shaped like the live Workforce Job Summary detail page (frozen left table + tab-switched right table). */
const jobSummaryPage = (blank: boolean) => `<!doctype html><html><body>
<input aria-label="Empl ID" id="emplid"><button id="search">Search</button>
<div id="detail" hidden>
  <span id="DERIVED_NAME_DISPLAY_NAME">Rivera Quinn</span><span id="PER_ORG_ASGN_VW_EMPLID">10800003</span>
  <a href="#" id="wl">Work Location</a><a href="#" id="ji">Job Information</a>
  <table id="tdgblWF_JOB_SUMM$0"><tr><td>EMP</td><td>0</td><td>01/31/2025</td><td>0</td></tr></table>
  <table id="tdgbrWF_JOB_SUMM$0"></table>
</div>
<script>
  const right = document.getElementById("tdgbrWF_JOB_SUMM$0");
  const fill = cells => { right.innerHTML = "<tr>" + cells.map(cell => "<td>" + cell + "</td>").join("") + "</tr>"; };
  document.getElementById("search").onclick = () => { document.getElementById("detail").hidden = false; };
  const blank = ${String(blank)};
  document.getElementById("wl").onclick = () => fill([blank ? "&nbsp;" : "40000001", "Position description", "UCS", "000412", "HOUSING/DINING/HOSPITALITY", "6840-1", "SDCMP", "Avery Example", ""]);
  document.getElementById("ji").onclick = () => {
    const job = [blank ? "" : "004921", "STDT 2", "PSS", "Active", "Variable", "17.60", "0.440000", "Nonexempt", blank ? "" : "06/30/2025", "", ""];
    if (blank) {
      fill(["", "Position description"]);
      setTimeout(() => fill(job), 500);
    } else {
      fill(job);
    }
  };
</script></body></html>`;

describe("Workforce Job Summary read in a real browser", () => {
  it.each([
    {
      name: "reads populated position and job code cells",
      blank: false,
      positionNumber: { state: "present", value: "40000001" },
      jobCode: { state: "present", value: "004921" },
    },
    {
      name: "reads blank position and job code cells after the partial Work Location row clears",
      blank: true,
      positionNumber: { state: "absent", reason: "the Workforce Job Summary Position Number cell rendered empty" },
      jobCode: { state: "absent", reason: "the Workforce Job Summary Job Code cell rendered empty" },
    },
  ])("$name through the tsx loader", ({ blank, positionNumber, jobCode }) => {
    // Vitest compiles without keepNames; tsx wraps named inner functions in a __name helper the page realm lacks.
    const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { chromium } from "playwright";
      import { readWorkforceJobSummaryOnPage } from "./src/backend/systems/ucpath/driver/workforce-job-summary-operation.ts";
      import { UCPATH_WORKFORCE_JOB_SUMMARY_UI } from "./src/backend/systems/ucpath/driver/workforce-job-summary-ui-registry.ts";
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.route(UCPATH_WORKFORCE_JOB_SUMMARY_UI.url, route => route.fulfill({ contentType: "text/html", body: ${JSON.stringify(jobSummaryPage(blank))} }));
        const read = await readWorkforceJobSummaryOnPage(() => undefined, page, { emplId: "10800003" }, "2026-11-17T10:00:00.000Z");
        const row = read.summary?.jobRows[0];
        process.stdout.write(JSON.stringify({ state: read.state, rowCount: read.summary?.rowCount, positionNumber: row?.positionNumber, jobCode: row?.jobCode, jobTitle: row?.jobTitle }));
      } catch (error) { process.stdout.write(JSON.stringify({ failed: error.message.split("\\n")[0] })); }
      finally { await browser.close(); }
    `], { cwd: fileURLToPath(new URL("../../../../..", import.meta.url)), encoding: "utf8" });
    assert.deepEqual(JSON.parse(output), {
      state: "read",
      rowCount: 1,
      positionNumber,
      jobCode,
      jobTitle: { state: "present", value: "STDT 2" },
    });
  });
});
