#!/usr/bin/env node
// icantell_behave.cjs: behavioural tests.
//   node icantell_behave.cjs            unit tests, then the app in real Chromium
//   node icantell_behave.cjs --unit     unit tests on the colour module only
//   node icantell_behave.cjs --unit --module FILE [--bail] [--quiet]
//                                       unit tests on a colour module held in FILE
//                                       (used by icantell_mutate.sh)
//
// Part 1 runs the colour module from icantell.html in Node and checks the
// maths and the naming. icantell_mutate.sh reuses Part 1 (runUnit) on
// deliberately broken copies of the module.
//
// Part 2 serves the repo on 127.0.0.1 under /icantell/ (as GitHub Pages
// does) and opens the app in Chromium with a fake camera. The camera plays
// a generated .y4m video of known colour patches, so the names on screen
// can be checked. Every request the page makes is logged and must stay on
// 127.0.0.1.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');

const ROOT = __dirname;

// ---------------------------------------------------------------------------
// Part 1: colour module unit tests
// ---------------------------------------------------------------------------

function extractColourModule(html) {
  const start = html.indexOf('// BEGIN colour module');
  const end = html.indexOf('// END colour module');
  if (start < 0 || end < 0) throw new Error('colour module markers not found in icantell.html');
  return html.slice(start, end);
}

function loadColour(src) {
  return vm.runInNewContext(src + '\n;Colour', {}, { timeout: 2000 });
}

// Local helpers, kept apart from the module so a broken module cannot
// also break the test inputs.
function lch(l, c, h) {
  const r = h * Math.PI / 180;
  return [l, c * Math.cos(r), c * Math.sin(r)];
}

function near(actual, expected, tol, what) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(what + ': expected ' + expected + ' +/- ' + tol + ', got ' + actual);
  }
}

function same(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(what + ': expected ' + e + ', got ' + a);
}

function hexRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

// Colours used by both parts. BETWEEN_RGB sits well inside the boundary
// band between green and lime, so camera noise of a few levels cannot push
// it out. FLICKER_A and FLICKER_B straddle the edge of the band between
// green and olive: averaged in mixed proportions they name differently.
const BETWEEN_RGB = [0, 216, 64];
const FLICKER_A = [120, 150, 60];
const FLICKER_B = [128, 150, 60];

