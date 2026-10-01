import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';

import treeSitterJson from '../../tree-sitter.json';

const Root = path.join(import.meta.dirname, '../..');
const QueryKinds = ['highlights', 'injections', 'locals', 'tags'] as const;
const queryPaths = (kind: (typeof QueryKinds)[number]): string[] =>
  treeSitterJson.grammars.flatMap((grammar) => grammar[kind]);
await Parser.init();

// Tools that read tree-sitter.json use only the queries it lists, so a query file it misses goes unused.
test('lists every query file in tree-sitter.json', () => {
  const listed = QueryKinds.flatMap((kind) => queryPaths(kind)).toSorted();
  const files = fs
    .readdirSync(path.join(Root, 'queries'))
    .map((file) => `queries/${file}`)
    .toSorted();
  expect(listed).toEqual(files);
});

// Tools that read tree-sitter.json, such as the tree-sitter CLI, compile each kind of query from its files
// concatenated, so a node type that a grammar change removes must fail here rather than in them. performance.test.ts
// checks that the Wasm build is current.
test('compiles the queries that tree-sitter.json references', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  for (const kind of QueryKinds) {
    const source = queryPaths(kind)
      .map((file) => fs.readFileSync(path.join(Root, file), 'utf8'))
      .join('\n');
    expect(() => new Query(language, source), `${kind} queries`).not.toThrow();
  }
});

// On a fresh runner, cargo first installs the toolchain that rust-toolchain.toml pins. The commands run synchronously,
// so only their own timeout can stop them; the test's is longer so that theirs is reported.
const execOptions = { cwd: Root, encoding: 'utf8', timeout: 240_000 } as const;
const listPublishedFiles = {
  npm: (): string[] => {
    const [pack] = JSON.parse(
      execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], execOptions)
    ) as [{ files: { path: string }[] }];
    return pack.files.map((file) => file.path);
  },
  crate: (): string[] => execFileSync('cargo', ['package', '--list', '--allow-dirty'], execOptions).split('\n'),
};
for (const [packageKind, listFiles] of Object.entries(listPublishedFiles)) {
  test(
    `publishes every query file that tree-sitter.json references in the ${packageKind} package`,
    { timeout: 300_000 },
    () => {
      const published = new Set(listFiles());
      expect(published).toContain('tree-sitter.json');
      for (const kind of QueryKinds) {
        for (const file of queryPaths(kind)) {
          expect(published, file).toContain(file);
        }
      }
    }
  );
}
