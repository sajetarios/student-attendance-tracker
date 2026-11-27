'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {lockStaffAuthorization,approvedObOverlapsLeave,approvedObConflicts}=require('../attendance-authorization-conflicts');
test('authorization lock is school and employee scoped, and fails closed without scope',async()=>{
 const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});return {rowCount:0}}};
 await lockStaffAuthorization(db,'school','staff');
 assert.deepEqual(calls[0].args,['school:leave:staff']);
 await assert.rejects(lockStaffAuthorization(db,'school',null));
});
test('leave conflict query uses verified OB completion and half-open Manila boundaries',async()=>{
 const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});return {rowCount:1}}};
 assert.equal(await approvedObOverlapsLeave(db,'s','u','2026-11-25','2026-11-25'),true);
 assert.deepEqual(calls[0].args,['s','u','2026-11-25','2026-11-25']);
 assert.match(calls[0].sql,/o\.completion_status='VERIFIED'/);
 assert.match(calls[0].sql,/Asia\/Manila/);
 assert.match(calls[0].sql,/o\.starts_at </);
 assert.match(calls[0].sql,/\) > \(\$3::date/);
});
test('OB collision excludes the same request and includes only active leave and approved OB',async()=>{
 const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});return {rowCount:0}}};
 assert.equal(await approvedObConflicts(db,'s','u','r'),false);
 assert.deepEqual(calls[0].args,['s:leave:u']);
 assert.deepEqual(calls[1].args,['s','u','r']);
 assert.match(calls[1].sql,/other\.request_id<>current_ob\.request_id/);
 assert.match(calls[1].sql,/l\.revoked_at IS NULL/);
 assert.match(calls[1].sql,/other\.status='APPROVED'/);
});