const UNIT_TESTS = [
  ['srgbToLinear: ends of the scale', (C) => {
    near(C.srgbToLinear(0), 0, 1e-15, 'black');
    near(C.srgbToLinear(255), 1, 1e-12, 'white');
  }],
  ['srgbToLinear: straight segment up to 0.04045 and power curve above', (C) => {
    near(C.srgbToLinear(10), 10 / 255 / 12.92, 1e-15, 'level 10');
    near(C.srgbToLinear(10.31475), 0.04045 / 12.92, 1e-15, 'level at the threshold');
    near(C.srgbToLinear(11), 0.003346535763899161, 1e-12, 'level 11');
    near(C.srgbToLinear(128), 0.21586050011389926, 1e-12, 'level 128');
  }],
  ['linearToSrgb: inverse of srgbToLinear for every level', (C) => {
    for (let v = 0; v <= 255; v++) near(C.linearToSrgb(C.srgbToLinear(v)), v, 1e-9, 'level ' + v);
  }],
  ['linearToSrgb: straight segment up to 0.0031308 and power curve above', (C) => {
    near(C.linearToSrgb(0.002), 0.002 * 12.92 * 255, 1e-12, 'low');
    near(C.linearToSrgb(0.0031308), 0.0031308 * 12.92 * 255, 1e-9, 'at the threshold');
    near(C.linearToSrgb(0.0033), 10.854412171408109, 1e-9, 'just above');
    near(C.linearToSrgb(0.5), 187.5160306783301, 1e-9, 'middle');
  }],
  ['rgbToOklab: reference values', (C) => {
    const cases = [
      [[255, 255, 255], [1, 0, 0]],
      [[0, 0, 0], [0, 0, 0]],
      [[255, 0, 0], [0.627955, 0.224863, 0.125846]],
      [[0, 255, 0], [0.866440, -0.233888, 0.179498]],
      [[0, 0, 255], [0.452014, -0.032457, -0.311528]],
      [[128, 128, 128], [0.599871, 0, 0]],
    ];
    for (const [rgb, want] of cases) {
      const got = C.rgbToOklab(rgb);
      for (let i = 0; i < 3; i++) near(got[i], want[i], 2e-6, 'rgb ' + rgb + ' channel ' + i);
    }
  }],
  ['oklabToRgb: round trip through OKLab for a grid of colours', (C) => {
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const back = C.oklabToRgb(C.rgbToOklab([r, g, b]));
          near(back[0], r, 1e-3, 'red of ' + [r, g, b]);
          near(back[1], g, 1e-3, 'green of ' + [r, g, b]);
          near(back[2], b, 1e-3, 'blue of ' + [r, g, b]);
        }
      }
    }
  }],
  ['oklabToOklch: chroma and hue in all four quadrants', (C) => {
    same(C.oklabToOklch([0.5, 0.03, 0.04]).map((v) => +v.toFixed(12)), [0.5, 0.05, 53.130102354156], 'first quadrant');
    near(C.oklabToOklch([0.5, -0.1, 0.1])[2], 135, 1e-9, 'second quadrant');
    near(C.oklabToOklch([0.5, -0.1, -0.1])[2], 225, 1e-9, 'third quadrant');
    near(C.oklabToOklch([0.5, 0.1, -0.1])[2], 315, 1e-9, 'fourth quadrant');
    near(C.oklabToOklch([0.5, 0, -0.1])[2], 270, 1e-9, 'straight down');
    near(C.oklabToOklch([0.5, 0.1, 0])[2], 0, 1e-9, 'straight right');
  }],
  ['oklchToOklab: inverse of oklabToOklch', (C) => {
    const back = C.oklchToOklab([0.7, 0.12, 200]);
    const want = lch(0.7, 0.12, 200);
    for (let i = 0; i < 3; i++) near(back[i], want[i], 1e-12, 'channel ' + i);
    const lab = [0.4, -0.05, 0.08];
    const round = C.oklchToOklab(C.oklabToOklch(lab));
    for (let i = 0; i < 3; i++) near(round[i], lab[i], 1e-12, 'round trip channel ' + i);
  }],
  ['medianRgb: middle value per channel, odd and even counts, alpha ignored', (C) => {
    same(C.medianRgb([10, 200, 30, 255, 20, 100, 90, 0, 250, 0, 60, 7]), [20, 100, 60], 'three pixels');
    same(C.medianRgb([1, 2, 3, 0, 9, 8, 7, 0, 5, 6, 4, 0, 3, 4, 5, 0]), [4, 5, 4.5], 'four pixels');
    same(C.medianRgb([40, 40, 40, 255]), [40, 40, 40], 'one pixel');
    const glint = [];
    for (let i = 0; i < 8; i++) glint.push(50, 60, 70, 255);
    glint.push(255, 255, 255, 255);
    same(C.medianRgb(glint), [50, 60, 70], 'one bright pixel does not move it');
  }],
  ['meanLab: average of samples', (C) => {
    same(C.meanLab([[0.2, 0.1, -0.1], [0.4, -0.1, 0.3], [0.6, 0.3, 0.1]]).map((v) => +v.toFixed(12)), [0.4, 0.1, 0.1], 'three');
    same(C.meanLab([[0.5, 0.02, 0.03]]), [0.5, 0.02, 0.03], 'one');
  }],
  ['nameDistance: weights for lightness, chroma and hue, and hue wrap', (C) => {
    near(C.nameDistance([0.5, 0.1, 40], [0.5, 0.1, 40]), 0, 1e-15, 'same point');
    near(C.nameDistance([0.6, 0.1, 40], [0.5, 0.1, 40]), 0.08, 1e-12, 'lightness step 0.1');
    near(C.nameDistance([0.5, 0.2, 40], [0.5, 0.1, 40]), 0.09, 1e-12, 'chroma step 0.1');
    near(C.nameDistance([0.5, 0.1, 130], [0.5, 0.1, 40]), 0.35 * Math.PI / 2, 1e-12, 'hue turn 90');
    near(C.nameDistance([0.5, 0.1, 350], [0.5, 0.1, 10]), 0.35 * Math.PI / 9, 1e-12, 'hue wraps past 0');
    near(C.nameDistance([0.5, 0.1, 10], [0.5, 0.1, 191]), 0.35 * Math.PI * 179 / 180, 1e-12, 'hue turn 181 counts as 179');
    near(C.nameDistance([0.6, 0.2, 130], [0.5, 0.1, 40]), Math.sqrt(0.0064 + 0.0081 + Math.pow(0.35 * Math.PI / 2, 2)), 1e-12, 'all three');
  }],
  ['name table: about 30 everyday names, unique, with the agreed ones present', (C) => {
    const names = C.NAME_TABLE.map((e) => e.name);
    if (names.length < 25 || names.length > 35) throw new Error('table has ' + names.length + ' names');
    if (new Set(names).size !== names.length) throw new Error('duplicate names');
    const agreed = ['red', 'maroon', 'pink', 'orange', 'brown', 'beige', 'yellow', 'olive', 'lime', 'green',
      'teal', 'turquoise', 'blue', 'navy', 'purple', 'lavender', 'magenta', 'grey', 'black', 'white'];
    for (const n of agreed) if (!names.includes(n)) throw new Error('missing ' + n);
    same(C.NAME_TABLE.filter((e) => e.neutral).map((e) => e.name), ['black', 'grey', 'white'], 'neutral names');
  }],
  ['every table centre names itself, plainly', (C) => {
    for (const e of C.NAME_TABLE) {
      const r = C.nameColour(e.lab, null);
      same([r.text, r.family, r.modifier, r.between], [e.name, e.name, '', null], e.name);
    }
  }],
  ['everyday colours get the expected names', (C) => {
    const cases = [
      ['#FF0000', 'red'], ['#800000', 'maroon'], ['#FFC0CB', 'pink'], ['#FFA500', 'orange'],
      ['#FF8C00', 'orange'], ['#8B4513', 'bright brown'], ['#FFD700', 'yellow'], ['#808000', 'olive'],
      ['#228B22', 'green'], ['#008000', 'dark green'], ['#008080', 'teal'], ['#40E0D0', 'turquoise'],
      ['#87CEEB', 'sky blue'], ['#4169E1', 'blue'], ['#4682B4', 'blue'], ['#800080', 'purple'],
      ['#4B0082', 'dark purple'], ['#C71585', 'magenta'], ['#808080', 'grey'], ['#D3D3D3', 'light grey'],
      ['#000000', 'black'], ['#FFFFFF', 'white'], ['#708090', 'between blue and grey'],
    ];
    for (const [hex, want] of cases) same(C.nameColour(C.rgbToOklab(hexRgb(hex)), null).text, want, hex);
  }],
  ['modifiers from lightness and chroma against the matched centre (blue)', (C) => {
    const cases = [
      [[0.513, 0.172, 262.7], 'blue', ''],
      [[0.437, 0.172, 262.7], 'blue', ''],
      [[0.429, 0.172, 262.7], 'dark blue', 'dark'],
      [[0.589, 0.172, 262.7], 'blue', ''],
      [[0.597, 0.172, 262.7], 'light blue', 'light'],
      [[0.513, 0.097, 262.7], 'blue', ''],
      [[0.513, 0.091, 262.7], 'greyish blue', 'greyish'],
      [[0.62, 0.08, 262.7], 'pale blue', 'pale'],
      [[0.513, 0.229, 262.7], 'blue', ''],
      [[0.513, 0.237, 262.7], 'bright blue', 'bright'],
      [[0.6, 0.24, 262.7], 'bright blue', 'bright'],
      [[0.43, 0.24, 262.7], 'deep blue', 'deep'],
    ];
    for (const [p, text, mod] of cases) {
      const r = C.nameColour(lch(p[0], p[1], p[2]), null);
      same([r.text, r.family, r.modifier, r.between], [text, 'blue', mod, null], 'L ' + p[0] + ' C ' + p[1]);
    }
    const r = C.nameColour(lch(0.5, 0.07, 144), null);
    same([r.text, r.family, r.modifier, r.between], ['dark greyish green', 'green', 'dark greyish', null], 'dark and greyish');
  }],
  ['neutral samples: black, grey, white by lightness, with boundary bands', (C) => {
    const cases = [
      [0.1, 'black'], [0.279, 'black'], [0.285, 'between black and grey'], [0.315, 'between black and grey'],
      [0.321, 'dark grey'], [0.49, 'dark grey'], [0.51, 'grey'], [0.77, 'grey'], [0.79, 'light grey'],
      [0.899, 'light grey'], [0.905, 'between grey and white'], [0.935, 'between grey and white'],
      [0.941, 'white'], [1, 'white'],
    ];
    for (const [l, want] of cases) same(C.nameColour([l, 0, 0], null).text, want, 'L ' + l);
    const r = C.nameColour([0.6, 0, 0], null);
    same([r.family, r.modifier, r.between], ['grey', '', null], 'grey fields');
    const low = C.nameColour([0.29, 0, 0], null);
    same([low.family, low.modifier, low.between], ['black', '', ['black', 'grey']], 'between black and grey fields');
    const high = C.nameColour([0.93, 0, 0], null);
    same([high.family, high.modifier, high.between], ['white', '', ['grey', 'white']], 'between grey and white fields');
  }],
  ['low chroma: neutral below 0.025, "between grey and ..." up to 0.04, named above', (C) => {
    same(C.nameColour(lch(0.6, 0.024, 262.7), null).text, 'grey', 'C 0.024');
    same(C.nameColour(lch(0.6, 0.026, 262.7), null).text, 'between blue and grey', 'C 0.026');
    same(C.nameColour(lch(0.6, 0.039, 262.7), null).text, 'between blue and grey', 'C 0.039');
    same(C.nameColour(lch(0.6, 0.041, 262.7), null).text, 'pale blue', 'C 0.041');
    same(C.nameColour(lch(0.2, 0.03, 20), null).text, 'between black and maroon', 'dark and nearly neutral');
    same(C.nameColour(lch(0.95, 0.03, 90), null).text, 'between cream and white', 'light and nearly neutral');
    const r = C.nameColour(lch(0.6, 0.03, 262.7), null);
    same([r.family, r.modifier], ['blue', ''], 'family is the colour side');
  }],
  ['boundaries between two names are reported, in alphabetical order', (C) => {
    const mid = (a, b) => C.NAME_TABLE.find((e) => e.name === a).lab.map((v, i) => (v + C.NAME_TABLE.find((e) => e.name === b).lab[i]) / 2);
    same(C.nameColour(mid('green', 'lime'), null).text, 'between green and lime', 'green and lime');
    same(C.nameColour(mid('navy', 'blue'), null).text, 'between blue and navy', 'navy and blue');
    same(C.nameColour(mid('red', 'coral'), null).text, 'between coral and red', 'red and coral');
    const r = C.nameColour(C.rgbToOklab(BETWEEN_RGB), null);
    same([r.text, r.modifier, r.between], ['between green and lime', '', ['green', 'lime']], 'test colour');
    for (const d of [-3, 3]) {
      for (const ch of [0, 1, 2]) {
        const rgb = BETWEEN_RGB.slice();
        rgb[ch] = Math.max(0, rgb[ch] + d);
        same(C.nameColour(C.rgbToOklab(rgb), null).text, 'between green and lime', 'test colour nudged ' + rgb);
      }
    }
  }],
  ['boundary band edge: ratio of nearest to runner-up distance 0.85', (C) => {
    // Along the line from the green centre to the lime centre.
    const g = C.NAME_TABLE.find((e) => e.name === 'green').lab;
    const l = C.NAME_TABLE.find((e) => e.name === 'lime').lab;
    const at = (t) => g.map((v, i) => v + t * (l[i] - v));
    same(C.nameColour(at(0.40), null).text, 'green', 't 0.40');
    same(C.nameColour(at(0.44), null).text, 'light green', 't 0.44');
    same(C.nameColour(at(0.45), null).text, 'between green and lime', 't 0.45');
    same(C.nameColour(at(0.52), null).text, 'between green and lime', 't 0.52');
    same(C.nameColour(at(0.53), null).text, 'dark lime', 't 0.53');
    same(C.nameColour(at(0.60), null).text, 'lime', 't 0.60');
  }],
  ['hysteresis: a plain name shown last time holds near a boundary; a "between" does not', (C) => {
    const g = C.NAME_TABLE.find((e) => e.name === 'green').lab;
    const l = C.NAME_TABLE.find((e) => e.name === 'lime').lab;
    const at = (t) => g.map((v, i) => v + t * (l[i] - v));
    const shown = (family) => ({ text: family, family, modifier: '', between: null });
    same(C.nameColour(at(0.47), null).text, 'between green and lime', 'fresh');
    same(C.nameColour(at(0.47), shown('green')).text, 'light green', 'held by green');
    same(C.nameColour(at(0.50), shown('lime')).text, 'dark lime', 'held by lime');
    same(C.nameColour(at(0.55), null).text, 'dark lime', 'fresh, past the band');
    same(C.nameColour(at(0.55), shown('green')).text, 'between green and lime', 'green still pulls');
    same(C.nameColour(at(0.58), shown('green')).text, 'dark lime', 'too far to hold');
    same(C.nameColour(at(0.47), shown('blue')).text, 'between green and lime', 'another name has no pull');
    const onBoundary = C.nameColour(at(0.47), null);
    for (const t of [0.46, 0.47, 0.48, 0.5]) {
      same(C.nameColour(at(t), onBoundary).text, 'between green and lime', 'after a between answer, t ' + t);
    }
    same(C.nameColour(at(0.44), onBoundary).text, 'light green', 'between answer left once past the band');
  }],
  ['flicker test colours straddle a boundary when mixed', (C) => {
    const a = C.rgbToOklab(FLICKER_A);
    const b = C.rgbToOklab(FLICKER_B);
    const n1 = C.nameColour(C.meanLab([a, a, a, b, b]), null).text;
    const n2 = C.nameColour(C.meanLab([a, a, b, b, b]), null).text;
    if (n1 === n2) throw new Error('both mixes name ' + n1);
  }],
];

