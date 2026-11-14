import { createDashboardApp } from "../../../src/backend/transports/http/routes/api.js";
import { createSeededServicesSetup } from "../../support/helpers/dashboard/profiles/seeded-services-setup.js";

export const {
  composeSeededServices
} = createSeededServicesSetup( {
  createFixtureDashboardApp: (before, after) => createDashboardApp({ ...before, ...after })
});
