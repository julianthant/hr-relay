import { createDashboardApp } from "../../../../../src/backend/transports/http/routes/api.js";
import { sqliteRunReader } from "../../canonical-run-reader.js";
import { createSeededServicesSetup } from "../profiles/seeded-services-setup.js";

export const {
  composeSeededServices
} = createSeededServicesSetup( {
  readFixtureRun: (runReader: ReturnType<typeof sqliteRunReader>, runId: string) => {
        const result = runReader.read(runId);
        return result.state === "present" ? { disposition: result.disposition, run: result.run } : undefined;
      },
  createFixtureDashboardApp: (runLogsHub, before, after) => createDashboardApp({ ...before, runLogsHub, ...after })
});
