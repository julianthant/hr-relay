import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { it } from 'vitest';
import { operatorIngressAdmission } from '../../../../../src/backend/transports/http/routes/operator-mutation-ingress.js';

it.each(['json', 'opaque'] as const)('passes safe reads and guards mutations before handler effects with %s admission', async policy => {
  const app = new Hono();
  let effects = 0;
  app.use('/types', operatorIngressAdmission(policy));
  app.all('/types', context => { effects++; return context.json({ state: 'served' }); });
  for (const method of ['GET', 'HEAD']) assert.equal((await app.request('http://localhost/types', { method })).status, 200);
  assert.equal(effects, 2);
  const refusedHeaders: readonly Record<string, string>[] = [{ host: 'localhost' }, { host: 'localhost', origin: 'https://foreign.example' }];
  for (const headers of refusedHeaders) {
    const response = await app.request('http://localhost/types', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403); assert.equal(effects, 2);
  }
  const wrong = await app.request('http://localhost/types', { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(wrong.status, policy === 'json' ? 415 : 200);
  assert.equal(effects, policy === 'json' ? 2 : 3);
  assert.equal((await app.request('http://localhost/types', { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json' }, body: '{}' })).status, 200);
  assert.equal(effects, policy === 'json' ? 3 : 4);
});


it.each(["json", "opaque"] as const)("admits only in-range loopback Host ports with %s admission", async policy => {
  const app = new Hono();
  let effects = 0;
  app.use("/save", operatorIngressAdmission(policy));
  app.post("/save", c => { effects++; return c.json({ state: "served" }); });
  for (const [port, origin, expectedStatus] of [
    [0, "http://localhost:0", 403],
    [65536, "http://localhost", 403],
    [1, "http://localhost:1", 200],
    [65535, "http://localhost:65535", 200],
  ] as const) {
    const response = await app.request("/save", {
      method: "POST",
      headers: { host: `localhost:${String(port)}`, origin, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, expectedStatus);
    if (expectedStatus === 403) assert.equal(effects, 0);
  }
  assert.equal(effects, 2);
});
