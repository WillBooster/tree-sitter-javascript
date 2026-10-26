import fs from 'node:fs';

import { parse } from '@babel/parser';
import { Edit, Language, type Node, Parser, type Point, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const Statements = [
  '{a, b};',
  '{a: b};',
  'while (a) {c, y};',
  'throw y;\nwhile (async as => <a:b x="s" />){ c, y };/*\n*/import x from "m";',
  'if (a) {b, c} else {d, e}',
  'for (;;) {a, b};',
  'for (a of b) {c, d};',
  'do {a, b} while (c);',
  'switch (a) {case 1: {b, c}; default: {d, e}}',
  'try {a, b} catch ({x, y}) {c, d} finally {e, f}',
  'function f({a, b}) { return {a, b}; }',
  'function f() { return\n{a, b}; }',
  'async function f() { await ({a, b}); {c, d} }',
  'function* f() { yield {a, b}; {c, d} }',
  'const f = () => {a, b};',
  'const f = () => ({a, b});',
  'const f = () => { return () => ({a, b}); };',
  'const x = { m({a, b}) { if (a) {b, c}; return {a, b}; } };',
  'const object = {finally(){}, catch(){}, get: function(){}, set: function(){}, static:true, async:true, await:true};',
  'const object = {async bar(){}};',
  'class C { static {a, b} m({a, b}) {return {a, b}} field = {a, b}; }',
  'const x = `${{a: 1}}`; {a, b}',
  'const x = <C value={{a, b}}>{({a, b})}</C>; {a, b}',
  '({a, b} = value); const {c, d} = value;',
  'for ({a, b} of values) {c, d}',
  'if (a) ({b, c});',
  'export default {a, b};',
];
const BraceQuery =
  '(statement_block "{" @block_open "}" @block_close) ' +
  '(object "{" @object_open "}" @object_close) (object_pattern "{" @pattern_open "}" @pattern_close)';
const Following = 'const sentinel = 1;';

test.each(['javascript', 'javascript_script'])(
  'distinguishes statement braces from expression and pattern braces in %s',
  async (goal) => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, BraceQuery);
    try {
      for (const source of Statements.filter(
        (statement) => goal === 'javascript' || (!statement.includes('import ') && !statement.startsWith('export '))
      )) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(braces(query, tree.rootNode), source).toEqual(referenceBraces(source, goal));
        } finally {
          tree.delete();
        }
      }
      for (const source of ['{} = value;', 'function f() { {} = value; }', '{...rest};', '{method(){}};']) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(true);
        } finally {
          tree.delete();
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }
  }
);

test.each(['javascript', 'javascript_script'])(
  'preserves brace queries and full ranges through statement/expression edits in %s',
  async (goal) => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    const braceQuery = new Query(language, BraceQuery);
    const queries = [
      braceQuery,
      ...['highlights', 'highlights-jsx', 'highlights-params', 'locals', 'tags', 'injections'].map(
        (name) => new Query(language, fs.readFileSync(`queries/${name}.scm`, 'utf8'))
      ),
    ];
    try {
      for (const sequence of [
        ['while (a) {b, c};', 'while (a) ({b, c});', 'while (a) {b, c};'],
        ['const f = () => {a, b};', 'const f = () => ({a, b});', 'const f = () => {a, b};'],
        ['({a, b} = values);', '{a, b};', '({a, b} = values);'],
        ['function f() {return {a, b};}', 'function f() {return\n{a, b};}', 'function f() {return {a, b};}'],
        [
          'const x = <C value={{a, b}} />; {c, d}',
          'const x = <C value={{a, b}} />; ({c, d});',
          'const x = <C value={{a, b}} />; {c, d}',
        ],
      ]) {
        const initial = `const before = 0;\n${sequence[0]}\n${Following}`;
        let source = initial;
        let tree = parser.parse(source)!;
        const original = snapshot(tree.rootNode);
        try {
          for (const next of [
            initial.replace('before = 0', 'before = 1000'),
            ...sequence.map((statement) => `const before = 0;\n${statement}\n${Following}`),
          ]) {
            tree = reparse(parser, tree, source, next);
            source = next;
            const fresh = parser.parse(source)!;
            try {
              expect(tree.rootNode.hasError, source).toBe(false);
              expect(snapshot(tree.rootNode), source).toEqual(snapshot(fresh.rootNode));
              expect(braces(braceQuery, tree.rootNode), source).toEqual(referenceBraces(source, goal));
              for (const query of queries) {
                expect(
                  query.captures(tree.rootNode).map(({ name, node }) => [name, snapshot(node)]),
                  source
                ).toEqual(query.captures(fresh.rootNode).map(({ name, node }) => [name, snapshot(node)]));
              }
              expect(tree.rootNode.lastNamedChild!.text, source).toBe(Following);
            } finally {
              fresh.delete();
            }
          }
          expect(snapshot(tree.rootNode)).toEqual(original);
        } finally {
          tree.delete();
        }
      }
    } finally {
      for (const query of queries) query.delete();
      parser.delete();
    }
  }
);

function braces(query: Query, node: Node): unknown[] {
  return query
    .captures(node)
    .map(({ name, node: brace }) => [name, brace.startIndex, brace.endIndex])
    .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function referenceBraces(source: string, goal: string): unknown[] {
  const reference = parse(source, { sourceType: goal === 'javascript' ? 'module' : 'script', plugins: ['jsx'] });
  const ranges: unknown[] = [];
  visit(reference);
  return ranges.toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const node = value as { type?: string; start?: number; end?: number };
    const kind =
      node.type === 'BlockStatement' || node.type === 'StaticBlock'
        ? 'block'
        : node.type === 'ObjectExpression'
          ? 'object'
          : node.type === 'ObjectPattern'
            ? 'pattern'
            : undefined;
    if (kind && node.start !== undefined && node.end !== undefined) {
      const start = node.type === 'StaticBlock' ? source.indexOf('{', node.start) : node.start;
      ranges.push([`${kind}_open`, start, start + 1], [`${kind}_close`, node.end - 1, node.end]);
    }
    for (const child of Object.values(value)) visit(child);
  }
}

function reparse(parser: Parser, tree: Tree, source: string, next: string): Tree {
  let start = 0;
  while (start < source.length && start < next.length && source[start] === next[start]) start++;
  let oldEnd = source.length;
  let newEnd = next.length;
  while (oldEnd > start && newEnd > start && source[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  tree.edit(
    new Edit({
      startIndex: start,
      oldEndIndex: oldEnd,
      newEndIndex: newEnd,
      startPosition: point(source, start),
      oldEndPosition: point(source, oldEnd),
      newEndPosition: point(next, newEnd),
    })
  );
  const result = parser.parse(next, tree)!;
  tree.delete();
  return result;
}

function point(source: string, index: number): Point {
  const lines = source.slice(0, index).split('\n');
  return { row: lines.length - 1, column: lines.at(-1)!.length };
}

function snapshot(node: Node): unknown {
  return [
    node.type,
    node.isNamed,
    node.isMissing,
    node.isExtra,
    node.isError,
    node.hasError,
    node.startIndex,
    node.endIndex,
    node.startPosition,
    node.endPosition,
    node.children.map((child, index) => [node.fieldNameForChild(index), snapshot(child)]),
  ];
}
