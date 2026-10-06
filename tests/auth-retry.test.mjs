import { test } from 'node:test';
import assert from 'node:assert/strict';

// Synthetic credentials override any local environment; fetch never leaves this process.
process.env.BLUESKY_IDENTIFIER = 'synthetic.test';
process.env.BLUESKY_APP_PASSWORD = 'synthetic-only';
process.env.BLUESKY_SERVICE = 'https://synthetic.invalid';
let instance = 0;
for (const operation of ['get', 'post', 'uploadBlob']) {
  for (const scenario of ['persistent', 'recovered', 'refresh-denied']) {
    const recovered = scenario === 'recovered';
    test(`${operation}: ${scenario}`, async () => {
      const { client } = await import(`../dist/client.js?test=${instance++}`);
      const originalFetch = globalThis.fetch;
      let requests = 0;
      let refreshes = 0;
      let logins = 0;
      const session = { accessJwt: 'synthetic-access', refreshJwt: 'synthetic-refresh', did: 'did:plc:synthetic', handle: 'synthetic.test' };
      globalThis.fetch = async input => {
        const url = new URL(input);
        assert.equal(url.origin, 'https://synthetic.invalid');
        if (url.pathname.endsWith('createSession')) { logins++; return Response.json(session); }
        if (url.pathname.endsWith('refreshSession')) {
          refreshes++;
          if (scenario === 'refresh-denied') return Response.json({}, { status: 401 });
          return Response.json(session);
        }
        requests++;
        if (requests > 5) throw new Error('Regression guard: unbounded auth retry');
        if (recovered && requests === 2) return Response.json({ ok: true });
        return Response.json({ message: 'Still unauthorized' }, { status: 401, statusText: 'Unauthorized' });
      };
      try {
        const result = operation === 'uploadBlob'
          ? client.uploadBlob(new Uint8Array([1]), 'application/octet-stream')
          : client[operation]('synthetic.operation');
        if (recovered) assert.deepEqual(await result, { ok: true });
        else await assert.rejects(result, /failed \(401\)/);
        assert.equal(requests, 2);
        assert.equal(refreshes, 1);
        assert.equal(logins, scenario === 'refresh-denied' ? 2 : 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
}
