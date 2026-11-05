/**
 * Fix CP850 mojibake in translation JSON files.
 *
 * The files have UTF-8 multibyte sequences that were misread as CP850
 * characters and re-saved as UTF-8. This script detects the garbled
 * character pairs/triples (box-drawing + Latin chars) and reverses
 * the conversion, leaving already-correct characters untouched.
 *
 * Chain: original UTF-8 bytes → read as CP850 chars → saved as UTF-8
 * Fix:   garbled UTF-8 chars → get CP850 byte values → decode as UTF-8
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// CP850 Unicode code point → original byte value
// Only maps chars in the "high byte" (>= 0x80) range of CP850
const unicodeToCp850 = new Map([
  // 0x80-0x8F
  [0x00C7, 0x80], [0x00FC, 0x81], [0x00E9, 0x82], [0x00E2, 0x83],
  [0x00E4, 0x84], [0x00E0, 0x85], [0x00E5, 0x86], [0x00E7, 0x87],
  [0x00EA, 0x88], [0x00EB, 0x89], [0x00E8, 0x8A], [0x00EF, 0x8B],
  [0x00EE, 0x8C], [0x00EC, 0x8D], [0x00C4, 0x8E], [0x00C5, 0x8F],
  // 0x90-0x9F
  [0x00C9, 0x90], [0x00E6, 0x91], [0x00C6, 0x92], [0x00F4, 0x93],
  [0x00F6, 0x94], [0x00F2, 0x95], [0x00FB, 0x96], [0x00F9, 0x97],
  [0x00FF, 0x98], [0x00D6, 0x99], [0x00DC, 0x9A], [0x00F8, 0x9B],
  [0x00A3, 0x9C], [0x00D8, 0x9D], [0x00D7, 0x9E], [0x0192, 0x9F],
  // 0xA0-0xAF
  [0x00E1, 0xA0], [0x00ED, 0xA1], [0x00F3, 0xA2], [0x00FA, 0xA3],
  [0x00F1, 0xA4], [0x00D1, 0xA5], [0x00AA, 0xA6], [0x00BA, 0xA7],
  [0x00BF, 0xA8], [0x00AE, 0xA9], [0x00AC, 0xAA], [0x00BD, 0xAB],
  [0x00BC, 0xAC], [0x00A1, 0xAD], [0x00AB, 0xAE], [0x00BB, 0xAF],
  // 0xB0-0xBF (CP850 differs at 0xB5-0xB8, 0xBD-0xBE vs CP437)
  [0x2591, 0xB0], [0x2592, 0xB1], [0x2593, 0xB2], [0x2502, 0xB3],
  [0x2524, 0xB4],
  [0x00C1, 0xB5], // Á (CP850; CP437=╡)
  [0x00C2, 0xB6], // Â (CP850; CP437=╢)
  [0x00C0, 0xB7], // À (CP850; CP437=╖) — 2nd byte of · U+00B7
  [0x00A9, 0xB8], // © (CP850; CP437=╕)
  [0x2563, 0xB9], [0x2551, 0xBA], [0x2557, 0xBB],
  [0x255D, 0xBC],
  [0x00A2, 0xBD], // ¢ (CP850; CP437=╜)
  [0x00A5, 0xBE], // ¥ (CP850; CP437=╛)
  [0x2510, 0xBF],
  // 0xC0-0xCF (CP850 differs at 0xC6-0xC7, 0xCF vs CP437)
  [0x2514, 0xC0], [0x2534, 0xC1], [0x252C, 0xC2], [0x251C, 0xC3],
  [0x2500, 0xC4], [0x253C, 0xC5],
  [0x00E3, 0xC6], // ã (CP850; CP437=╞)
  [0x00C3, 0xC7], // Ã (CP850; CP437=╟)
  [0x255A, 0xC8], [0x2554, 0xC9], [0x2569, 0xCA], [0x2566, 0xCB],
  [0x2560, 0xCC], [0x2550, 0xCD], [0x256C, 0xCE],
  [0x00A4, 0xCF], // ¤ (CP850; CP437=╧)
  // 0xD0-0xDF (CP850 differs at 0xD0-0xD8 vs CP437)
  [0x00F0, 0xD0], // ð (CP850; CP437=╨)
  [0x00D0, 0xD1], // Ð (CP850; CP437=╤)
  [0x00CA, 0xD2], // Ê (CP850; CP437=╥)
  [0x00CB, 0xD3], // Ë (CP850; CP437=╙)
  [0x00C8, 0xD4], // È (CP850; CP437=╘)
  [0x0131, 0xD5], // ı (CP850; CP437=╒)
  [0x00CD, 0xD6], // Í (CP850; CP437=╓)
  [0x00CE, 0xD7], // Î (CP850; CP437=╫)
  [0x00CF, 0xD8], // Ï (CP850; CP437=╪)
  [0x2518, 0xD9], [0x250C, 0xDA], [0x2588, 0xDB],
  [0x2584, 0xDC], [0x00A6, 0xDD], [0x00CC, 0xDE], [0x2580, 0xDF],
  // 0xE0-0xEF (Latin chars that map to UTF-8 leading bytes 0xE0-0xEF for 3-byte seqs)
  [0x00D3, 0xE0], [0x00DF, 0xE1], [0x00D4, 0xE2], [0x00D2, 0xE3],
  [0x00F5, 0xE4], [0x00D5, 0xE5], [0x00B5, 0xE6], [0x00FE, 0xE7],
  [0x00DE, 0xE8], [0x00DA, 0xE9], [0x00DB, 0xEA], [0x00D9, 0xEB],
  [0x00FD, 0xEC], [0x00DD, 0xED], [0x00AF, 0xEE], [0x00B4, 0xEF],
  // 0xF0-0xFF
  [0x00AD, 0xF0], [0x00B1, 0xF1], [0x2017, 0xF2], [0x00BE, 0xF3],
  [0x00B6, 0xF4], [0x00A7, 0xF5], [0x00F7, 0xF6], [0x00B8, 0xF7],
  [0x00B0, 0xF8], [0x00A8, 0xF9], [0x00B7, 0xFA], [0x00B9, 0xFB],
  [0x00B3, 0xFC], [0x00B2, 0xFD], [0x25A0, 0xFE], [0x00A0, 0xFF],
]);

/**
 * Fix mojibake in a string. Only converts garbled character sequences
 * (high-byte CP850 char followed by continuation-byte CP850 chars),
 * leaving correctly-encoded characters untouched.
 */
