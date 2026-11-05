#!/usr/bin/env node
/**
 * Bumps the patch version in both root and apps/web package.json.
 * Usage: node scripts/bump-version.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const packagePaths = [
  resolve(root, 'package.json'),
  resolve(root, 'apps', 'web', 'package.json'),
];

function bumpPatch(version) {
  const parts = version.split('.').map(Number);
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join('.');
}

let newVersion;

for (const pkgPath of packagePaths) {
  const raw = readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw);

  if (!newVersion) {
    newVersion = bumpPatch(pkg.version);
  }

  pkg.version = newVersion;

  // Preserve trailing newline if present
  const updated = JSON.stringify(pkg, null, 2) + (raw.endsWith('\n') ? '\n' : '');
  writeFileSync(pkgPath, updated, 'utf-8');
  console.log(`✓ ${pkgPath.replace(root, '.')} → ${newVersion}`);
}

console.log(`\nVersion bumped to ${newVersion}`);
