import fs from 'node:fs';

import { Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const source = `const Button = () => null;
const _Button = Button, $Button = Button, Ω = Button;
const UI = { Button, Deep: { Card: Button } }, ui = { button: Button };
const view = <>
  <Button title="component"><button /><UI.Button /></Button>
  <UI.Deep.Card />
  <ui.button></ui.button>
  <_Button /><$Button /><Ω />
  <my-button /><UI-Button /><svg:path />
</>;
`;

test('JSX tags reference component uses once and contain their names', async () => {
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
    const references = query.matches(tree.rootNode).flatMap(({ captures }) => {
      const reference = captures.find(({ name }) => name === 'reference.call')?.node;
      if (!reference) return [];
      const name = captures.find(({ name }) => name === 'name')!.node;
      expect(name.startIndex).toBeGreaterThanOrEqual(reference.startIndex);
      expect(name.endIndex).toBeLessThanOrEqual(reference.endIndex);
      return [[name.text, reference.text]];
    });
    expect(references).toEqual([
      ['Button', '<Button title="component">'],
      ['Button', '<UI.Button />'],
      ['Card', '<UI.Deep.Card />'],
      ['button', '<ui.button>'],
      ['_Button', '<_Button />'],
      ['$Button', '<$Button />'],
      ['Ω', '<Ω />'],
    ]);
  } finally {
    tree?.delete();
    query?.delete();
    parser.delete();
  }
});