function fixMojibake(text) {
  const chars = [...text]; // spread handles surrogate pairs
  const result = [];
  let i = 0;
  let fixes = 0;

  while (i < chars.length) {
    const cp = chars[i].codePointAt(0);
    const b1 = unicodeToCp850.get(cp);

    // Only trigger if this char maps to a CP850 "high byte" (0xC0-0xFF)
    // These correspond to UTF-8 leading bytes for 2/3/4-byte sequences
    if (b1 !== undefined && b1 >= 0xC0) {

      // Try 4-byte UTF-8 sequence (leading byte 0xF0-0xF7)
      if (b1 >= 0xF0 && b1 <= 0xF7 && i + 3 < chars.length) {
        const b2 = unicodeToCp850.get(chars[i + 1].codePointAt(0));
        const b3 = unicodeToCp850.get(chars[i + 2].codePointAt(0));
        const b4 = unicodeToCp850.get(chars[i + 3].codePointAt(0));
        if (b2 >= 0x80 && b2 <= 0xBF && b3 >= 0x80 && b3 <= 0xBF && b4 >= 0x80 && b4 <= 0xBF) {
          const decoded = Buffer.from([b1, b2, b3, b4]).toString('utf8');
          if (!decoded.includes('\uFFFD')) {
            result.push(decoded); i += 4; fixes++; continue;
          }
        }
      }

      // Try 3-byte UTF-8 sequence (leading byte 0xE0-0xEF)
      if (b1 >= 0xE0 && b1 <= 0xEF && i + 2 < chars.length) {
        const b2 = unicodeToCp850.get(chars[i + 1].codePointAt(0));
        const b3 = unicodeToCp850.get(chars[i + 2].codePointAt(0));
        if (b2 !== undefined && b2 >= 0x80 && b2 <= 0xBF &&
            b3 !== undefined && b3 >= 0x80 && b3 <= 0xBF) {
          const decoded = Buffer.from([b1, b2, b3]).toString('utf8');
          if (!decoded.includes('\uFFFD')) {
            result.push(decoded); i += 3; fixes++; continue;
          }
        }
      }

      // Try 2-byte UTF-8 sequence (leading byte 0xC0-0xDF)
      if (b1 >= 0xC0 && b1 <= 0xDF && i + 1 < chars.length) {
        const b2 = unicodeToCp850.get(chars[i + 1].codePointAt(0));
        if (b2 !== undefined && b2 >= 0x80 && b2 <= 0xBF) {
          const decoded = Buffer.from([b1, b2]).toString('utf8');
          if (!decoded.includes('\uFFFD')) {
            result.push(decoded); i += 2; fixes++; continue;
          }
        }
      }
    }

    // Not garbled — keep as-is
    result.push(chars[i]);
    i++;
  }

  return { fixed: result.join(''), fixes };
}

