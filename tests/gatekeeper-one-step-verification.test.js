'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {assertCachedAsset,assertCacheRevisionAtLeast}=require('./support/asset-contract');

const html = fs.readFileSync('public/portal.html', 'utf8');
const portal = fs.readFileSync('public/portal.js', 'utf8');
const worker = fs.readFileSync('public/sw.js', 'utf8');

test('Gatekeeper records from the first QR dialog, not a second verification panel', () => {
  for (const id of ['studentScanNoticeRecord', 'studentScanNoticeClear', 'studentScanNoticePhotoWarning', 'studentScanNoticeConfirmation'])
    assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(portal, /noticeContinue\.hidden = isGateVerification/);
  assert.match(portal, /noticeRecord\.hidden = !isGateVerification/);
  assert.match(portal, /\$\('studentScanResult'\)\.hidden = user\.role === 'GATE_KEEPER'/);
  assert.match(portal, /const verificationMarkup = isTeacherPerson && user.role === 'GATE_KEEPER'/);
  assert.match(portal, /noticeDtr.appendChild\(prediction\)/);
  assert.match(portal, /expectedGateEventType:scan\.expectedGateEventType/);
  assert.equal((html.match(/id="studentPhotoVerified"/g) || []).length, 1);
});

test('Only explicit guard confirmation records after a registered photo loads', () => {
  assert.match(portal, /noticeRecord\.disabled = !photo/);
  assert.match(portal, /noticePhotoWarning\.hidden = !isGateVerification \|\| Boolean\(photo\)/);
  assert.match(portal, /photo\.hidden \|\| !photo\.src/);
  assert.match(portal, /\$\('studentPhotoVerified'\)\.checked = true/);
  assert.match(portal, /if \(scannedTeacher\) await recordTeacherAutomaticGatePunch\(\)/);
  assert.match(portal, /else await recordStudentAutomaticGatePunch\(\)/);
  assert.match(portal, /clientEventKey:scan\.autoEventId/);
  assert.match(portal, /automatic gate direction cannot be verified/);
});

test('DTR remains separate and role-protected while scan popup supports cancel', () => {
  assert.match(portal, /noticeDtr\.appendChild\(fallback\)/);
  assert.match(portal, /recordTeacherDtrSlot\(\)/);
  assert.match(portal, /user\.role !== 'GATE_KEEPER'/);
  assert.match(portal, /clearGateScanDialog\(\)/);
  assert.match(portal, /teacher-auto-event/);
  assert.match(portal, /gatekeeper\/dtr/);
});

test('PWA uses one coherent scanner asset revision', () => {
  assertCachedAsset(html,worker,'portal.js',{minimumVersion:216});
  assertCacheRevisionAtLeast(worker,268);
});
