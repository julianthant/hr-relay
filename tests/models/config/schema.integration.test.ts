import assert from "node:assert/strict";
import { it } from "vitest";
import { CONFIG_ROUTE_KEYS, CONFIG_ROUTE_SCHEMAS } from "../../../src/models/config/schema.js";

it("refuses replacement of a config route schema", () => {
  assert.throws(() => Object.assign(CONFIG_ROUTE_SCHEMAS, { kuali: CONFIG_ROUTE_SCHEMAS.kuali }), TypeError);
});

it("refuses replacement of the config route-name lists", () => {
  assert.throws(() => Object.assign(CONFIG_ROUTE_KEYS, { kuali: CONFIG_ROUTE_KEYS.kuali }), TypeError);
});

it.each(Object.entries<readonly string[]>(CONFIG_ROUTE_KEYS))("refuses writes to the %s route-name list", (_key, names) => {
  assert.throws(() => Object.assign(names, { 0: names[0] }), TypeError);
});