// Run Part 1 against a copy of icantell.html (or just its colour module).
// Returns { passed, failed: [names with reasons] }. bail stops at the first failure.
function runUnit(htmlOrSrc, opts) {
  const bail = opts && opts.bail;
  const src = htmlOrSrc.includes('<html') ? extractColourModule(htmlOrSrc) : htmlOrSrc;
  const out = { passed: 0, failed: [] };
  let C;
  try {
    C = loadColour(src);
  } catch (e) {
    out.failed.push('module loads: ' + e.message);
    return out;
  }
  for (const [name, fn] of UNIT_TESTS) {
    try {
      fn(C);
      out.passed += 1;
    } catch (e) {
      out.failed.push(name + ': ' + e.message);
      if (bail) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Part 2: the app in Chromium with a fake camera
// ---------------------------------------------------------------------------

// sRGB to YUV, BT.601 limited range, which Chromium assumes for the fake camera.
function rgbToYuv(rgb) {
  const [r, g, b] = rgb;
  const y = 16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255;
  const u = 128 + (-37.797 * r - 74.203 * g + 112 * b) / 255;
  const v = 128 + (112 * r - 93.786 * g - 18.214 * b) / 255;
  return [y, u, v].map((x) => Math.max(0, Math.min(255, Math.round(x))));
}

// Write a .y4m video. Each frame is a function (x, y) -> [r, g, b];
// chroma is taken at the top-left pixel of each 2 x 2 block.
function writeY4m(file, width, height, fps, frames) {
  const parts = [Buffer.from('YUV4MPEG2 W' + width + ' H' + height + ' F' + fps + ':1 Ip A1:1 C420jpeg\n')];
  for (const paint of frames) {
    const yPlane = Buffer.alloc(width * height);
    const uPlane = Buffer.alloc((width / 2) * (height / 2));
    const vPlane = Buffer.alloc((width / 2) * (height / 2));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [yy, uu, vv] = rgbToYuv(paint(x, y));
        yPlane[y * width + x] = yy;
        if (x % 2 === 0 && y % 2 === 0) {
          const k = (y / 2) * (width / 2) + x / 2;
          uPlane[k] = uu;
          vPlane[k] = vv;
        }
      }
    }
    parts.push(Buffer.from('FRAME\n'), yPlane, uPlane, vPlane);
  }
  fs.writeFileSync(file, Buffer.concat(parts));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// Serves the repo under /icantell/. swSuffix lets a test publish a changed sw.js.
function startServer() {
  const state = { swSuffix: '' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname);
    if (!rel.startsWith('/icantell/')) {
      res.writeHead(404);
      res.end();
      return;
    }
    rel = rel.slice('/icantell/'.length) || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || rel.startsWith('reference/') || rel.startsWith('node_modules/')
        || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = fs.readFileSync(file);
    if (rel === 'sw.js' && state.swSuffix) body = Buffer.concat([body, Buffer.from('\n' + state.swSuffix + '\n')]);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      state.origin = 'http://127.0.0.1:' + server.address().port;
      state.base = state.origin + '/icantell/';
      state.close = () => new Promise((r) => server.close(r));
      resolve(state);
    });
  });
}

