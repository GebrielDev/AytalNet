#!/usr/bin/env node
/**
 * Runs the test suite under Node's built-in test runner.
 *
 * This exists instead of passing `--test "tests/**\/*.test.ts"` directly:
 * glob expansion by the test runner only landed in Node 22.6, so on the Node
 * 18 floor this package declares, the pattern is taken as a literal path and
 * the suite never runs. Enumerating the files here keeps `npm test` working on
 * every supported version.
 *
 * Paths passed through (`npm test -- tests/foo.test.ts`) replace the discovery
 * step, so a single file can be run directly.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TESTS_DIR = path.join(__dirname, '..', 'tests');
const SUFFIX = '.test.ts';

const findTests = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return findTests(entryPath);
    return entry.isFile() && entry.name.endsWith(SUFFIX) ? [entryPath] : [];
  });

const requested = process.argv.slice(2);
const files = requested.length > 0 ? requested : findTests(TESTS_DIR).sort();

// A runner that finds nothing must fail: an empty pass is how a broken test
// command gets mistaken for a green suite.
if (files.length === 0) {
  console.error(`No ${SUFFIX} files found under ${TESTS_DIR}`);
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [
    '--require',
    'ts-node/register',
    '--require',
    path.join(TESTS_DIR, 'setupEnv.ts'),
    '--test',
    ...files,
  ],
  { stdio: 'inherit', cwd: path.join(__dirname, '..') }
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
