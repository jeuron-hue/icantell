#!/usr/bin/env bash
# icantell_mutate.sh: mutation runner over the colour module in icantell.html.
#   bash icantell_mutate.sh            run every mutant
#   bash icantell_mutate.sh --list     list the mutants without running them
#
# A mutant is a copy of the colour module with one small deliberate fault:
# a + made into -, a < turned round, a constant nudged by 10 per cent, a
# word blanked, a statement deleted. Each mutant runs against the unit
# tests in icantell_behave.cjs. A mutant the tests catch is "killed". One
# that passes every test "survives", which means the tests do not pin that
# piece of code down and need tightening. Exit status is 1 if any survive.
#
# Left alone: the name table (its numbers are data, checked by "every
# centre names itself"), comments, 'use strict', and any line ending in
# "// mutate-skip: <reason>" (for a fault that cannot change any result).
# Boundary flips (< to <=) are not made: the inputs are measured colours,
# so an exact tie never decides a name. The thresholds themselves are
# pinned by nudging each constant and requiring a test to notice.
set -euo pipefail
cd "$(dirname "$0")"

exec node - "$@" <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { extractColourModule } = require(path.resolve('icantell_behave.cjs'));

const listOnly = process.argv.includes('--list');
const html = fs.readFileSync('icantell.html', 'utf8');
const src = extractColourModule(html);
const firstLine = html.slice(0, html.indexOf('// BEGIN colour module')).split('\n').length;
const lines = src.split('\n');

// Character classes per line: 'c' code, 's' inside a string, 'x' comment.
function classify(line) {
  const kind = new Array(line.length).fill('c');
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '/' && line[i + 1] === '/') {
      for (let j = i; j < line.length; j++) kind[j] = 'x';
      break;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== "'") j += line[j] === '\\' ? 2 : 1;
      for (let k = i; k <= j && k < line.length; k++) kind[k] = 's';
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return kind;
}

const mutants = [];
function add(lineNo, col, len, replacement, op) {
  const line = lines[lineNo];
  const mutated = line.slice(0, col) + replacement + line.slice(col + len);
  mutants.push({ lineNo, op, before: line.trim(), after: mutated.trim(), mutated });
}