const VIEWPORTS = [
  ['narrow portrait', 360, 800],
  ['narrow landscape', 800, 360],
  ['square portrait', 860, 950],
  ['square landscape', 950, 860],
];

async function runBrowser() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.log('  FAIL  Playwright not installed: run npm install');
    return { passed: 0, failed: ['Playwright not installed'] };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icantell-'));
  const server = await startServer();
  const result = { passed: 0, failed: [] };
  const offsite = [];
  const C = loadColour(extractColourModule(fs.readFileSync(path.join(ROOT, 'icantell.html'), 'utf8')));
  const expectName = (rgb) => C.nameColour(C.rgbToOklab(rgb), null).text;

  async function test(name, fn) {
    try {
      await fn();
      result.passed += 1;
      console.log('  pass  ' + name);
    } catch (e) {
      result.failed.push(name + ': ' + e.message.split('\n')[0]);
      console.log('  FAIL  ' + name + ': ' + e.message.split('\n')[0]);
    }
  }

  // One browser per camera video. grant false leaves the camera blocked.
  async function withCamera(y4m, fn, opts) {
    const grant = !(opts && opts.grant === false);
    const args = ['--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + y4m];
    args.push(grant ? '--use-fake-ui-for-media-stream' : '--use-fake-ui-for-media-stream=deny');
    const browser = await chromium.launch({ args });
    const context = await browser.newContext({
      viewport: (opts && opts.viewport) || { width: 360, height: 800 },
      permissions: grant ? ['camera'] : [],
    });
    const errors = [];
    context.on('request', (req) => {
      const u = req.url();
      if (!u.startsWith(server.origin + '/') && !/^(data|blob):/.test(u)) offsite.push(u);
    });
    context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
    try {
      await fn(context, errors);
    } finally {
      await browser.close();
    }
  }

  async function openApp(context, file) {
    const page = await context.newPage();
    await page.goto(server.base + (file || 'icantell.html'));
    return page;
  }

  async function waitForAnswer(page, want, timeout) {
    try {
      await page.waitForFunction((w) => document.getElementById('answer').textContent === w, want, { timeout: timeout || 6000 });
    } catch (e) {
      const got = await page.textContent('#answer');
      throw new Error('expected "' + want + '", screen shows "' + got + '"');
    }
  }

  // The answer must arrive and then stay put.
  async function waitForSteadyAnswer(page, want) {
    await waitForAnswer(page, want);
    await page.waitForTimeout(1200);
    const later = await page.textContent('#answer');
    if (later !== want) throw new Error('showed "' + want + '", then changed to "' + later + '"');
  }

  function solid(rgb) {
    const file = path.join(tmp, 'solid-' + rgb.join('-') + '.y4m');
    writeY4m(file, 320, 240, 10, [() => rgb]);
    return file;
  }

  console.log('\nApp in Chromium');

  // Name it on solid colours.
  const named = ['#D42A2A', '#3A9A3E', '#2D5FC8', '#F5D327', '#F28C28', '#6E3596', '#F2A2B8', '#7A4A28',
    '#1A2A70', '#1F5F22', '#8A8A8A', '#F5F5F5', '#141414'];
  for (const hex of named) {
    const rgb = hexRgb(hex);
    const want = expectName(rgb);
    await test('Name it: ' + hex + ' reads "' + want + '"', () => withCamera(solid(rgb), async (context, errors) => {
      const page = await openApp(context);
      await waitForSteadyAnswer(page, want);
      const readout = await page.textContent('#readout');
      if (!/^L \d\.\d\d {2}C \d\.\d\d {2}h \d+°$/.test(readout)) throw new Error('readout "' + readout + '"');
      if (errors.length) throw new Error('page errors: ' + errors.join('; '));
    }));
  }
  const spot = [['dark green', [31, 95, 34]], ['between', BETWEEN_RGB]];
  for (const [label, rgb] of spot) {
    const want = expectName(rgb);
    await test('Name it: ' + label + ' ' + rgb + ' reads "' + want + '"', () => withCamera(solid(rgb), async (context) => {
      await waitForSteadyAnswer(await openApp(context), want);
    }));
  }

  // Centre patch on a different surround: the crosshair must read the
  // middle of the camera image at every screen shape, and after folding.
  const patchRgb = hexRgb('#2D5FC8');
  const surroundRgb = hexRgb('#F28C28');
  const patchFile = path.join(tmp, 'centre.y4m');
  writeY4m(patchFile, 640, 480, 10, [(x, y) => (Math.abs(x - 320) < 32 && Math.abs(y - 240) < 32 ? patchRgb : surroundRgb)]);
  const patchName = expectName(patchRgb);

  async function checkLayout(page, label) {
    const m = await page.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      const view = r(document.querySelector('.view'));
      const cross = r(document.getElementById('crosshair'));
      const band = r(document.getElementById('band'));
      const answer = document.getElementById('answer');
      const buttons = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => [b.id, r(b).width, r(b).height]);
      return {
        w: innerWidth, h: innerHeight,
        scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
        viewCx: view.left + view.width / 2, viewCy: view.top + view.height / 2,
        crossCx: cross.left + cross.width / 2, crossCy: cross.top + cross.height / 2,
        band: [band.left, band.top, band.right, band.bottom],
        answerBox: [r(answer).left, r(answer).right],
        fontSize: parseFloat(getComputedStyle(answer).fontSize),
        message: answer.classList.contains('message'),
        buttons,
      };
    });
    const where = label + ': ';
    if (m.scrollW > m.w || m.scrollH > m.h) throw new Error(where + 'page scrolls (' + m.scrollW + 'x' + m.scrollH + ')');
    if (Math.abs(m.viewCx - m.crossCx) > 1 || Math.abs(m.viewCy - m.crossCy) > 1) throw new Error(where + 'crosshair off centre');
    if (m.band[0] < 0 || m.band[1] < 0 || m.band[2] > m.w + 0.5 || m.band[3] > m.h + 0.5) throw new Error(where + 'answer band off screen ' + m.band);
    if (m.answerBox[1] > m.w + 0.5) throw new Error(where + 'answer runs off screen');
    if (m.fontSize < (m.message ? 18 : 28)) throw new Error(where + 'answer type ' + m.fontSize + ' px');
    for (const [id, bw, bh] of m.buttons) if (bw < 44 || bh < 44) throw new Error(where + id + ' button ' + bw + 'x' + bh);
  }

  await test('Layout: every screen shape reads the centre and keeps the band on screen', () => withCamera(patchFile, async (context) => {
    for (const [label, w, h] of VIEWPORTS) {
      const page = await context.newPage();
      await page.setViewportSize({ width: w, height: h });
      await page.goto(server.base + 'icantell.html');
      await waitForAnswer(page, patchName);
      await checkLayout(page, label);
      await page.close();
    }
  }));

  await test('Layout: survives folding and turning mid-use', () => withCamera(patchFile, async (context) => {
    const page = await openApp(context);
    await waitForAnswer(page, patchName);
    for (const [label, w, h] of [VIEWPORTS[3], VIEWPORTS[1], VIEWPORTS[2], VIEWPORTS[0]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      await waitForAnswer(page, patchName);
      await checkLayout(page, 'after resize to ' + label);
    }
  }));

  await test('Steady: the name does not flicker on a boundary', async () => {
    const file = path.join(tmp, 'flicker.y4m');
    const frames = [];
    for (let i = 0; i < 6; i++) frames.push(() => (i % 2 ? FLICKER_B : FLICKER_A));
    writeY4m(file, 320, 240, 30, frames);
    await withCamera(file, async (context) => {
      const page = await openApp(context);
      await page.waitForFunction(() => document.getElementById('answer').textContent !== 'Starting camera');
      await page.evaluate(() => {
        window.__changes = [];
        new MutationObserver(() => window.__changes.push(document.getElementById('answer').textContent))
          .observe(document.getElementById('answer'), { childList: true, characterData: true, subtree: true });
      });
      await page.waitForTimeout(1000);
      await page.evaluate(() => { window.__changes = []; });
      await page.waitForTimeout(4000);
      const changes = await page.evaluate(() => window.__changes);
      if (changes.length > 1) throw new Error(changes.length + ' changes in 4 s: ' + changes.join(' | '));
    });
  });

  await test('Camera blocked: one line saying how to allow it, and Try again', () => withCamera(solid([128, 128, 128]), async (context) => {
    const page = await openApp(context);
    await page.waitForFunction(() => document.getElementById('answer').textContent.startsWith('Camera blocked'), null, { timeout: 6000 });
    const text = await page.textContent('#answer');
    if (text !== 'Camera blocked. Allow it in Chrome: Settings, Site settings, Camera.') throw new Error('message "' + text + '"');
    if (!(await page.isVisible('#retry'))) throw new Error('Try again not shown');
    await checkLayout(page, 'blocked');
  }, { grant: false }));

  await test('Out of sight: camera closes when hidden and reopens when back', () => withCamera(solid(patchRgb), async (context) => {
    const page = await openApp(context);
    await waitForAnswer(page, patchName);
    const setVisibility = (state) => page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
    const live = () => page.evaluate(() => {
      const s = document.getElementById('video').srcObject;
      return !!s && s.getTracks().some((t) => t.readyState === 'live');
    });
    const tracks = await page.evaluate(() => { window.__tracks = document.getElementById('video').srcObject.getTracks(); return window.__tracks.length; });
    if (tracks < 1) throw new Error('no camera track');
    await setVisibility('hidden');
    const stopped = await page.evaluate(() => window.__tracks.every((t) => t.readyState === 'ended'));
    if (!stopped || await live()) throw new Error('camera still running while hidden');
    await setVisibility('visible');
    await page.waitForFunction(() => {
      const s = document.getElementById('video').srcObject;
      return !!s && s.getTracks().some((t) => t.readyState === 'live');
    }, null, { timeout: 5000 });
    await waitForAnswer(page, patchName);
  }));

  await test('Privacy: CSP blocks calls to any other site', () => withCamera(solid(patchRgb), async (context) => {
    const page = await openApp(context);
    const out = await page.evaluate(async () => {
      const seen = [];
      document.addEventListener('securitypolicyviolation', (e) => seen.push(e.effectiveDirective));
      let fetched = 'sent';
      try {
        await fetch('https://example.com/collect');
      } catch (e) {
        fetched = 'blocked';
      }
      try {
        new WebSocket('wss://example.com/socket');
      } catch (e) {
        seen.push('ws-threw');
      }
      try {
        navigator.sendBeacon('https://example.com/beacon', 'x');
      } catch (e) {
        seen.push('beacon-threw');
      }
      await new Promise((r) => setTimeout(r, 300));
      return { fetched, seen };
    });
    if (out.fetched !== 'blocked') throw new Error('fetch was not blocked');
    if (!out.seen.includes('connect-src')) throw new Error('no connect-src violation: ' + out.seen.join(','));
  }));

  await test('Install: manifest, icons and fonts load from the site', () => withCamera(solid(patchRgb), async (context) => {
    const page = await openApp(context);
    const m = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]').href;
      const res = await fetch(link);
      const manifest = await res.json();
      const icons = [];
      for (const i of manifest.icons) {
        const img = new Image();
        img.src = new URL(i.src, link).href;
        await img.decode();
        icons.push(img.naturalWidth + 'x' + img.naturalHeight);
      }
      const faces = ['400 16px "Source Sans 3"', '600 16px "Source Sans 3"', '400 16px "JetBrains Mono"'];
      const loaded = [];
      for (const f of faces) loaded.push((await document.fonts.load(f)).length);
      return { type: res.headers.get('content-type'), manifest, icons, loaded, title: document.title };
    });
    if (m.manifest.display !== 'standalone' || m.manifest.short_name !== 'I can tell') throw new Error('manifest fields');
    same(m.icons, ['192x192', '512x512', '512x512'], 'icon sizes');
    same(m.loaded, [1, 1, 1], 'fonts loaded');
    same(m.title, 'I can tell', 'title');
  }));

  await test('Offline: after one visit the app, fonts and camera work with no network', () => withCamera(solid(patchRgb), async (context) => {
    const page = await openApp(context);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
      }
    });
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const cache = await caches.open(keys[0]);
      return { keys, count: (await cache.keys()).length };
    });
    same(cached.keys, ['icantell-' + (await page.getAttribute('html', 'data-version'))], 'cache name');
    if (cached.count < 10) throw new Error('only ' + cached.count + ' files cached');
    await context.setOffline(true);
    await page.reload();
    await waitForAnswer(page, patchName);
    const fonts = await page.evaluate(async () => {
      const out = [];
      for (const f of ['400 16px "Source Sans 3"', '600 16px "Source Sans 3"', '400 16px "JetBrains Mono"']) out.push((await document.fonts.load(f)).length);
      return out;
    });
    same(fonts, [1, 1, 1], 'fonts offline');
    await page.goto(server.base);
    await page.waitForURL(/icantell\.html$/);
    await waitForAnswer(page, patchName);
    await context.setOffline(false);
  }));

  await test('Start page: the site address opens the app', () => withCamera(solid(patchRgb), async (context) => {
    const page = await context.newPage();
    await page.goto(server.base);
    await page.waitForURL(/icantell\.html$/);
    await waitForAnswer(page, patchName);
  }));

  await test('Update: a new version offers "Update available" and Reload switches to it', () => withCamera(solid(patchRgb), async (context) => {
    const page = await openApp(context);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
      }
    });
    if (await page.isVisible('#update')) throw new Error('update bar shown before any update');
    const before = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
    server.swSuffix = '// test release ' + Date.now();
    try {
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await page.waitForSelector('#update', { state: 'visible', timeout: 8000 });
      await checkLayout(page, 'update bar');
      await Promise.all([page.waitForEvent('load', { timeout: 8000 }), page.click('#reload')]);
      await waitForAnswer(page, patchName);
      if (await page.isVisible('#update')) throw new Error('update bar still shown after reload');
      const after = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return { waiting: !!reg.waiting, url: navigator.serviceWorker.controller.scriptURL };
      });
      if (after.waiting || after.url !== before) throw new Error('new version not in charge');
    } finally {
      server.swSuffix = '';
    }
  }));

  await test('Privacy: every request in this run stayed on the local site', async () => {
    if (offsite.length) throw new Error(offsite.join(' '));
  });

  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  return result;
}

