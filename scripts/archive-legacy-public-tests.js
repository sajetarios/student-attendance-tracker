'use strict';

// Archives obsolete test scripts that were mistakenly left in public/.
// They are not part of the supported test suite and must not be web-accessible.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const candidates = [
  'public/server_teacher_management_test.js',
  'public/server_rbac_teacher_admin_test.js'
];
const archiveDir = path.join(root, 'archive', 'legacy-public-tests');
let moved = 0;

for (const relativePath of candidates) {
  const source = path.join(root, relativePath);
  if (!fs.existsSync(source)) continue;

  fs.mkdirSync(archiveDir, { recursive: true });
  const destination = path.join(archiveDir, path.basename(source));
  if (fs.existsSync(destination)) {
    throw new Error(`Refusing to overwrite archived file: ${destination}`);
  }
  fs.renameSync(source, destination);
  console.log(`Archived ${relativePath} -> ${path.relative(root, destination)}`);
  moved += 1;
}

if (moved === 0) {
  console.log('No legacy public test scripts were found.');
} else {
  console.log(`Archived ${moved} legacy test script(s).`);
}