let inTable = false;
lines.forEach((line, n) => {
  if (line.includes('// BEGIN name table')) inTable = true;
  if (line.includes('// END name table')) {
    inTable = false;
    return;
  }
  if (inTable || /\/\/ mutate-skip: \S/.test(line) || line.includes("'use strict'")) return;
  const kind = classify(line);
  const code = (i) => kind[i] === 'c';
  const prevChar = (i) => {
    let j = i - 1;
    while (j >= 0 && line[j] === ' ') j--;
    return j >= 0 ? line[j] : '';
  };
  const binary = (i) => /[\w)\]]/.test(prevChar(i));

  // Operators, longest first so "<=" is not also read as "<".
  const ops = [
    ['===', '!==', 'negate'], ['!==', '===', 'negate'],
    ['<=', '>', 'negate'], ['>=', '<', 'negate'],
    ['&&', '||', 'logic'], ['||', '&&', 'logic'],
    ['+=', '-=', 'arith'], ['-=', '+=', 'arith'], ['*=', '/=', 'arith'], ['/=', '*=', 'arith'],
    ['++', '--', 'arith'], ['--', '++', 'arith'],
    ['>>', '<<', 'arith'], ['=>', null, null],
    ['<', '>=', 'negate'], ['>', '<=', 'negate'],
    ['+', '-', 'arith'], ['-', '+', 'arith'], ['*', '/', 'arith'], ['/', '*', 'arith'], ['%', '*', 'arith'],
  ];
  let i = 0;
  while (i < line.length) {
    if (!code(i)) {
      i += 1;
      continue;
    }
    let matched = false;
    for (const [tok, rep, op] of ops) {
      if (line.startsWith(tok, i)) {
        matched = true;
        if (rep !== null) {
          const single = tok.length === 1;
          if (!single || (tok !== '-' && tok !== '+') || binary(i)) add(n, i, tok.length, rep, op);
          if (tok === '-' && !binary(i)) add(n, i, 1, '', 'unary');
        }
        i += tok.length;
        break;
      }
    }
    if (!matched) i += 1;
  }

  // Numbers: integers + 1, decimals x 1.1.
  for (const m of line.matchAll(/(?<![\w.])(\d+\.\d+|\d+)(?![\w.])/g)) {
    if (!code(m.index)) continue;
    const v = Number(m[1]);
    const rep = m[1].includes('.') ? String(+(v * 1.1).toPrecision(12)) : String(v + 1);
    add(n, m.index, m[1].length, rep, 'number');
  }

  // Strings: blank a word, or fill a blank.
  for (const m of line.matchAll(/'([^'\\]*)'/g)) {
    if (kind[m.index] !== 's') continue;
    add(n, m.index, m[0].length, m[1] ? "''" : "'x'", 'string');
  }

  // Maths helpers.
  for (const m of line.matchAll(/Math\.(max|min|abs|floor|ceil)\b/g)) {
    if (!code(m.index)) continue;
    const swap = { max: 'Math.min', min: 'Math.max', abs: '', floor: 'Math.ceil', ceil: 'Math.floor' }[m[1]];
    add(n, m.index, m[0].length, swap, 'math');
  }

  // Conditions: if (x) becomes if (!(x)).
  for (const m of line.matchAll(/\bif \(/g)) {
    if (!code(m.index)) continue;
    let depth = 0;
    let end = -1;
    for (let j = m.index + 3; j < line.length; j++) {
      if (line[j] === '(') depth++;
      if (line[j] === ')' && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    const cond = line.slice(m.index + 4, end);
    add(n, m.index + 4, cond.length, '!(' + cond + ')', 'negate');
  }

  // Statement deletion: a one-line statement that is not a declaration,
  // return, or the start or end of a block.
  const t = line.trim();
  if (t.endsWith(';') && !/^(const|let|var|return|function)\b/.test(t) && !t.startsWith('}') && !t.endsWith('{')) {
    const indent = line.length - line.trimStart().length;
    add(n, indent, t.length, ';', 'delete');
  }
});

if (listOnly) {
  for (const m of mutants) console.log('line ' + (firstLine + m.lineNo) + ' [' + m.op + '] ' + m.after);
  console.log(mutants.length + ' mutants');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icantell-mutate-'));
const TIMEOUT_MS = 10000;

function runTests(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['icantell_behave.cjs', '--unit', '--quiet', '--bail', '--module', file], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve('timeout');
    }, TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? 'pass' : 'fail');
    });
  });
}

(async () => {
  // The untouched module must pass first, or every mutant would look killed.
  const original = path.join(tmp, 'original.js');
  fs.writeFileSync(original, src);
  if ((await runTests(original)) !== 'pass') {
    console.log('The unmutated colour module fails its own tests. Fix that first.');
    process.exit(1);
  }

  console.log('Mutating the colour module: ' + mutants.length + ' mutants');
  const results = new Array(mutants.length);
  let next = 0;
  const workers = Math.max(1, Math.min(8, os.cpus().length));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < mutants.length) {
      const k = next++;
      const copy = lines.slice();
      copy[mutants[k].lineNo] = mutants[k].mutated;
      const file = path.join(tmp, 'mutant-' + k + '.js');
      fs.writeFileSync(file, copy.join('\n'));
      results[k] = await runTests(file);
      fs.unlinkSync(file);
    }
  }));
  fs.rmSync(tmp, { recursive: true, force: true });

  const survivors = mutants.filter((m, k) => results[k] === 'pass');
  const timeouts = results.filter((r) => r === 'timeout').length;
  const killed = mutants.length - survivors.length;
  for (const m of survivors) {
    console.log('  SURVIVED  line ' + (firstLine + m.lineNo) + ' [' + m.op + ']');
    console.log('      was  ' + m.before);
    console.log('      now  ' + m.after);
  }
  console.log('\n' + killed + ' of ' + mutants.length + ' killed (' + timeouts + ' by timeout), ' + survivors.length + ' survived');
  process.exit(survivors.length ? 1 : 0);
})();
NODE
