import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('anonymous startup, public read, and account credential error', { timeout: 15000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'bluesky-startup-'));
  // Isolate from both launch-directory and project .env files.
  await cp(fileURLToPath(new URL('../dist', import.meta.url)), join(cwd, 'dist'), { recursive: true });
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(cwd, 'node_modules'), 'dir');
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ type: 'module' }));
  const env = { PATH: process.env.PATH };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', fileURLToPath(new URL('./public-fetch.mjs', import.meta.url)), join(cwd, 'dist/index.js')],
    cwd, env, stderr: 'pipe',
  });
  const client = new Client({ name: 'startup-test', version: '1.0.0' });
  const errors = [];
  client.onerror = error => errors.push(error);
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some(t => t.name === 'couchsky_profile'));
    const result = await client.callTool({ name: 'couchsky_profile', arguments: { actor: 'example.test' } });
    assert.notEqual(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).handle, 'example.test');
    const account = await client.callTool({ name: 'bluesky_whoami', arguments: {} });
    assert.equal(account.isError, true);
    assert.match(account.content[0].text, /BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD/);
    assert.deepEqual(errors, [], 'stdout must contain only valid MCP messages');
  } finally {
    await client.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
