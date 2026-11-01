import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Language, Parser } from '@willbooster/web-tree-sitter';

const Root = fileURLToPath(new URL('../../', import.meta.url));
const Following = 'const sentinel = 1;';
const Cli = execFileSync(path.join(Root, 'script/fork-cli'), { encoding: 'utf8' }).trim();
const Scratch = fs.mkdtempSync(path.join(Root, '.tmp/grammarExtensions-'));
let passed = false;

try {
  await Parser.init();
  for (const goal of ['javascript', 'javascript_script']) {
    for (const mode of ['wrapped', 'explicit']) await checkConsumer(goal, mode);
  }
  passed = true;
} finally {
  if (passed) fs.rmSync(Scratch, { recursive: true });
  else process.stderr.write(`Derived grammar artifacts retained at ${Scratch}\n`);
}

async function checkConsumer(goal, mode) {
  const directory = path.join(Scratch, `${goal}-${mode}`);
  prepareConsumer(directory, goal, mode);
  runCli(directory, ['generate', path.join(directory, 'grammar.js')], 'generate');
  const wasm = path.join(directory, 'consumer.wasm');
  runCli(directory, ['build', '--wasm', '--optimization', 'z', '--output', wasm, directory], 'build');
  const parser = new Parser();
  try {
    parser.setLanguage(await Language.load(wasm));
    for (const fixture of validFixtures(mode)) checkFixture(parser, fixture);
    for (const statement of invalidFixtures()) checkInvalid(parser, statement);
    process.stdout.write(`Verified ${goal} ${mode} consumer\n`);
  } finally {
    parser.delete();
  }
}

function prepareConsumer(directory, goal, mode) {
  const sources = path.join(directory, 'src');
  fs.mkdirSync(sources, { recursive: true });
  const base = path.join(Root, goal === 'javascript' ? 'grammar.js' : 'grammars/script/grammar.js');
  fs.writeFileSync(path.join(directory, 'grammar.js'), consumerGrammar(base, goal, mode));
  for (const name of ['function_context.h', 'literal.h']) {
    fs.copyFileSync(path.join(Root, 'src', name), path.join(sources, name));
  }
  if (goal === 'javascript') fs.copyFileSync(path.join(Root, 'src/scanner.c'), path.join(sources, 'scanner.c'));
  else {
    fs.copyFileSync(path.join(Root, 'src/scanner.c'), path.join(sources, 'scannerBase.c'));
    const wrapper = fs.readFileSync(path.join(Root, 'grammars/script/src/scanner.c'), 'utf8');
    fs.writeFileSync(path.join(sources, 'scanner.c'), wrapper.replace('../../../src/scanner.c', 'scannerBase.c'));
  }
  fs.writeFileSync(
    path.join(directory, 'tree-sitter.json'),
    JSON.stringify({ grammars: [{ name: goal, scope: 'source.consumer', path: '.' }], metadata: { version: '0.0.0' } })
  );
}

function consumerGrammar(base, goal, mode) {
  const annotation = "optional(seq(':', $.identifier))";
  const rest =
    mode === 'wrapped'
      ? `($, previous) => seq(choice(previous, seq('...', alias('rest@', $.identifier))), ${annotation})`
      : `($) => prec.right(seq('...', $._lhs_expression, ${annotation}))`;
  const objectRest =
    mode === 'wrapped'
      ? `($, previous) => seq(choice(previous, seq('...', alias('object@', $.identifier))), ${annotation})`
      : `($) => prec.right(seq('...', $._object_rest_target, ${annotation}))`;
  return `module.exports = grammar(require(${JSON.stringify(base)}), {
  name: ${JSON.stringify(goal)},
  rules: {
    _lhs_expression: ($, previous) => choice(previous, $.bang_target, $.legacy_target),
    _object_rest_target: ($, previous) => choice(previous, $.bang_target),
    _non_rest_pattern: ($, previous) => choice(previous, alias('target@', $.identifier)),
    _formal_parameter: ($, previous) => choice(previous, alias('parameter@', $.identifier)),
    rest_pattern: ${rest},
    _object_rest_pattern: ${objectRest},
    bang_target: () => token(/[a-z]+!/),
    legacy_target: ($) => seq('legacy@', $.array_pattern),
  },
});
`;
}

