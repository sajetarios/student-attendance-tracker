'use strict';
require('dotenv').config();
const {Pool}=require('pg');
const {startSmsWorker}=require('./sms-service');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const worker=startSmsWorker(pool);
// Keep the standalone process alive; embedded workers use the web server's lifetime.
const keepAlive=setInterval(()=>{},60000);
async function stop(){clearInterval(keepAlive);await worker.stop();await pool.end();}
process.once('SIGTERM',stop);process.once('SIGINT',stop);
