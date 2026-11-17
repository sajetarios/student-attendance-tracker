'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { schoolDays, computeAlerts } = require('../sardo-routes');

const weekdays = [0,1,2,3,4,5,6].map(weekday => ({ weekday, isOperatingDay: weekday > 0 && weekday < 6 }));
const learner = (date, absenceType = 'UNEXCUSED', hasPresence = false) =>
  ({ studentId: 'L-1', fullName: 'Sample Learner', gradeLevel: '8', section: 'Rizal', date, absenceType, hasPresence });

test('school days exclude school closure and weekend, include approved special day', () => {
  const days = schoolDays('2026-11-17', weekdays, [
    { date: '2026-11-12', type: 'CLOSED' },
    { date: '2026-11-14', type: 'SPECIAL_CLASS' }
  ], 9);
  assert.deepEqual(days, ['2026-11-09','2026-11-10','2026-11-11','2026-11-13','2026-11-14','2026-11-16']);
});

test('five confirmed unexcused instructional days cross weekend and closure', () => {
  const days = ['2026-11-09','2026-11-10','2026-11-11','2026-11-13','2026-11-16'];
  const computed = computeAlerts(days, days.map(date => learner(date)));
  assert.equal(computed.alerts.length, 1);
  assert.equal(computed.alerts[0].consecutiveDays, 5);
  assert.equal(computed.alerts[0].streakStart, '2026-11-09');
});

test('excused, confirmed presence, and pending dates break streak', () => {
  const dates = ['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13'];
  assert.equal(computeAlerts(dates, dates.map((d,i) => learner(d, i===2?'EXCUSED':'UNEXCUSED'))).alerts.length, 0);
  assert.equal(computeAlerts(dates, dates.map((d,i) => learner(d, 'UNEXCUSED',i===2))).alerts.length, 0);
  assert.equal(computeAlerts(dates, dates.filter((_,i) => i!==2).map(learner)).alerts.length, 0);
});

test('do not report old five-day streaks as recent alerts', () => {
  const dates=['2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07'];
  assert.equal(computeAlerts(dates, dates.slice(0,5).map(learner), 2).alerts.length, 0);
});

test('QR/manual presence makes the adviser absence a conflict, not confirmed unexcused', () => {
  const dates=['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13'];
  const rows=dates.map((d,i)=>learner(d,'UNEXCUSED',i===2));
  const calculated=computeAlerts(dates,rows);
  assert.equal(calculated.conflicts,1);
  assert.equal(calculated.alerts.length,0);
});

test('streaks remain separated by each school and learner data supplied to calculation', () => {
  const dates=['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13'];
  const one=dates.map(learner);
  const two=dates.map(d=>({...learner(d),studentId:'L-2',fullName:'Second Learner'}));
  assert.equal(computeAlerts(dates,[...one,...two]).alerts.length,2);
});
