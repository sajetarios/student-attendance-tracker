'use strict';
// Called inside the existing special-program module to reuse its school-scoped permissions and audited assignment logic.
function registerSpecialProgramBatchRoutes(app,pool,auth,h){
  const {authenticateSchoolClient,requireSchoolRoles}=auth;
  const staff=requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER');
  const admin=requireSchoolRoles('SCHOOL_ADMIN');
  const requester=u=>u.role==='DEPARTMENT_HEAD'||(u.role==='TEACHER'&&u.teacherDesignations?.includes('CLASS_ADVISER'));
  const {getEnrollment,permitted,change,validId,clean,invalid,errorReply}=h;
  function params(body,needReason){
    const ids=body?.enrollmentIds,action=String(body?.action||'').toUpperCase();
    const programTypeId=body?.programTypeId||null,reason=clean(body?.reason);
    if(!Array.isArray(ids)||ids.length<1||ids.length>200||ids.some(id=>!validId(id))||
      new Set(ids).size!==ids.length||!['ASSIGN','REMOVE'].includes(action)||
      (action==='ASSIGN'&&!validId(programTypeId))||(needReason&&(reason.length<3||reason.length>1000)))
      return {error:'Select 1–200 unique enrolled learners, an action and a reason of 3–1000 characters.'};
    return {ids:ids.slice().sort(),action,programTypeId:action==='ASSIGN'?programTypeId:null,reason};
  }
  async function programValid(db,school,pid,action){
    if(action==='REMOVE')return true;
    return (await db.query('SELECT 1 FROM special_program_types WHERE school_id=$1 AND program_type_id=$2 AND active=TRUE',[school,pid])).rowCount>0;
  }
  async function evaluate(db,u,enrollmentId,action,programTypeId){
    const generic={enrollmentId,eligible:false,code:'NO_ACTIVE_ENROLLMENT',reason:'No active school-year enrollment is available.'};
    const e=await getEnrollment(db,u.schoolId,enrollmentId);
    if(!e||e.year_status!=='ACTIVE'||e.enrollment_status!=='ENROLLED')return generic;
    if(!(await permitted(db,u,e)))return {...generic,code:'OUT_OF_SCOPE',reason:'Learner is outside your authorized section or department.'};
    const row={enrollmentId,studentId:e.student_id,gradeLevel:e.grade_level,section:e.section};
    const pending=await db.query("SELECT 1 FROM special_program_change_requests WHERE school_id=$1 AND student_id=$2 AND school_year_id=$3 AND status='PENDING' LIMIT 1",[u.schoolId,e.student_id,e.school_year_id]);
    if(pending.rowCount)return {...row,eligible:false,code:'PENDING',reason:'A program request is already pending.'};
    const existing=await db.query("SELECT program_type_id FROM student_special_programs WHERE school_id=$1 AND enrollment_id=$2 AND status='ACTIVE' AND is_primary=TRUE LIMIT 1",[u.schoolId,enrollmentId]);
    const currentProgramTypeId=existing.rows[0]?.program_type_id||null;
    if(action==='REMOVE'&&!currentProgramTypeId)return {...row,eligible:false,code:'NOT_ASSIGNED',reason:'No active primary program to remove.'};
    if(action==='ASSIGN'&&String(currentProgramTypeId||'')===String(programTypeId))
      return {...row,eligible:false,code:'UNCHANGED',reason:'Already assigned to this program.'};
    return {...row,eligible:true,code:'ELIGIBLE',reason:'Ready for review.',currentProgramTypeId};
  }
  app.post('/api/special-programs/requests/bulk/preview',authenticateSchoolClient,staff,async(req,res)=>{
    if(!requester(req.auth))return res.status(403).json({error:'Only Department Heads and Class Advisers can request program changes.'});
    const p=params(req.body,false);
    if(p.error)return res.status(400).json({error:p.error});
    try{
      if(!(await programValid(pool,req.auth.schoolId,p.programTypeId,p.action)))
        return res.status(400).json({error:'Choose a valid active school program.'});
      const items=[];
      for(const id of p.ids)items.push(await evaluate(pool,req.auth,id,p.action,p.programTypeId));
      return res.json({items,selected:items.length,eligible:items.filter(i=>i.eligible).length,
        skipped:items.filter(i=>!i.eligible).length});
    }catch(e){console.error('Special-program bulk preview:',e.message);return res.status(500).json({error:'Could not preview the selected learners.'});}
  });
  app.post('/api/special-programs/requests/bulk',authenticateSchoolClient,staff,async(req,res)=>{
    if(!requester(req.auth))return res.status(403).json({error:'Only Department Heads and Class Advisers can submit requests.'});
    const p=params(req.body,true);
    if(p.error)return res.status(400).json({error:p.error});
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      if(!(await programValid(db,req.auth.schoolId,p.programTypeId,p.action))){
        await db.query('ROLLBACK');return res.status(400).json({error:'Selected program is not active in your school.'});
      }
      const items=[];
      for(const id of p.ids)items.push(await evaluate(db,req.auth,id,p.action,p.programTypeId));
      const eligible=items.filter(i=>i.eligible),skipped=items.filter(i=>!i.eligible);
      if(!eligible.length){
        await db.query('ROLLBACK');
        return res.status(409).json({error:'No eligible students remain. Review the preview.',items});
      }
      const b=await db.query('INSERT INTO special_program_request_batches(school_id,requested_by_user_id,action,requested_program_type_id,reason,selected_count,submitted_count) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING batch_id',
        [req.auth.schoolId,req.auth.userId,p.action,p.programTypeId,p.reason,p.ids.length,eligible.length]);
      const batchId=b.rows[0].batch_id,created=[];
      for(const i of eligible){
        const e=await getEnrollment(db,req.auth.schoolId,i.enrollmentId);
        if(!e||e.year_status!=='ACTIVE'||e.enrollment_status!=='ENROLLED'||!(await permitted(db,req.auth,e)))
          throw invalid('Eligibility changed. Preview again.','INVALID_YEAR');
        const result=await db.query(
          'INSERT INTO special_program_change_requests(school_id,student_id,school_year_id,enrollment_id,requested_program_type_id,action,reason,requested_by_user_id,batch_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING request_id',
          [req.auth.schoolId,e.student_id,e.school_year_id,e.enrollment_id,p.programTypeId,p.action,p.reason,req.auth.userId,batchId]);
        if(!result.rowCount)throw invalid('A request was submitted for one learner meanwhile. Preview again.','UNCHANGED');
        created.push({requestId:result.rows[0].request_id,enrollmentId:i.enrollmentId,studentId:e.student_id});
      }
      await db.query("INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) VALUES($1,'SCHOOL',$2,'SPECIAL_PROGRAM_BATCH_REQUEST_SUBMITTED','special_program_request_batch',$3,$4::jsonb)",
        [req.auth.schoolId,req.auth.userId,batchId,JSON.stringify({selected:p.ids.length,submitted:created.length,skipped:skipped.map(i=>({enrollmentId:i.enrollmentId,code:i.code})),action:p.action,programTypeId:p.programTypeId})]);
      await db.query('COMMIT');
      return res.status(201).json({batchId,submitted:created.length,selected:p.ids.length,created,skipped});
    }catch(e){await db.query('ROLLBACK');console.error('Special-program batch submit:',e.message);return errorReply(res,e);}
    finally{db.release();}
  });
  app.post('/api/special-programs/batches/:id/review',authenticateSchoolClient,admin,async(req,res)=>{
    const batchId=req.params.id,decision=String(req.body?.decision||'').toUpperCase();
    const ids=req.body?.requestIds,note=clean(req.body?.reviewNote);
    if(!validId(batchId)||!['APPROVE','REJECT'].includes(decision)||!Array.isArray(ids)||
      !ids.length||ids.length>200||ids.some(id=>!validId(id))||new Set(ids).size!==ids.length||
      note.length>1000)return res.status(400).json({error:'Choose 1–200 unique pending requests and a valid decision.'});
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      const found=await db.query('SELECT 1 FROM special_program_request_batches WHERE school_id=$1 AND batch_id=$2',[req.auth.schoolId,batchId]);
      if(!found.rowCount){await db.query('ROLLBACK');return res.status(404).json({error:'Batch not found in this school.'});}
      const ordered=ids.slice().sort();
      const result=await db.query("SELECT * FROM special_program_change_requests WHERE school_id=$1 AND batch_id=$2 AND request_id=ANY($3::uuid[]) AND status='PENDING' ORDER BY request_id FOR UPDATE",
        [req.auth.schoolId,batchId,ordered]);
      if(result.rowCount!==ordered.length){await db.query('ROLLBACK');return res.status(409).json({error:'Some selected requests were already reviewed or belong to another batch. Refresh.'});}
      const status=decision==='APPROVE'?'APPROVED':'REJECTED';
      const alreadySatisfiedIds=[];
      for(const item of result.rows){
        if(decision==='APPROVE'){
          const e=await getEnrollment(db,req.auth.schoolId,item.enrollment_id);
          if(!e)throw invalid('Enrollment no longer exists. Reject this request instead.','INVALID_YEAR');
          const outcome=await change(db,req.auth,e,item.action,item.requested_program_type_id,{allowAlreadySatisfied:true});
          if(!outcome.applied)alreadySatisfiedIds.push(item.request_id);
        }
        const updated=await db.query("UPDATE special_program_change_requests SET status=$3,reviewed_by_user_id=$4,reviewed_at=NOW(),review_note=$5 WHERE school_id=$1 AND request_id=$2 AND status='PENDING' RETURNING request_id",
          [req.auth.schoolId,item.request_id,status,req.auth.userId,note||null]);
        if(!updated.rowCount)throw invalid('The request changed during review. Refresh.','UNCHANGED');
        await db.query("INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) VALUES($1,'SCHOOL',$2,$3,'special_program_change_request',$4,$5::jsonb)",
          [req.auth.schoolId,req.auth.userId,'SPECIAL_PROGRAM_REQUEST_'+status,item.request_id,
            JSON.stringify({batchId,studentId:item.student_id,action:item.action,alreadySatisfied:alreadySatisfiedIds.includes(item.request_id)})]);
      }
      await db.query("INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) VALUES($1,'SCHOOL',$2,$3,'special_program_request_batch',$4,$5::jsonb)",
        [req.auth.schoolId,req.auth.userId,'SPECIAL_PROGRAM_BATCH_'+status,batchId,JSON.stringify({requestIds:ordered,reviewed:ordered.length,reviewNote:note,alreadySatisfiedIds})]);
      await db.query('COMMIT');
      return res.json({batchId,status,reviewed:ordered.length,requestIds:ordered,alreadySatisfied:alreadySatisfiedIds.length,applied:decision==='APPROVE'?ordered.length-alreadySatisfiedIds.length:0});
    }catch(e){await db.query('ROLLBACK');console.error('Special-program batch review:',e.message);return errorReply(res,e);}
    finally{db.release();}
  });
}
module.exports={registerSpecialProgramBatchRoutes};
