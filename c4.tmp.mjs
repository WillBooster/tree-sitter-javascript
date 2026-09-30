// Usage: node .tmp/compare.mjs <base.wasm> <head.wasm> <file-list>
import { readFileSync } from 'node:fs';
import { Parser, Language } from '@willbooster/web-tree-sitter';
const [baseWasm, headWasm, listPath] = process.argv.slice(2);
await Parser.init();
const base = new Parser();
base.setLanguage(await Language.load(baseWasm));
const head = new Parser();
head.setLanguage(await Language.load(headWasm));
const files = [...new Set(readFileSync(listPath, 'utf8').split('\n').filter(Boolean))];
let diff = 0,
  fixed = 0,
  broken = 0,
  bothErr = 0,
  seen = new Set();
for (const f of files) {
  let src;
  try {
    src = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (seen.has(src)) continue;
  seen.add(src);
  const a = base.parse(src),
    b = head.parse(src);
  const sa = a.rootNode.toString(),
    sb = b.rootNode.toString();
  const ea = a.rootNode.hasError,
    eb = b.rootNode.hasError;
  if (ea && eb) {
    bothErr++;
    console.log(`ERR ${f}`);
  }
  if (sa !== sb) {
    diff++;
    if (ea && !eb) fixed++;
    else if (!ea && eb) broken++;
    console.log(`DIFF ${f} baseErr=${ea} headErr=${eb}`);
  }
  a.delete();
  b.delete();
}
console.log(`unique=${seen.size} diff=${diff} fixed=${fixed} broken=${broken} bothErr=${bothErr}`);
