#!/usr/bin/env node
// icantell_checks.cjs: static checks. Reads the files, runs nothing.
//   node icantell_checks.cjs
// Fails (exit 1) on: missing or loose Content-Security-Policy, any external
// address or CDN in the app, network calls other than the service worker's
// same-site fetch, files outside the allowed set, vendored files whose
// version or sha256 is not recorded, mismatched app, cache and package
// versions, a CHANGELOG.md whose newest entry is not this version or whose
// headings lack the release date and time, a
// loose Playwright pin, em dashes in text, or banned names (the list lives
// in reference/scrub_list.json, which is gitignored; the check skips
// cleanly when it is absent).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const failures = [];
let passes = 0;

function check(name, ok, detail) {
  if (ok) {
    passes += 1;
    console.log('  pass  ' + name);
  } else {
    failures.push(name + (detail ? ': ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? ': ' + detail : ''));
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// Files git would commit: tracked plus untracked-but-not-ignored.
function repoFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT });
  return out.toString('utf8').split('\0').filter((f) => f && exists(f));
}

// CHANGELOG.md (versioning rule, 30/10/26).
// Every heading is "## <version>, dd/mm/yy HHMM hrs" with an optional ", <label>"; the
// version is vX.Y.Z, a legacy vN, or Brief. Newest first: the top entry is the current
// APP_VERSION, x.y.z versions strictly fall, times never rise going down, and every entry
// has at least one "- " change line.
function changelogProblems(text, appVersion) {
  const probs = [];
  const heads = [];
  const lines = text.split('\n');
  lines.forEach((l, i) => { if (l.startsWith('## ')) heads.push(i); });
  if (!heads.length) return ['no entries'];
  const cmp = (a, b) => { for (let k = 0; k < 3; k++) if (a[k] !== b[k]) return a[k] - b[k]; return 0; };
  let prevVer = null, prevStamp = null;
  heads.forEach((h, n) => {
    const m = lines[h].match(/^## (v\d+\.\d+\.\d+|v\d+|Brief), (\d\d)\/(\d\d)\/(\d\d) (\d\d)(\d\d) hrs(, .+)?$/);
    if (!m) { probs.push(`heading not "## vX.Y.Z, dd/mm/yy HHMM hrs": ${lines[h]}`); return; }
    const [, label, dd, mo, yy, hh, mi] = m;
    if (+dd < 1 || +dd > 31 || +mo < 1 || +mo > 12 || +hh > 23 || +mi > 59) probs.push(`bad date or time: ${lines[h]}`);
    if (n === 0 && label !== 'v' + appVersion) probs.push(`newest entry ${label} is not the current version v${appVersion}`);
    const stamp = yy + mo + dd + hh + mi;
    if (prevStamp && stamp > prevStamp) probs.push(`${label} is later than the entry above it`);
    prevStamp = stamp;
    const xyz = label.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (xyz) {
      const v = xyz.slice(1).map(Number);
      if (prevVer && cmp(v, prevVer) >= 0) probs.push(`${label} is not below the version above it`);
      prevVer = v;
    }
    const body = lines.slice(h + 1, heads[n + 1] ?? lines.length);
    if (!body.some((l) => l.startsWith('- '))) probs.push(`${label} has no "- " change line`);
  });
  return probs;
}

// The parts that ship to the phone and run there.
const APP_CODE = ['icantell.html', 'index.html', 'sw.js', 'manifest.webmanifest'];

const REQUIRED = [
  'icantell.html', 'index.html', 'sw.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'package.json', 'package-lock.json',
  'icantell_checks.cjs', 'icantell_behave.cjs', 'icantell_mutate.sh',
  'README.md', 'CLAUDE.md', 'CHANGELOG.md', '.gitignore', '.gitattributes',
];

const ALLOWED = [
  /^icantell\.html$/, /^index\.html$/, /^sw\.js$/, /^manifest\.webmanifest$/,
  /^icons\/[a-z0-9-]+\.(png|svg)$/,
  /^vendor\/[a-z0-9-]+\.woff2$/, /^vendor\/OFL-[a-z0-9-]+\.txt$/,
  /^package\.json$/, /^package-lock\.json$/,
  /^icantell_checks\.cjs$/, /^icantell_behave\.cjs$/, /^icantell_mutate\.sh$/,
  /^README\.md$/, /^CLAUDE\.md$/, /^CHANGELOG\.md$/, /^\.gitignore$/, /^\.gitattributes$/,
];

const CDN_HOSTS = [
  'cdnjs', 'jsdelivr', 'unpkg', 'googleapis', 'gstatic', 'cloudflare', 'bootstrapcdn',
  'jquery.com', 'fontawesome', 'typekit', 'skypack', 'esm.sh', 'esm.run', 'rawgit', 'githack',
];

function cspOf(html) {
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  if (!m) return null;
  const map = {};
  for (const part of m[1].split(';')) {
    const bits = part.trim().split(/\s+/);
    if (bits[0]) map[bits[0]] = bits.slice(1);
  }
  return map;
}

// Remove comments so build notes and explanations do not trip the code checks.
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\'"])\/\/[^\n]*/g, '$1');
}

function main() {
  const files = repoFiles();
  console.log('Static checks');

  // 1. Required and allowed files.
  for (const f of REQUIRED) check('required file ' + f, files.includes(f) || exists(f));
  const loose = files.filter((f) => !ALLOWED.some((re) => re.test(f)));
  check('only allowed files in the repo', loose.length === 0, loose.join(', '));
  check('reference/ is not tracked', !files.some((f) => f.startsWith('reference/')));

  // 2. Content-Security-Policy on both pages.
  for (const page of ['icantell.html', 'index.html']) {
    const csp = cspOf(read(page));
    check(page + ' has a CSP meta tag', !!csp);
    if (!csp) continue;
    check(page + " CSP default-src 'self'", JSON.stringify(csp['default-src']) === JSON.stringify(["'self'"]));
    check(page + " CSP connect-src 'self'", JSON.stringify(csp['connect-src']) === JSON.stringify(["'self'"]));
    const sources = Object.values(csp).flat();
    const outside = sources.filter((s) => /^https?:|^wss?:|^\*|\.\w/.test(s));
    check(page + ' CSP names no other origin', outside.length === 0, outside.join(' '));
  }
  const appCsp = cspOf(read('icantell.html')) || {};
  check("icantell.html CSP object-src 'none'", JSON.stringify(appCsp['object-src']) === JSON.stringify(["'none'"]));

  // 3. No external addresses or CDNs anywhere in the app code.
  for (const f of APP_CODE) {
    const src = read(f);
    const urls = src.match(/\b(?:https?|wss?):\/\/[^\s"'<>)]+/gi) || [];
    check(f + ' has no external address', urls.length === 0, urls.join(' '));
    const cdn = CDN_HOSTS.filter((h) => src.toLowerCase().includes(h));
    check(f + ' names no CDN', cdn.length === 0, cdn.join(' '));
    const protoRel = src.match(/(?:src|href)\s*=\s*["']\/\//gi) || [];
    check(f + ' has no protocol-relative link', protoRel.length === 0);
  }
  const svgs = files.filter((f) => f.endsWith('.svg'));
  for (const f of svgs) {
    const urls = (read(f).match(/\bhttps?:\/\/[^\s"'<>)]+/gi) || []).filter((u) => u !== 'http://www.w3.org/2000/svg');
    check(f + ' has no external address', urls.length === 0, urls.join(' '));
  }

  // 4. Network calls: none in the page; the service worker may only fetch same-site requests.
  const page = stripComments(read('icantell.html')) + stripComments(read('index.html'));
  const banned = [
    /\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /\bEventSource\b/,
    /RTCPeerConnection/, /importScripts/, /\bimport\s*\(/, /navigator\.share\b/, /\bwindow\.open\s*\(/,
    /\bnew\s+Image\s*\(/, /\bsrc\s*=\s*['"]https?:/, /\bdocument\.cookie\b/, /\bindexedDB\b/,
  ];
  for (const re of banned) check('page code has no ' + re.source, !re.test(page));
  check('page never reads or writes localStorage outside a settings helper (none in Phase 1)', !/localStorage|sessionStorage/.test(page));
  const sw = stripComments(read('sw.js'));
  for (const re of banned.filter((r) => r.source !== '\\bfetch\\s*\\(')) check('sw.js has no ' + re.source, !re.test(sw));
  const fetchCalls = sw.match(/\bfetch\s*\(/g) || [];
  check('sw.js calls fetch once', fetchCalls.length === 1, String(fetchCalls.length));
  check('sw.js fetches only same-site requests', /if\s*\(new URL\(request\.url\)\.origin !== self\.location\.origin\) return;/.test(sw)
    && sw.indexOf('origin !== self.location.origin') < sw.indexOf('fetch('));

  // 5. Versions agree, and the service worker caches every shipped file.
  const appVersion = (read('icantell.html').match(/const APP_VERSION = '([^']+)'/) || [])[1];
  const swVersion = (read('sw.js').match(/const VERSION = '([^']+)'/) || [])[1];
  check('APP_VERSION and sw.js VERSION match', !!appVersion && appVersion === swVersion, appVersion + ' vs ' + swVersion);
  const pkgVersion = JSON.parse(read('package.json')).version;
  check('package.json version matches APP_VERSION', pkgVersion === appVersion, pkgVersion + ' vs ' + appVersion);
  const changelogProbs = exists('CHANGELOG.md') ? changelogProblems(read('CHANGELOG.md'), appVersion) : ['missing'];
  check('CHANGELOG.md: version, release date and time, change; newest first', changelogProbs.length === 0, changelogProbs.join('; '));
  check("sw.js cache name is 'icantell-' + VERSION", /const CACHE = 'icantell-' \+ VERSION;/.test(read('sw.js')));
  const shellList = (read('sw.js').match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || '';
  const shell = (shellList.match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
  const shipped = files.filter((f) => /^(icantell\.html|index\.html|manifest\.webmanifest|icons\/.+\.png|vendor\/.+\.woff2)$/.test(f));
  const uncached = shipped.filter((f) => !shell.includes(f));
  check('sw.js SHELL lists every shipped file', uncached.length === 0, uncached.join(', '));
  const missing = shell.filter((f) => f !== './' && !exists(f));
  check('sw.js SHELL names only files that exist', missing.length === 0, missing.join(', '));

  // 6. Vendored files: each recorded in the build notes with a pinned version and matching sha256.
  const notes = (read('icantell.html').match(/Build notes([\s\S]*?)-->/) || [])[1] || '';
  const vendored = files.filter((f) => f.startsWith('vendor/'));
  check('vendor/ holds at least one font', vendored.some((f) => f.endsWith('.woff2')));
  for (const f of vendored) {
    const line = notes.split('\n').find((l) => l.trim().startsWith(f + ' '));
    check(f + ' recorded in build notes', !!line);
    if (!line) continue;
    check(f + ' has a pinned version', /@[\w-]+\/[\w-]+@\d+\.\d+\.\d+\b/.test(line), line.trim());
    if (f.endsWith('.woff2')) {
      const want = (line.match(/sha256 ([0-9a-f]{64})/) || [])[1];
      const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
      check(f + ' sha256 matches the build notes', want === got, 'recorded ' + want + ', file ' + got);
    }
  }
  for (const m of notes.matchAll(/^\s*(vendor\/\S+)/gm)) check('build notes entry ' + m[1] + ' exists', exists(m[1]));
  for (const m of read('icantell.html').matchAll(/url\("([^"]+)"\)/g)) check('font file ' + m[1] + ' exists', exists(m[1]));

  // 7. Manifest and icons.
  let manifest = null;
  try {
    manifest = JSON.parse(read('manifest.webmanifest'));
  } catch (e) {
    check('manifest is valid JSON', false, e.message);
  }
  if (manifest) {
    check('manifest display standalone', manifest.display === 'standalone');
    check('manifest short_name "I can tell"', manifest.short_name === 'I can tell');
    check('manifest start_url is the app', manifest.start_url === 'icantell.html');
    for (const icon of manifest.icons || []) {
      const ok = exists(icon.src);
      check('manifest icon ' + icon.src + ' exists', ok);
      if (!ok) continue;
      const buf = fs.readFileSync(path.join(ROOT, icon.src));
      const isPng = buf.slice(1, 4).toString('latin1') === 'PNG';
      const size = isPng ? buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20) : '?';
      check('manifest icon ' + icon.src + ' is a ' + icon.sizes + ' PNG', isPng && size === icon.sizes, size);
    }
    const purposes = (manifest.icons || []).map((i) => i.purpose);
    check('manifest has a maskable icon', purposes.includes('maskable'));
  }

  // 8. Test tooling pinned exactly.
  const pkg = JSON.parse(read('package.json'));
  const pw = (pkg.devDependencies || {}).playwright;
  check('package.json pins Playwright to an exact version', /^\d+\.\d+\.\d+$/.test(pw || ''), pw);
  const lock = JSON.parse(read('package-lock.json'));
  const locked = ((lock.packages || {})['node_modules/playwright'] || {}).version;
  check('package-lock.json agrees with the pin', locked === pw, locked + ' vs ' + pw);

  // 9. Text rules: no em dashes in the app, docs or tests.
  const textFiles = files.filter((f) => /\.(html|js|cjs|sh|md|json|webmanifest|svg)$/.test(f));
  const dashed = textFiles.filter((f) => read(f).includes('\u2014'));
  check('no em dashes', dashed.length === 0, dashed.join(', '));

  // 10. Banned names, from reference/scrub_list.json (gitignored).
  const scrub = path.join(ROOT, 'reference', 'scrub_list.json');
  if (!fs.existsSync(scrub)) {
    console.log('  skip  banned names: reference/scrub_list.json not present');
  } else {
    const words = JSON.parse(fs.readFileSync(scrub, 'utf8')).banned || [];
    const patterns = words.map((w) => new RegExp('\\b' + w.trim().split(/\s+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*') + '\\b', 'i'));
    const hits = [];
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f)).toString('latin1');
      patterns.forEach((re, i) => {
        if (re.test(text) || re.test(f)) hits.push(f + ' (' + words[i] + ')');
      });
    }
    let log = '';
    try {
      log = execFileSync('git', ['log', '--format=%an%n%ae%n%B', 'HEAD'], { cwd: ROOT }).toString('utf8');
    } catch (e) {
      log = '';
    }
    patterns.forEach((re, i) => {
      if (re.test(log)) hits.push('commit messages (' + words[i] + ')');
    });
    check('no banned names in files or commit messages (' + words.length + ' checked)', hits.length === 0, hits.join(', '));
  }

  console.log('\n' + passes + ' passed, ' + failures.length + ' failed');
  if (failures.length) {
    console.log('\nFailures:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
}

main();
