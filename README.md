# @willbooster/tree-sitter-javascript

[![npm version](https://img.shields.io/npm/v/@willbooster/tree-sitter-javascript.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-javascript)
[![license](https://img.shields.io/npm/l/@willbooster/tree-sitter-javascript.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-javascript)
[![Test](https://github.com/WillBooster/tree-sitter-javascript/actions/workflows/test.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-javascript/actions/workflows/test.yml)
[![Test rust](https://github.com/WillBooster/tree-sitter-javascript/actions/workflows/test-rust.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-javascript/actions/workflows/test-rust.yml)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![wbfy](https://img.shields.io/badge/wbfy-20.28.7-1e90ff.svg)](https://github.com/WillBooster/shared/tree/main/packages/wbfy)
[![crates.io](https://img.shields.io/crates/v/willbooster-tree-sitter-javascript.svg)](https://crates.io/crates/willbooster-tree-sitter-javascript)

JavaScript and JSX grammar for [tree-sitter](https://github.com/tree-sitter/tree-sitter), forked from
[tree-sitter/tree-sitter-javascript](https://github.com/tree-sitter/tree-sitter-javascript). We are grateful
to its authors and contributors. This is not an official release of that project.

This fork fixes parsing bugs and raises conformance with [ECMAScript (ECMA-262)](https://tc39.es/ecma262/) and
[JSX](https://facebook.github.io/jsx/).

## Usage

The npm package ships `tree-sitter-javascript.wasm` for
[@willbooster/web-tree-sitter](https://www.npmjs.com/package/@willbooster/web-tree-sitter), which runs in Node.js, Bun,
browsers, and Cloudflare Workers. In Node.js and Bun, load it from the package:

```js
import { fileURLToPath } from 'node:url';
import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const parser = new Parser();
const wasmPath = fileURLToPath(import.meta.resolve('@willbooster/tree-sitter-javascript/tree-sitter-javascript.wasm'));
parser.setLanguage(await Language.load(wasmPath));
const tree = parser.parse('const App = () => <p>Hello</p>;\n');
```

In browsers, let your bundler serve both `.wasm` files and pass their URLs:

```js
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtimeUrl from '@willbooster/web-tree-sitter/web-tree-sitter.wasm?url'; // Vite
import javascriptUrl from '@willbooster/tree-sitter-javascript/tree-sitter-javascript.wasm?url';

await Parser.init({ locateFile: () => runtimeUrl });
const parser = new Parser();
parser.setLanguage(await Language.load(javascriptUrl));
```

In Cloudflare Workers, which do not allow compiling Wasm at run time, import both `.wasm` files as modules, with or
without Node.js compatibility:

```js
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtime from '@willbooster/web-tree-sitter/web-tree-sitter.wasm';
import javascript from '@willbooster/tree-sitter-javascript/tree-sitter-javascript.wasm';

await Parser.init({ wasmModule: runtime });
const parser = new Parser();
parser.setLanguage(await Language.load(javascript));
```

The package also ships the node types in `src/node-types.json`, the highlight, injection, locals, and tags queries in
`queries/` that `tree-sitter.json` lists, and `grammar.js` for grammars that extend this one (e.g.
`require('@willbooster/tree-sitter-javascript/grammar')`). The crate ships `tree-sitter.json` and `queries/` too.

In Rust, depend on the [crate](https://crates.io/crates/willbooster-tree-sitter-javascript) and on
[willbooster-tree-sitter](https://crates.io/crates/willbooster-tree-sitter), the runtime this package is tested and
fuzzed with (the grammar also loads in the upstream `tree-sitter` crate 0.27, whose error recovery never ends on some
malformed input):

```toml
[dependencies]
tree-sitter = { package = "willbooster-tree-sitter", version = "1" }
tree-sitter-javascript = { package = "willbooster-tree-sitter-javascript", version = "1" }
```

```rust
let mut parser = tree_sitter::Parser::new();
parser.set_language(&tree_sitter_javascript::LANGUAGE.into())?;
```

## Development

```sh
mise install
bun install --frozen-lockfile
bun run build/ci
bun run test
script/parse-examples
cargo test
```

Every `tree-sitter` command, from `generate` to the tests, runs the CLI of the WillBooster/tree-sitter runtime version
locked in `Cargo.lock` (`script/tree-sitter`), whose generator and runtime have fixes that the upstream CLI lacks.
`script/fork-cli` downloads that CLI into `.tmp/` from its GitHub Release on first use, or builds it with `cargo` when
the download fails or the release has no binary that runs here.

`bun run test` runs:

- the corpus in `test/corpus`, with the native build and with the Wasm build (the first run downloads the WASI SDK);
- an incremental-parsing check (`test/unit/incremental.test.ts`): `script/fuzz-corpus` runs `tree-sitter fuzz`, which
  edits each corpus case at random, reparses it, undoes the edits, and reparses again. `TREE_SITTER_SEED`,
  `TREE_SITTER_ITERATIONS`, and `TREE_SITTER_EDITS` run other or more edits;
- a check that the real-world JavaScript files in `examples/`, the checked-in ones and those of the cloned repository,
  fail to parse exactly as listed in `script/known-failures.txt`. The first run clones the repository. The example
  repository is pinned to a commit in `script/parse-examples`. After a grammar change or a moved pin alters that list,
  `script/parse-examples` rewrites it; review its diff before committing;
- a performance check (`test/unit/performance.test.ts`) that recovering from an error on each line takes linear time
  (ten times the lines take about ten times the CPU time), since consumers parse files while they are being edited.
  It loads the Wasm build through @willbooster/web-tree-sitter, which `bun run build/ci` rebuilds after regenerating
  the parser;
- checks that the Wasm build parses in Chromium (`test/unit/browser/`) and in Cloudflare Workers with and without
  Node.js compatibility (`test/unit/workers.test.ts`). Run `bun run test/ci-setup` once before the first
  run to install Chromium and, on Linux, the system libraries it needs;
- a check that `package.json` and `Cargo.lock` lock the same WillBooster/tree-sitter runtime version
  (`test/unit/runtimeVersion.test.ts`);
- a check that the queries `tree-sitter.json` lists compile against the Wasm build and are in both the npm package and
  the crate (`test/unit/queries.test.ts`).

The tests and `script/parse-examples` compile the parser into `.tmp/tree-sitter-lib` instead of the CLI's cache shared
by every checkout, and `mise.toml` sets `TREE_SITTER_LIBDIR` to it for any other command run in the checkout;
`script/fuzz-corpus` builds a parser of its own in `.tmp/fuzz` for each run and deletes it afterwards.

CI also runs these tests on Linux arm64 and macOS, where the Rust binding compiles the parser natively, and fuzzes the
parser with libFuzzer and sanitizers (`.github/workflows/robustness.yml`).

### References

- [The ESTree Spec](https://github.com/estree/estree)
- [The ECMAScript 2025 Spec](https://tc39.es/ecma262/2025/)
