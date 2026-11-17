'use strict';

const crypto = require('node:crypto');
const {receiveCloudOperation,NeedsReview} = require('./cloud-mixed-operations');

const SECRET = () => process.env.CLOUD_SYNC_SHARED_SECRET || '';
const secretReady = () => SECRET().length >= 32;
const sign = (secret, timestamp, nonce, body) => crypto.createHmac('sha256', secret)
  .update(`${timestamp}.${nonce}.`).update(body).digest('hex');
const safeEqualHex = (left, right) => {
  if (!/^[a-f0-9]{64}$/i.test(left || '') || !/^[a-f0-9]{64}$/i.test(right || '')) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
};

function signedHeaders(body = '') {
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  return { 'X-Cloud-Timestamp': timestamp, 'X-Cloud-Nonce': nonce,
    'X-Cloud-Signature': sign(SECRET(), timestamp, nonce, body) };
}

function verifyCloudSignature(req, res, next) {
  if (!secretReady()) return res.status(503).json({ error: 'Cloud sync is not configured on this server.' });
  const timestamp = req.get('X-Cloud-Timestamp') || '';
  const nonce = req.get('X-Cloud-Nonce') || '';
  const supplied = req.get('X-Cloud-Signature') || '';
  const body = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.alloc(0);
  if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000 ||
      !/^[0-9a-f-]{36}$/i.test(nonce) || !safeEqualHex(sign(SECRET(), timestamp, nonce, body), supplied)) {
    return res.status(401).json({ error: 'Cloud sync request signature is invalid or expired.' });
  }
  req.cloudSyncNonce = nonce;
  return next();
}

// New mixed-type relay requires one separate HMAC secret per school. A global
// cloud secret must not let one local school impersonate another tenant.
function verifySchoolCloudSignature(req,res,next) {
  const code=typeof req.body?.schoolCode==='string'?req.body.schoolCode.trim():'';
  let map={};
  try { map=JSON.parse(process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON||'{}'); }
  catch { return res.status(503).json({error:'Cloud school secrets are misconfigured.'}); }
  const secret=Object.entries(map).find(([key])=>key.toLowerCase()===code.toLowerCase())?.[1];
  if(!code || typeof secret!=='string' || secret.length<32)
    return res.status(503).json({error:'Per-school cloud synchronization credentials are not configured.'});
  const timestamp=req.get('X-Cloud-Timestamp')||'';
  const nonce=req.get('X-Cloud-Nonce')||'';
  const supplied=req.get('X-Cloud-Signature')||'';
  const body=Buffer.isBuffer(req.rawBody)?req.rawBody:Buffer.alloc(0);
  if(!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>5*60*1000||
     !/^[0-9a-f-]{36}$/i.test(nonce)||!safeEqualHex(sign(secret,timestamp,nonce,body),supplied))
    return res.status(401).json({error:'School cloud request signature is invalid or expired.'});
  req.cloudSyncNonce=nonce;
  return next();
}

