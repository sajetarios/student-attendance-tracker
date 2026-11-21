'use strict';

const path = require('path');

// Photos and submitted SF2 files live here. On hosts with an ephemeral filesystem (Render),
// point STORAGE_DIR at a persistent disk (for example /var/data) or files vanish on every deploy.
const STORAGE_ROOT = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, 'storage'));

module.exports = {
  STORAGE_ROOT,
  STUDENT_PHOTO_ROOT: path.join(STORAGE_ROOT, 'student-photos'),
  TEACHER_PHOTO_ROOT: path.join(STORAGE_ROOT, 'teacher-photos'),
  SF2_STORAGE: path.join(STORAGE_ROOT, 'sf2')
};
