import { parse } from '@babel/parser';
import { Language, type Node, Parser } from '@willbooster/web-tree-sitter';
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
const BraceOwners = [
  ['statement_block', 'block'],
  ['object', 'object'],
  ['object_pattern', 'pattern'],
] as const;
const Following = 'const sentinel = 1;';

test.each(['javascript', 'javascript_script'])(
  'distinguishes statement braces from expression and pattern braces in %s',
  async (goal) => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    try {
      for (const source of Statements.filter(
        (statement) => goal === 'javascript' || (!statement.includes('import ') && !statement.startsWith('export '))
      )) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(braces(tree.rootNode), source).toEqual(referenceBraces(source, goal));
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
      parser.delete();
    }
  }
);

test.each(['javascript', 'javascript_script'])(
  'distinguishes statement braces from expression braces between declarations in %s',
  async (goal) => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    try {
      for (const statement of [
        'while (a) {b, c};',
        'while (a) ({b, c});',
        'const f = () => {a, b};',
        'const f = () => ({a, b});',
        '({a, b} = values);',
        '{a, b};',
        'function f() {return {a, b};}',
        'function f() {return\n{a, b};}',
        'const x = <C value={{a, b}} />; {c, d}',
        'const x = <C value={{a, b}} />; ({c, d});',
      ]) {
        const source = `const before = 0;\n${statement}\n${Following}`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(braces(tree.rootNode), source).toEqual(referenceBraces(source, goal));
          expect(tree.rootNode.lastNamedChild!.text, source).toBe(Following);
        } finally {
          tree.delete();
        }
      }
    } finally {
      parser.delete();
    }
  }
);

function braces(root: Node): unknown[] {
  return BraceOwners.flatMap(([type, owner]) =>
    root
      .descendantsOfType(type)
      .flatMap((node) => node.children.filter((child) => child.type === '{' || child.type === '}'))
      .map((brace) => [`${owner}_${brace.type === '{' ? 'open' : 'close'}`, brace.startIndex, brace.endIndex])
  ).toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
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
