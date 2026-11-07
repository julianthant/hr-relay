import { testDataInputSourceFrom } from "../../../../src/backend/app/registries/test-data.js";
import {
TestDataLocalConfigSchema,
type TestDataInputName,
type TestDataInputSource,
} from "../../../../src/models/config/test-data.js";

const TEST_INSTANT = "2026-09-04T00:00:00.000Z";

/** Synthetic value id for the n-th configured test-data input (test-only, never a real identity). */
export function testDataValueId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`;
}


export function testDataInputSource(
  values: Partial<Record<TestDataInputName, unknown>> = {},
): TestDataInputSource {
  const inputs = Object.fromEntries(Object.entries(values).map(([name, value], index) => [name, {
    valueId: testDataValueId(index),
    value,
    updatedAt: TEST_INSTANT,
  }]));
  return testDataInputSourceFrom(TestDataLocalConfigSchema.parse({ schemaVersion: 1, inputs, files: {} }));
}
