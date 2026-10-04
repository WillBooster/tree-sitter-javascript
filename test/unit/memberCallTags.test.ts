import fs from 'node:fs';

import { Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const source = `function direct(value) { return value; }
const client = { send: direct, nested: { send: direct } };
direct("plain");
client.send("member");
client?.send?.("optional");
client.nested.send(direct("nested"));
client.send\`template\`;
`;

test('member call tags contain their names and complete invocations', async () => {
  await Parser.init();
  const language = await Language.load('tree-sitter-javascript.wasm');
  const parser = new Parser();
  let query: Query | undefined;
  let tree: Tree | undefined;
  try {
    parser.setLanguage(language);
    query = new Query(language, fs.readFileSync('queries/tags.scm', 'utf8'));
    tree = parser.parse(source)!;
    expect(tree.rootNode.hasError).toBe(false);
    const calls = query.matches(tree.rootNode).flatMap(({ captures }) => {
      const reference = captures.find(({ name }) => name === 'reference.call')?.node;
      if (!reference) return [];
      const name = captures.find(({ name }) => name === 'name')!.node;
      expect(reference.type).toBe('call_expression');
      expect(name.startIndex).toBeGreaterThanOrEqual(reference.startIndex);
      expect(name.endIndex).toBeLessThanOrEqual(reference.endIndex);
      return [[name.text, reference.text]];
    });
    expect(calls).toEqual([
      ['direct', 'direct("plain")'],
      ['send', 'client.send("member")'],
      ['send', 'client?.send?.("optional")'],
      ['send', 'client.nested.send(direct("nested"))'],
      ['direct', 'direct("nested")'],
      ['send', 'client.send`template`'],
    ]);
  } finally {
    tree?.delete();
    query?.delete();
    parser.delete();
  }
});
