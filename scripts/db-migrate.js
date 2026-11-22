'use strict';
// Manual schema operations must use the same authoritative database target as
// the running Attendigo server. Never fall back from Supabase to Render.
require('dotenv').config();
const { Pool } = require('pg');
const { runMigrations } = require('./migrate');

async function resolveMigrationPoolOptions(env=process.env,downloadCa){
 const mode=env.ATTENDIGO_PRIMARY_DATABASE||'render';
 if(!['render','supabase'].includes(mode))throw Error('Unknown Attendigo primary database mode.');
 if(mode==='render'){
  if(!env.DATABASE_URL)throw Error('DATABASE_URL is required for the Render primary.');
  return {connectionString:env.DATABASE_URL};
 }
 if(!env.SUPABASE_DATABASE_URL)throw Error('SUPABASE_DATABASE_URL is required for the Supabase primary.');
 const {inspectTarget,downloadOfficialRootCa}=require('./supabase-connection-preflight');
 if(inspectTarget(env.SUPABASE_DATABASE_URL).status!=='configured')
  throw Error('Supabase migration refused: not the approved Attendigo database.');
 const ca=await (downloadCa||downloadOfficialRootCa)();
 if(!ca||!ca.startsWith('-----BEGIN CERTIFICATE-----'))
  throw Error('Supabase migration refused: trusted database certificate unavailable.');
 const url=new URL(env.SUPABASE_DATABASE_URL);
 url.searchParams.delete('sslmode');
 url.searchParams.delete('sslrootcert');
 return {connectionString:url.toString(),ssl:{ca,rejectUnauthorized:true}};
}
async function main(){
 const options=await resolveMigrationPoolOptions();
 const pool=new Pool(options);
 try{
  const result=await runMigrations(pool);
  console.log('[Migrations] Verified primary='+((process.env.ATTENDIGO_PRIMARY_DATABASE||'render'))+
    ' applied='+result.applied.length+' total='+result.total);
 }finally{await pool.end();}
}
if(require.main===module)main().catch(error=>{
 console.error('[Migrations] Refused or failed: '+(error.code||error.message));
 process.exitCode=1;
});
module.exports={resolveMigrationPoolOptions};
