# @willbooster/tree-sitter-javascript

[![npm version](https://img.shields.io/npm/v/@willbooster/tree-sitter-javascript.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-javascript)
[![license](https://img.shields.io/npm/l/@willbooster/tree-sitter-javascript.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-javascript)
[![Test](https://github.com/WillBooster/tree-sitter-javascript/actions/workflows/test.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-javascript/actions/workflows/test.yml)
[![Test rust](https://github.com/WillBooster/tree-sitter-javascript/actions/workflows/test-rust.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-javascript/actions/workflows/test-rust.yml)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![wbfy](https://img.shields.io/badge/wbfy-20.26.0-1e90ff.svg)](https://github.com/WillBooster/shared/tree/main/packages/wbfy)
[![crates.io](https://img.shields.io/crates/v/willbooster-tree-sitter-javascript.svg)](https://crates.io/crates/willbooster-tree-sitter-javascript)

JavaScript and JSX grammar for [tree-sitter](https://github.com/tree-sitter/tree-sitter), forked from
[tree-sitter/tree-sitter-javascript](https://github.com/tree-sitter/tree-sitter-javascript). We are grateful
to its authors and contributors. This is not an official release of that project.

This fork fixes parsing bugs and raises conformance with [ECMAScript (ECMA-262)](https://tc39.es/ecma262/) and [JSX](https://facebook.github.io/jsx/).

## Usage

The npm package ships `tree-sitter-javascript.wasm` for [web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter):

```js
import { fileURLToPath } from 'node:url';
import { Language, Parser } from 'web-tree-sitter';

await Parser.init();
const parser = new Parser();
const wasmPath = fileURLToPath(import.meta.resolve('@willbooster/tree-sitter-javascript/tree-sitter-javascript.wasm'));
parser.setLanguage(await Language.load(wasmPath));
const tree = parser.parse('const App = () => <p>Hello</p>;\n');
```

The package also ships the node types in `src/node-types.json`.

In Rust, depend on the [crate](https://crates.io/crates/willbooster-tree-sitter-javascript):

```toml
[dependencies]
tree-sitter = "0.27"
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

`bun run test` runs:

- the corpus in `test/corpus`, with the native build and with the Wasm build (the first run downloads the WASI SDK);
- an incremental-parsing check (`test/unit/incremental.test.ts`): `tree-sitter fuzz` edits each corpus case at random,
  reparses it, undoes the edits, and reparses again. `TREE_SITTER_SEED`, `TREE_SITTER_ITERATIONS`, and
  `TREE_SITTER_EDITS` run other or more edits;
- a check that the real-world JavaScript files in `examples/`, the checked-in ones and those of the cloned repository,
  fail to parse exactly as listed in `script/known-failures.txt`. The first run clones the repository. The example repository is pinned to a commit in
  `script/parse-examples`. After a grammar change or a moved pin alters that list, `script/parse-examples` rewrites
  it; review its diff before committing;
- a performance check (`test/unit/performance.test.ts`) that recovering from an error on each of 10,000 lines takes
  linear time, since consumers parse files while they are being edited. It loads the Wasm build through
  web-tree-sitter, which `bun run build/ci` rebuilds after regenerating the parser.

CI also runs these tests on Linux arm64 and macOS, where the Rust binding compiles the parser natively, and fuzzes the parser with libFuzzer and sanitizers
(`.github/workflows/robustness.yml`).

### References

- [The ESTree Spec](https://github.com/estree/estree)
- [The ECMAScript 2025 Spec](https://tc39.es/ecma262/2025/)
