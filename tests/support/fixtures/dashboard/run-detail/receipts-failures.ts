import { at,traceOf } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE } from "../fixture-diagnostic.js";
import { createReceiptsFailuresSetup } from "../../../helpers/dashboard/profiles/run-detail/receipts-failures-setup.js";

export const {
  FIXTURE_RECEIPT_SECTIONS,
  FIXTURE_FAILURE_SECTIONS
} = createReceiptsFailuresSetup( {
  at,
  traceOf,
  FIXTURE_IDS,
  FIXTURE_DIAGNOSTIC_BUNDLE
});
