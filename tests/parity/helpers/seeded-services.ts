import { createDashboardApp } from "../../../src/backend/transports/http/routes/api.js";
import { sqliteRunReader } from "../../support/helpers/canonical-run-reader.js";
import { createSeededServicesSetup } from "../../support/helpers/dashboard/profiles/seeded-services-setup.js";

export const {
  composeSeededServices
} = createSeededServicesSetup( {
  readFixtureRun: (runReader: ReturnType<typeof sqliteRunReader>, runId: string) => {
        const existence = runReader.read(runId);
        return existence.state === "present" ? { disposition: existence.disposition, run: existence.run } : undefined;
      },
  createFixtureDashboardApp: (runLogsHub, before, after) => createDashboardApp({ runLogsHub, ...before, ...after })
});