function runCli(directory, arguments_, stage) {
  const result = spawnSync(Cli, arguments_, {
    cwd: directory,
    env: {
      ...process.env,
      CARGO_BUILD_JOBS: '1',
      MAKEFLAGS: '-j1',
      EMCC_CORES: '1',
      BINARYEN_CORES: '1',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  fs.writeFileSync(path.join(directory, `${stage}.log`), output);
  fs.writeFileSync(path.join(directory, `${stage}.exit`), `${result.status ?? result.signal ?? 'spawn-error'}\n`);
  if (result.status !== 0) {
    process.stderr.write(output);
    throw result.error ?? new Error(`Derived grammar ${stage} failed: ${result.status ?? result.signal}`);
  }
  process.stdout.write(output);
}

function validFixtures(mode) {
  const fixtures = [
    ['function f(...[x]: T) {}', ['...[x]: T']],
    ['function f(...{x}: T) {}', ['...{x}: T']],
    ['[...[x]: T] = values;', ['...[x]: T']],
    ['function f(parameter@, ...a!: T) {}', ['...a!: T']],
    ['[target@, ...a!: T] = values;', ['...a!: T']],
    ['function f(...legacy@ [x]: T) {}', ['...legacy@ [x]: T']],
    ['[...legacy@ [x]: T] = values;', ['...legacy@ [x]: T']],
    ['({...a!: T} = values);', ['...a!: T']],
    ['({...{}.x: T} = values);', ['...{}.x: T']],
    ['({...{x: 1}.x: T} = values);', ['...{x: 1}.x: T']],
    ['({...[][0]: T} = values);', ['...[][0]: T']],
    ['({...[a][0]: T} = values);', ['...[a][0]: T']],
    ['function f(...[x = 1,,...tail]) {}', ['...[x = 1,,...tail]', '...tail']],
    ['const copy = {...{x: 1}, ...[]};', []],
  ];
  if (mode === 'wrapped') {
    fixtures.push(['function f(...rest@: T) {}', ['...rest@: T']]);
    fixtures.push(['({...object@: T} = values);', ['...object@: T']]);
  }
  return fixtures;
}

function checkFixture(parser, [statement, rests]) {
  const source = `${statement}\n${Following}`;
  const tree = parser.parse(source);
  assert.ok(tree);
  try {
    assert.equal(tree.rootNode.hasError, false, source);
    assertFollowing(tree, source);
    assert.deepEqual(
      tree.rootNode
        .descendantsOfType('rest_pattern')
        .map((node) => [node.type, node.text, node.startIndex, node.endIndex]),
      rests.map((text) => ['rest_pattern', text, source.indexOf(text), source.indexOf(text) + text.length]),
      source
    );
    if (statement.startsWith('function ')) {
      const declaration = tree.rootNode.firstNamedChild;
      assert.equal(declaration.childForFieldName('name').text, 'f', source);
      assert.equal(
        declaration.childForFieldName('parameters').text,
        statement.slice(statement.indexOf('('), statement.lastIndexOf(')') + 1),
        source
      );
    }
  } finally {
    tree.delete();
  }
}

function invalidFixtures() {
  return [
    '({...{x}} = values);',
    'const {...[x]} = values;',
    'function f({...{x}}) {}',
    'function f(...[x]: T, next) {}',
    'function f(...[x]: T,) {}',
    '({...a!: T, next} = values);',
    '({...legacy@ [x]: T} = values);',
  ];
}

function checkInvalid(parser, statement) {
  const source = `${statement}\n${Following}`;
  const tree = parser.parse(source);
  assert.ok(tree);
  try {
    assert.equal(tree.rootNode.hasError, true, source);
    assertFollowing(tree, source);
  } finally {
    tree.delete();
  }
}

function assertFollowing(tree, source) {
  assert.equal(tree.rootNode.lastNamedChild.text, Following, source);
  assert.equal(tree.rootNode.lastNamedChild.hasError, false, source);
}
