/// <reference types="vite/client" />
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtimeUrl from '@willbooster/web-tree-sitter/web-tree-sitter.wasm?url';
import { expect, test } from 'vitest';

import javascriptUrl from '../../../tree-sitter-javascript.wasm?url';

test('parses in a browser, loading the Wasm files over HTTP', async () => {
  await Parser.init({ locateFile: () => runtimeUrl });
  const parser = new Parser();
  parser.setLanguage(await Language.load(javascriptUrl));
  expect(parser.parse('const App = () => <p>Hello</p>;')?.rootNode.toString()).toBe(
    '(program (lexical_declaration (variable_declarator name: (identifier) value: (arrow_function parameters: (formal_parameters) body: (jsx_element open_tag: (jsx_opening_element name: (identifier)) (jsx_text) close_tag: (jsx_closing_element name: (identifier)))))))'
  );
});