const files = [
  'apps/web/messages/en.json',
  'apps/web/messages/es.json',
  'apps/web/messages/fr.json',
];

let anyChange = false;

for (const relPath of files) {
  const filePath = path.join(ROOT, relPath);
  const original = readFileSync(filePath, 'utf8');
  const { fixed, fixes } = fixMojibake(original);

  // Verify it's still valid JSON
  try {
    JSON.parse(fixed);
  } catch (e) {
    console.error(`ERROR: ${relPath} is not valid JSON after fix: ${e.message}`);
    process.exit(1);
  }

  // Count remaining garbled chars
  let remaining = 0;
  for (const c of fixed) {
    const cp = c.codePointAt(0);
    if (cp >= 0x2500 && cp <= 0x257F) remaining++;
  }

  console.log(`${relPath}: fixed ${fixes} sequences, ${remaining} box-drawing chars remaining`);

  if (fixed !== original) {
    writeFileSync(filePath, fixed, 'utf8');
    console.log(`  → Saved.`);
    anyChange = true;
  } else {
    console.log(`  → No changes needed.`);
  }
}

// Spot-check a few key strings
console.log('\n--- Spot check es.json ---');
const esJson = JSON.parse(readFileSync(path.join(ROOT, 'apps/web/messages/es.json'), 'utf8'));
const checks = [
  ['common.appDescription', esJson?.common?.appDescription],
  ['auth.sessionAs', esJson?.auth?.sessionAs],
  ['auth.password', esJson?.auth?.password],
  ['cameras.title', esJson?.cameras?.title ?? esJson?.navigation?.cameras],
];
for (const [key, val] of checks) {
  if (val !== undefined) console.log(`  ${key}: ${val}`);
}

console.log('\n--- Spot check fr.json ---');
const frJson = JSON.parse(readFileSync(path.join(ROOT, 'apps/web/messages/fr.json'), 'utf8'));
const frChecks = [
  ['common.appDescription', frJson?.common?.appDescription],
  ['auth.sessionAs', frJson?.auth?.sessionAs],
];
for (const [key, val] of frChecks) {
  if (val !== undefined) console.log(`  ${key}: ${val}`);
}

if (!anyChange) console.log('\nAll files already clean.');
else console.log('\nDone. Review the spot-checks above before committing.');
