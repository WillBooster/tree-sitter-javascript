import path from 'node:path';

import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestHarness, type TestHarness } from 'wrangler';

const WorkerDir = path.join(import.meta.dirname, '../fixtures/worker');
// The same Worker with and without Node.js compatibility, since the grammar must load in both.
const Configs = { 'nodejs-compat': 'wrangler.jsonc', 'no-nodejs-compat': 'wrangler.no-nodejs-compat.jsonc' };

let server: TestHarness | undefined;

beforeAll(async () => {
  server = createTestHarness({
    workers: Object.values(Configs).map((config) => ({ configPath: path.join(WorkerDir, config) })),
  });
  await server.listen();
}, 120_000);

afterAll(async () => {
  await server?.close();
});

test.each(Object.keys(Configs))('parses in Cloudflare Workers with the imported Wasm modules (%s)', async (name) => {
  const response = await server!.getWorker(name).fetch('http://localhost/', {
    method: 'POST',
    body: 'const App = () => <p>Hello</p>;',
  });
  expect(await response.text()).toBe(
    '(program (lexical_declaration (variable_declarator name: (identifier) value: (arrow_function parameters: (formal_parameters) body: (jsx_element open_tag: (jsx_opening_element name: (identifier)) (jsx_text) close_tag: (jsx_closing_element name: (identifier)))))))'
  );
});