let processingCloudOutbox = false;
async function processCloudSyncOutbox(pool) {
  if(!secretReady())return {sent:0,failed:0,review:0,skipped:true};
  if(processingCloudOutbox)return {sent:0,failed:0,review:0,skipped:true};
  processingCloudOutbox=true;
  try {
    // Recovery after a server restart never discards an unacknowledged operation.
    for(const table of ['school_cloud_sync_outbox','school_cloud_sync_operations']){
      await pool.query(`UPDATE ${table} SET status='RETRY',next_attempt_at=NOW(),updated_at=NOW()
        WHERE status='PROCESSING' AND updated_at<NOW()-INTERVAL '15 minutes'`);
    }
    const selected=await pool.query(`
      SELECT q.kind,q."rowId",q."operationId",q."schoolId",
        s.school_code AS "schoolCode",c.cloud_base_url AS "cloudBaseUrl",
        q.payload,q.status,q."nextAttemptAt",q."createdAt"
      FROM (
        SELECT 'QR_SCAN'::text AS kind,outbox_id::text AS "rowId",
          event_id AS "operationId",school_id AS "schoolId",payload,
          status,next_attempt_at AS "nextAttemptAt",created_at AS "createdAt"
        FROM school_cloud_sync_outbox WHERE status IN ('PENDING','RETRY','PROCESSING','REVIEW')
        UNION ALL
        SELECT operation_type AS kind,operation_id::text AS "rowId",
          operation_id AS "operationId",school_id AS "schoolId",payload,
          status,next_attempt_at AS "nextAttemptAt",created_at AS "createdAt"
        FROM school_cloud_sync_operations WHERE status IN ('PENDING','RETRY','PROCESSING','REVIEW')
      ) q
      JOIN school_cloud_sync_settings c ON c.school_id=q."schoolId"
        AND c.enabled=TRUE AND c.cloud_base_url IS NOT NULL
      JOIN schools s ON s.school_id=q."schoolId" AND s.active=TRUE
      ORDER BY q."createdAt" ASC,q.kind ASC,q."rowId" ASC LIMIT 100`);
    let sent=0,failed=0,review=0;
    const blockedSchools=new Set();
    for(const row of selected.rows){
      if(blockedSchools.has(String(row.schoolId)))continue;
      const due=new Date(row.nextAttemptAt).getTime()<=Date.now();
      if(row.status==='REVIEW' || row.status==='PROCESSING' || !due){
        blockedSchools.add(String(row.schoolId));
        continue;
      }
      const legacy=row.kind==='QR_SCAN';
      const table=legacy?'school_cloud_sync_outbox':'school_cloud_sync_operations';
      const column=legacy?'outbox_id':'operation_id';
      const claimed=await pool.query(`
        UPDATE ${table} SET status='PROCESSING',attempts=attempts+1,updated_at=NOW()
        WHERE ${column}=$1 AND status IN ('PENDING','RETRY') RETURNING attempts`,
        [row.rowId]);
      if(!claimed.rowCount){blockedSchools.add(String(row.schoolId));continue;}
      try {
        const body=JSON.stringify(legacy
          ? {schoolCode:row.schoolCode,events:[row.payload]}
          : {schoolCode:row.schoolCode,operation:row.payload});
        const endpoint=legacy?'/api/cloud-sync/receive':'/api/cloud-sync/receive-operations';
        const response=await fetch(row.cloudBaseUrl.replace(/\/+$/,'')+endpoint,{
          method:'POST',headers:{'Content-Type':'application/json',...signedHeaders(body)},
          body,signal:AbortSignal.timeout(15000)
        });
        const data=await response.json().catch(()=>({}));
        const item=data.results?.[0]||{};
        const echoed=legacy?item.eventId:item.operationId;
        if(!response.ok)throw new Error(data.error||'Cloud returned HTTP '+response.status);
        if(String(echoed)!==String(row.operationId))
          throw new Error('Cloud response did not acknowledge the expected operation ID.');
        const accepted=legacy?['ACCEPTED','ALREADY_SYNCED','DUPLICATE'] : ['ACCEPTED','ALREADY_SYNCED'];
        if(accepted.includes(item.status)){
          await pool.query(`UPDATE ${table} SET status='SENT',last_error=NULL,
            sent_at=NOW(),updated_at=NOW() WHERE ${column}=$1`,[row.rowId]);
          await pool.query(`UPDATE school_cloud_sync_settings
            SET last_success_at=NOW(),last_error=NULL,updated_at=NOW() WHERE school_id=$1`,
            [row.schoolId]);
          sent++;
          continue;
        }
        if(['REJECTED','NEEDS_REVIEW'].includes(item.status)){
          const reason=String(item.reason||item.code||'Cloud rejected this record for review.').slice(0,500);
          await pool.query(`UPDATE ${table} SET status='REVIEW',
            last_error=$2,updated_at=NOW() WHERE ${column}=$1`,[row.rowId,reason]);
          await pool.query('UPDATE school_cloud_sync_settings SET last_error=$2 WHERE school_id=$1',
            [row.schoolId,reason]);
          review++;
          blockedSchools.add(String(row.schoolId));
          continue;
        }
        throw new Error('Cloud returned an unexpected synchronization result.');
      }catch(error){
        const attempts=claimed.rows[0].attempts;
        const delaySeconds=Math.min(3600,15*(2**Math.min(attempts-1,8)));
        const reason=String(error.message||'Cloud forwarding failed.').slice(0,500);
        await pool.query(`UPDATE ${table} SET status='RETRY',last_error=$2,updated_at=NOW(),
          next_attempt_at=NOW()+($3::text || ' seconds')::interval WHERE ${column}=$1`,
          [row.rowId,reason,delaySeconds]);
        await pool.query('UPDATE school_cloud_sync_settings SET last_error=$2 WHERE school_id=$1',
          [row.schoolId,reason]);
        failed++;
        blockedSchools.add(String(row.schoolId));
      }
    }
    return {sent,failed,review,skipped:false};
  }finally{processingCloudOutbox=false;}
}