async function main() {
  const argv = process.argv.slice(2);
  const unitOnly = argv.includes('--unit');
  const quiet = argv.includes('--quiet');
  const bail = argv.includes('--bail');
  const moduleArg = argv.indexOf('--module');
  const source = moduleArg >= 0
    ? fs.readFileSync(argv[moduleArg + 1], 'utf8')
    : fs.readFileSync(path.join(ROOT, 'icantell.html'), 'utf8');

  if (!quiet) console.log('Colour module');
  const unit = runUnit(source, { bail });
  if (!quiet) {
    for (const [name] of UNIT_TESTS) {
      const fail = unit.failed.find((f) => f.startsWith(name + ':'));
      console.log((fail ? '  FAIL  ' + fail : '  pass  ' + name));
    }
    const other = unit.failed.filter((f) => !UNIT_TESTS.some(([n]) => f.startsWith(n + ':')));
    if (other.length) console.log('  FAIL  ' + other.join('; '));
  }
  let passed = unit.passed;
  let failed = unit.failed.slice();

  if (!unitOnly && moduleArg < 0) {
    const browser = await runBrowser();
    passed += browser.passed;
    failed = failed.concat(browser.failed);
  }

  if (!quiet) console.log('\n' + passed + ' passed, ' + failed.length + ' failed');
  if (failed.length) {
    if (!quiet) console.log('\nFailures:\n  ' + failed.join('\n  '));
    process.exit(1);
  }
}

module.exports = { runUnit, extractColourModule, UNIT_TESTS };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
