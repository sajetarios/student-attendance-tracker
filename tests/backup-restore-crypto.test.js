'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {parseDb,postgresEnv,encryptArchive,decryptArchive}=require('../scripts/verified-database-backup');
test('encrypted backup round-trip verifies content without writing plaintext externally',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'attendigo-backup-test-'));
 const secret=crypto.randomBytes(32);
 try{
  const original=crypto.randomBytes(16000),plain=path.join(dir,'source.dump');
  const encrypted=path.join(dir,'backup.attbk'),recovered=path.join(dir,'recovered.dump');
  await fs.writeFile(plain,original);
  await encryptArchive(plain,encrypted,secret);
  const raw=await fs.readFile(encrypted);
  assert.equal(raw.includes(original.subarray(0,32)),false);
  await decryptArchive(encrypted,recovered,secret);
  assert.deepEqual(await fs.readFile(recovered),original);
  await fs.unlink(recovered);
  raw[raw.length-19]^=0xff;
  await fs.writeFile(encrypted,raw);
  await assert.rejects(decryptArchive(encrypted,recovered,secret),/authenticate|Unsupported state|decrypt/i);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('backup target parser accepts only explicit Postgres URLs and controls password exposure',()=>{
 assert.throws(()=>parseDb('https://untrusted.example/data'),/PostgreSQL URL/);
 assert.throws(()=>parseDb('postgres://dbhost'),/Incomplete PostgreSQL/);
 const u=parseDb('postgres://teacher:%23secret@localhost:5432/school_attendance_test');
 const env=postgresEnv(u);
 assert.equal(env.PGHOST,'localhost');
 assert.equal(env.PGPASSWORD,'#secret');
 assert.equal(env.PGSSLMODE,'disable');
});