function registerCloudSyncRoutes(app, pool, { authenticateSchoolClient, requireSchoolAdmin }) {
  app.post('/api/cloud-sync/receive-operations',verifySchoolCloudSignature,async(req,res)=>{
    const schoolCode=typeof req.body?.schoolCode==='string'?req.body.schoolCode.trim():'';
    const operation=req.body?.operation;
    if(!schoolCode || !operation || typeof operation!=='object'||Array.isArray(operation))
      return res.status(400).json({error:'Provide an authorized school code and one typed operation.'});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM cloud_sync_nonces WHERE received_at<NOW()-INTERVAL '1 day'");
      await client.query('INSERT INTO cloud_sync_nonces(nonce) VALUES($1)',[req.cloudSyncNonce]);
      const school=await client.query(
        'SELECT school_id FROM schools WHERE lower(school_code)=lower($1) AND active=TRUE',[schoolCode]);
      if(!school.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Cloud school is not registered or active.'});}
      const result=await receiveCloudOperation(client,school.rows[0].school_id,operation);
      await client.query('COMMIT');
      return res.json({results:[result],serverTime:new Date().toISOString()});
    }catch(error) {
      await client.query('ROLLBACK').catch(()=>{});
      if(error instanceof NeedsReview)
        return res.json({results:[{operationId:operation?.operationId||null,
          status:'NEEDS_REVIEW',code:error.code,reason:error.message}]});
      if(error.code==='23505')
        return res.status(409).json({error:'Duplicate request nonce or concurrent operation. Retry with a fresh signed request.'});
      console.error('Cloud typed attendance synchronization failed:',error.message);
      return res.status(500).json({error:'Unable to apply cloud attendance operation.'});
    }finally {client.release();}
  });

  app.post('/api/cloud-sync/health-school',verifySchoolCloudSignature,async(req,res)=>{
    try{
      await pool.query("DELETE FROM cloud_sync_nonces WHERE received_at<NOW()-INTERVAL '1 day'");
      await pool.query('INSERT INTO cloud_sync_nonces(nonce) VALUES($1)',[req.cloudSyncNonce]);
      const school=await pool.query(
        'SELECT 1 FROM schools WHERE lower(school_code)=lower($1) AND active=TRUE',
        [req.body.schoolCode]);
      if(!school.rowCount)return res.status(404).json({error:'Cloud school is not registered.'});
      return res.json({ok:true,service:'attendigo-school-cloud-sync',timestamp:new Date().toISOString()});
    }catch(error){
      return res.status(error.code==='23505'?409:500).json({
        error:error.code==='23505'?'Cloud request nonce was already used.':'Cloud school health check failed.'});
    }
  });

  app.get('/api/cloud-sync/health', verifyCloudSignature, async (req, res) => {
    try {
      await pool.query('DELETE FROM cloud_sync_nonces WHERE received_at<NOW()-INTERVAL \'1 day\'');
      await pool.query('INSERT INTO cloud_sync_nonces(nonce) VALUES($1)', [req.cloudSyncNonce]);
      return res.json({ ok: true, service: 'school-attendance-cloud-sync', timestamp: new Date().toISOString() });
    } catch (err) {
      return res.status(err.code === '23505' ? 409 : 500).json({ error: err.code === '23505' ? 'Cloud sync request was already used.' : 'Cloud sync health check failed.' });
    }
  });

  app.post('/api/cloud-sync/receive', verifySchoolCloudSignature, async (req, res) => {
    const schoolCode = typeof req.body?.schoolCode === 'string' ? req.body.schoolCode.trim() : '';
    const events = req.body?.events;
    if (!schoolCode || !Array.isArray(events) || events.length < 1 || events.length > 100) {
      return res.status(400).json({ error: 'Provide a school code and 1 to 100 attendance events.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM cloud_sync_nonces WHERE received_at<NOW()-INTERVAL \'1 day\'');
      await client.query('INSERT INTO cloud_sync_nonces(nonce) VALUES($1)', [req.cloudSyncNonce]);
      const school = await client.query('SELECT school_id FROM schools WHERE lower(school_code)=lower($1) AND active=TRUE', [schoolCode]);
      if (!school.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'The destination school code is not registered.' }); }
      const schoolId = school.rows[0].school_id;
      const results = [];
      for (const event of events) {
        if (!event || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(event.eventId || '')) ||
            !['SCHOOL','CLASS','ADVISORY'].includes(event.attendanceScope) || !['TIME_IN','TIME_OUT'].includes(event.eventType) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(event.schoolDate || '') || !Number.isFinite(Date.parse(event.occurredAt || '')) ||
            !event.student || typeof event.student.studentId !== 'string' || !event.student.studentId.trim() ||
            typeof event.student.fullName !== 'string' || !event.student.fullName.trim() ||
            typeof event.student.gradeLevel !== 'string' || typeof event.student.section !== 'string' ||
            (event.attendanceScope === 'CLASS' && (!event.period || !event.period.periodName || !event.period.startTime || !event.period.endTime))) {
          results.push({ eventId: event?.eventId || null, status: 'REJECTED', reason: 'Invalid event or learner details.' });
          continue;
        }
        // Historic offline QR snapshots must never roll back the current
        // student's name, grade or section when they arrive late.
        const priorEvent = await client.query(
          'SELECT school_id FROM attendance_events WHERE event_id=$1',[event.eventId]);
        if(priorEvent.rowCount) {
          results.push({eventId:event.eventId,
            status:String(priorEvent.rows[0].school_id)===String(schoolId)?'ALREADY_SYNCED':'REJECTED',
            ...(String(priorEvent.rows[0].school_id)!==String(schoolId)?{reason:'Event ID belongs to another school.'}:{})});
          continue;
        }
        const student = await client.query(
          `WITH inserted AS (
             INSERT INTO students(school_id,student_id,full_name,grade_level,section,parent_mobile,sex)
             VALUES($1,$2,$3,$4,$5,'',NULL)
             ON CONFLICT(student_id) DO NOTHING RETURNING student_id
           )
           SELECT student_id FROM inserted
           UNION ALL
           SELECT student_id FROM students WHERE school_id=$1 AND student_id=$2
           LIMIT 1`,
          [schoolId,event.student.studentId.trim(),event.student.fullName.trim().slice(0,200),event.student.gradeLevel.trim().slice(0,40),event.student.section.trim().slice(0,100)]
        );
        if (!student.rowCount) { results.push({ eventId:event.eventId,status:'REJECTED',reason:'Student ID belongs to a different school.' }); continue; }
        let periodId = null;
        if (event.attendanceScope === 'CLASS') {
          const periodName=String(event.period.periodName).slice(0,100);
          const subjectName=String(event.period.subjectName||'').slice(0,120);
          let period=await client.query(`SELECT period_id FROM class_periods WHERE school_id=$1 AND period_name=$2
            AND grade_level=$3 AND section=$4 AND COALESCE(subject_name,'')=$5 AND active=TRUE
            AND start_time=$6::time AND end_time=$7::time LIMIT 1`,
            [schoolId,periodName,event.student.gradeLevel.slice(0,40),event.student.section.slice(0,100),subjectName,event.period.startTime,event.period.endTime]);
          if(!period.rowCount){
            results.push({eventId:event.eventId,status:'REJECTED',
              reason:'Cloud class period is not provisioned or the schedule changed; map the class before retrying.'});
            continue;
          }
          periodId = period.rows[0].period_id;
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))',
            [schoolId,String(periodId)+'|'+event.schoolDate]);
          const locked=await client.query(
            'SELECT 1 FROM class_attendance_finalizations WHERE school_id=$1 AND period_id=$2 AND school_date=$3 AND finalized=TRUE',
            [schoolId,periodId,event.schoolDate]);
          if(locked.rowCount){
            results.push({eventId:event.eventId,status:'REJECTED',
              reason:'Cloud class register is finalized; late QR scan needs review.'});
            continue;
          }
        }
        const existing = await client.query('SELECT school_id FROM attendance_events WHERE event_id=$1', [event.eventId]);
        if (existing.rowCount) {
          results.push({eventId:event.eventId,status:String(existing.rows[0].school_id)===String(schoolId)?'ALREADY_SYNCED':'REJECTED',
            ...(String(existing.rows[0].school_id)!==String(schoolId)?{reason:'Event ID belongs to another school.'}:{})});
          continue;
        }
        const deviceId = `CLOUD-${schoolCode.slice(0,70)}`;
        const inserted = await client.query(
          `INSERT INTO attendance_events(event_id,school_id,device_id,student_id,attendance_scope,period_id,event_type,
             occurred_at_device,school_date,late,metadata)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11::jsonb)
           ON CONFLICT DO NOTHING RETURNING event_id`,
          [event.eventId,schoolId,deviceId,event.student.studentId,event.attendanceScope,periodId,event.eventType,event.occurredAt,event.schoolDate,
            Boolean(event.late),JSON.stringify({ ...(event.metadata&&typeof event.metadata==='object'?event.metadata:{}), cloudSynced:true, sourceSchoolCode:schoolCode })]
        );
        results.push({ eventId:event.eventId,status:inserted.rowCount?'ACCEPTED':'DUPLICATE' });
      }
      await client.query('COMMIT');
      return res.json({ results, serverTime:new Date().toISOString() });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Cloud attendance receive failed:', err.message);
      return res.status(err.code === '23505' ? 409 : 500).json({ error: err.code === '23505' ? 'This cloud sync request was already processed.' : 'Could not receive cloud attendance.' });
    } finally { client.release(); }
  });

  app.get('/api/cloud-sync/status', authenticateSchoolClient, async (req, res) => {
    if (req.auth?.type !== 'SCHOOL_USER' || !['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER'].includes(req.auth.role)) return res.status(403).json({ error: 'School staff access is required.' });
    try {
      const result = await pool.query(
        `SELECT c.cloud_base_url AS "cloudBaseUrl",c.enabled,c.last_success_at AS "lastSuccessAt",c.last_error AS "lastError",
           ((SELECT COUNT(*)::int FROM school_cloud_sync_outbox o WHERE o.school_id=c.school_id AND o.status IN ('PENDING','RETRY','PROCESSING'))
            + (SELECT COUNT(*)::int FROM school_cloud_sync_operations o WHERE o.school_id=c.school_id AND o.status IN ('PENDING','RETRY','PROCESSING'))) AS "pendingCount",
           ((SELECT COUNT(*)::int FROM school_cloud_sync_outbox o WHERE o.school_id=c.school_id AND o.status='REVIEW')
            + (SELECT COUNT(*)::int FROM school_cloud_sync_operations o WHERE o.school_id=c.school_id AND o.status='REVIEW')) AS "needsReviewCount"
         FROM school_cloud_sync_settings c WHERE c.school_id=$1`, [req.auth.schoolId]
      );
      const row = result.rows[0] || {};
      const configured = Boolean(row.cloudBaseUrl) && secretReady();
      const recent = row.lastSuccessAt && Date.now() - new Date(row.lastSuccessAt).getTime() < 5 * 60 * 1000;
      return res.json({ configured, enabled:Boolean(row.enabled), connectionStatus:recent?'CONNECTED':row.enabled?'WAITING':'NOT_CONNECTED',
        pendingCount:row.pendingCount||0,needsReviewCount:row.needsReviewCount||0,
        lastSuccessAt:row.lastSuccessAt||null,lastError:row.lastError||null,
        message:!secretReady()?'Set CLOUD_SYNC_SHARED_SECRET on both servers (at least 32 characters) to enable secure forwarding.':
          !row.cloudBaseUrl?'Cloud destination is not configured.':row.enabled?'Attendance sync is enabled; pending records retry automatically.':'Cloud destination is saved. Enable forwarding to start automatic sync.' });
    } catch (err) {
      console.error('Cloud sync status failed:', err.message);
      return res.status(500).json({ error: 'Could not check cloud sync status.' });
    }
  });

  app.get('/api/cloud-sync/review',authenticateSchoolClient,requireSchoolAdmin,async(req,res)=>{
    try{
      const result=await pool.query(`
        SELECT 'QR_SCAN' AS type,event_id::text AS "operationId",created_at AS "createdAt",
          last_error AS reason FROM school_cloud_sync_outbox
          WHERE school_id=$1 AND status='REVIEW'
        UNION ALL
        SELECT operation_type AS type,operation_id::text AS "operationId",
          created_at AS "createdAt",last_error AS reason FROM school_cloud_sync_operations
          WHERE school_id=$1 AND status='REVIEW'
        ORDER BY "createdAt" ASC LIMIT 100`,[req.auth.schoolId]);
      return res.json({records:result.rows});
    }catch(error){console.error('Cloud review list:',error.message);
      return res.status(500).json({error:'Cannot load cloud synchronization review records.'});}
  });
  app.post('/api/cloud-sync/retry',authenticateSchoolClient,requireSchoolAdmin,async(req,res)=>{
    const {type,operationId}=req.body||{};
    if(!['QR_SCAN','MANUAL_MARKS','REGISTER_SIGNOFF'].includes(type)||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(operationId||'')))
      return res.status(400).json({error:'Choose a valid cloud review record.'});
    const table=type==='QR_SCAN'?'school_cloud_sync_outbox':'school_cloud_sync_operations';
    const id=type==='QR_SCAN'?'event_id':'operation_id';
    try{
      const changed=await pool.query(`UPDATE ${table} SET status='PENDING',
        next_attempt_at=NOW(),updated_at=NOW(),last_error=NULL
        WHERE school_id=$1 AND ${id}=$2 AND status='REVIEW'
        ${type==='QR_SCAN'?'':"AND operation_type=$3"} RETURNING 1`,
        type==='QR_SCAN'?[req.auth.schoolId,operationId]:[req.auth.schoolId,operationId,type]);
      if(!changed.rowCount)return res.status(404).json({error:'Review record not found or already retried.'});
      await pool.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,
        entity_type,entity_id,details) VALUES($1,'SCHOOL',$2,'RETRY_CLOUD_SYNC_OPERATION',
          'cloud_sync_operation',$3,$4::jsonb)`,
        [req.auth.schoolId,req.auth.userId,operationId,JSON.stringify({type})]);
      return res.json({queued:true,operationId});
    }catch(error){console.error('Cloud retry failed:',error.message);
      return res.status(500).json({error:'Cannot requeue the reviewed cloud attendance operation.'});}
  });

  app.get('/api/cloud-sync/settings', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    try {
      const result = await pool.query('SELECT cloud_base_url AS "cloudBaseUrl",enabled,updated_at AS "updatedAt" FROM school_cloud_sync_settings WHERE school_id=$1',[req.auth.schoolId]);
      const row=result.rows[0]||{};
      return res.json({cloudBaseUrl:row.cloudBaseUrl||'',enabled:Boolean(row.enabled),configured:Boolean(row.cloudBaseUrl)&&secretReady(),secretConfigured:secretReady(),updatedAt:row.updatedAt||null});
    } catch(err) { console.error('Cloud sync settings load failed:',err.message); return res.status(500).json({error:'Could not load cloud sync settings.'}); }
  });

  app.put('/api/cloud-sync/settings', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    const rawUrl=typeof req.body?.cloudBaseUrl==='string'?req.body.cloudBaseUrl.trim():'';
    const enabled=req.body?.enabled===true;
    let normalizedUrl=null;
    if(rawUrl){
      if(rawUrl.length>500)return res.status(400).json({error:'Cloud address must be 500 characters or fewer.'});
      let parsed;try{parsed=new URL(rawUrl);}catch{return res.status(400).json({error:'Enter a valid cloud server address.'});}
      const localHost=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
      if(!(parsed.protocol==='https:'||(parsed.protocol==='http:'&&localHost))||parsed.username||parsed.password||parsed.search||parsed.hash)return res.status(400).json({error:'Use HTTPS for remote servers. Credentials, query strings, and fragments are not allowed.'});
      normalizedUrl=parsed.toString().replace(/\/+$/,'');
    }
    if(enabled&&(!normalizedUrl||!secretReady()))return res.status(400).json({error:'Set the cloud address and configure CLOUD_SYNC_SHARED_SECRET on both servers before enabling forwarding.'});
    try{
      await pool.query(`INSERT INTO school_cloud_sync_settings(school_id,cloud_base_url,enabled,updated_by_user_id,updated_at)
        VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(school_id) DO UPDATE SET cloud_base_url=EXCLUDED.cloud_base_url,
        enabled=EXCLUDED.enabled,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW()`,[req.auth.schoolId,normalizedUrl,enabled,req.auth.userId]);
      await pool.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
        VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UPDATE_CLOUD_SYNC_SETTINGS','cloud_sync_settings',$1::text,$3::jsonb)`,
        [req.auth.schoolId,req.auth.userId,JSON.stringify({cloudBaseUrl:normalizedUrl,enabled})]);
      return res.json({ok:true,cloudBaseUrl:normalizedUrl||'',enabled,configured:Boolean(normalizedUrl)&&secretReady(),message:enabled?'Cloud attendance forwarding is enabled. New accepted attendance events will sync automatically.':'Cloud destination saved; forwarding is paused.'});
    }catch(err){console.error('Cloud sync settings save failed:',err.message);return res.status(500).json({error:'Could not save cloud sync settings.'});}
  });

  app.post('/api/cloud-sync/test', authenticateSchoolClient, requireSchoolAdmin, async (req,res)=>{
    const config=await pool.query('SELECT cloud_base_url AS url FROM school_cloud_sync_settings WHERE school_id=$1 AND enabled=TRUE',[req.auth.schoolId]);
    if(!config.rowCount||!secretReady())return res.status(400).json({error:'Configure a destination, shared secret, and enable cloud forwarding first.'});
    try{
      const code=await pool.query('SELECT school_code FROM schools WHERE school_id=$1',[req.auth.schoolId]);
      if(!code.rowCount)return res.status(404).json({error:'School is unavailable.'});
      const payload=JSON.stringify({schoolCode:code.rows[0].school_code});
      const response=await fetch(`${config.rows[0].url.replace(/\/+$/,'')}/api/cloud-sync/health-school`,{
        method:'POST',headers:{'Content-Type':'application/json',...signedHeaders(payload)},
        body:payload,signal:AbortSignal.timeout(10000)
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok||!body.ok)return res.status(502).json({error:body.error||`Cloud server returned ${response.status}.`});
      await pool.query('UPDATE school_cloud_sync_settings SET last_success_at=NOW(),last_error=NULL WHERE school_id=$1',[req.auth.schoolId]);
      return res.json({ok:true,message:'School-scoped cloud signature verified and destination reachable.'});
    }catch(err){return res.status(502).json({error:err.message||'Could not reach the cloud server.'});}
  });

  app.post('/api/cloud-sync/run', authenticateSchoolClient, requireSchoolAdmin, async (_req,res)=>{
    try{return res.json(await processCloudSyncOutbox(pool));}
    catch(err){console.error('Cloud sync run failed:',err.message);return res.status(500).json({error:'Could not run cloud sync.'});}
  });
}

module.exports = registerCloudSyncRoutes;
module.exports.processCloudSyncOutbox = processCloudSyncOutbox;
