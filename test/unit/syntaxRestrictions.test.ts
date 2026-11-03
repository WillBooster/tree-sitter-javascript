import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const Goals = [
  ['Module', await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'))],
  ['Script', await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript_script.wasm'))],
] as const;

const Invalid = [
  'try { a(); }',
  'try { a(); }\nb();',
  '({ a: 1,, b: 2 });',
  '({,});',
  'f(1,, 2);',
  'f(,);',
  'new T(,);',
  'const { a,, b } = o;',
  'const {,} = o;',
  '({ a,, b } = o);',
  'function () { return 1; }',
  'function* () {}',
  'async function () {}',
  'class {}',
  '@dec class {}',
  'function f() {}.call();',
  'class C {}.name;',
  'if (a) function () {}',
  'label: class {}',
  '{ function () {} }',
  'function f() { class {} }',
];

const Valid: readonly (readonly [string, string])[] = [
  [
    'try { a(); } finally {}',
    '(try_statement body: (statement_block (expression_statement (call_expression function: (identifier) arguments: (arguments)))) finalizer: (finally_clause body: (statement_block)))',
  ],
  ['[1,,2];', '(expression_statement (array (number) (number)))'],
  [
    'const [a,,b] = x;',
    '(lexical_declaration (variable_declarator name: (array_pattern (identifier) (identifier)) value: (identifier)))',
  ],
  ['f(1,);', '(expression_statement (call_expression function: (identifier) arguments: (arguments (number))))'],
  ['new T(1,);', '(expression_statement (new_expression constructor: (identifier) arguments: (arguments (number))))'],
  [
    '({ a: 1, });',
    '(expression_statement (parenthesized_expression (object (pair key: (property_identifier) value: (number)))))',
  ],
  [
    'const { a, } = o;',
    '(lexical_declaration (variable_declarator name: (object_pattern (shorthand_property_identifier_pattern)) value: (identifier)))',
  ],
  [
    'const { a, ...r } = o;',
    '(lexical_declaration (variable_declarator name: (object_pattern (shorthand_property_identifier_pattern) (rest_pattern (identifier))) value: (identifier)))',
  ],
  [
    'function f() {}\n(x);',
    '(function_declaration name: (identifier) parameters: (formal_parameters) body: (statement_block)) (expression_statement (parenthesized_expression (identifier)))',
  ],
  [
    'async function f() {}',
    '(function_declaration name: (identifier) parameters: (formal_parameters) body: (statement_block))',
  ],
  ['@dec class C {}', '(class_declaration decorator: (decorator (identifier)) name: (identifier) body: (class_body))'],
  [
    'if (a) function f() {}',
    '(if_statement condition: (parenthesized_expression (identifier)) consequence: (function_declaration name: (identifier) parameters: (formal_parameters) body: (statement_block)))',
  ],
  [
    '(function () {})();',
    '(expression_statement (call_expression function: (parenthesized_expression (function_expression parameters: (formal_parameters) body: (statement_block))) arguments: (arguments)))',
  ],
  ['(class {});', '(expression_statement (parenthesized_expression (class body: (class_body))))'],
  [
    'x = function () {};',
    '(expression_statement (assignment_expression left: (identifier) right: (function_expression parameters: (formal_parameters) body: (statement_block))))',
  ],
  [
    'x = async function () {}, class {};',
    '(expression_statement (sequence_expression (assignment_expression left: (identifier) right: (function_expression parameters: (formal_parameters) body: (statement_block))) (class body: (class_body))))',
  ],
  [
    '!function () {}();',
    '(expression_statement (unary_expression argument: (call_expression function: (function_expression parameters: (formal_parameters) body: (statement_block)) arguments: (arguments))))',
  ],
  [
    'new function () {};',
    '(expression_statement (new_expression constructor: (function_expression parameters: (formal_parameters) body: (statement_block))))',
  ],
  [
    'for (function () {}; ;) {}',
    '(for_statement header: (for_clause initializer: (function_expression parameters: (formal_parameters) body: (statement_block)) condition: (empty_statement)) body: (statement_block))',
  ],
  ['functions = classes;', '(expression_statement (assignment_expression left: (identifier) right: (identifier)))'],
  [
    'x\n/* c */ class C {}',
    '(expression_statement (identifier)) (comment) (class_declaration name: (identifier) body: (class_body))',
  ],
];

const ModuleValid: readonly (readonly [string, string])[] = [
  [
    'export default function () {}',
    '(export_statement declaration: (function_declaration parameters: (formal_parameters) body: (statement_block)))',
  ],
  ['export default class {}', '(export_statement declaration: (class_declaration body: (class_body)))'],
  [
    'export function f() {}',
    '(export_statement declaration: (function_declaration name: (identifier) parameters: (formal_parameters) body: (statement_block)))',
  ],
];

test.each(Goals)('rejects syntax that ECMAScript forbids in the %s goal', (_, language) => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const source of Invalid) {
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
});

test.each(Goals)('parses the valid look-alikes of rejected syntax in the %s goal', (goal, language) => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const [source, expected] of goal === 'Module' ? [...Valid, ...ModuleValid] : Valid) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.toString(), source).toBe(`(program ${expected})`);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});
