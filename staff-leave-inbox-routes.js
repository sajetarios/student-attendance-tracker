'use strict';
const {FILTERS,canUseInbox,scopeFor,actionExpression,publicInboxRecord}=require('./staff-leave-inbox');
function registerStaffLeaveInboxRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const auth=[authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD')];
 app.get('/api/staff-leave/inbox',...auth,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  if(!canUseInbox(req.auth.role))
   return res.status(403).json({error:'Only authorized leave reviewers can access this inbox.'});
  const filter=String(req.query?.filter||'ACTION').toUpperCase();
  const q=String(req.query?.q||'').trim().slice(0,100);
  const countsOnly=String(req.query?.countsOnly||'')==='1';
  const limit=Math.min(50,Math.max(1,Number.parseInt(req.query?.limit,10)||25));
  const offset=Math.min(10000,Math.max(0,Number.parseInt(req.query?.offset,10)||0));
  if(!FILTERS.includes(filter))return res.status(400).json({error:'Invalid leave inbox filter.'});
  try{
   const scope=scopeFor(req.auth);
   const joins=' FROM staff_leave_requests r JOIN school_users u ON u.school_id=r.school_id AND u.user_id=r.staff_user_id ';
   const [statusRows,actionCount]=await Promise.all([
    pool.query('SELECT r.status,COUNT(*)::int AS count'+joins+
      'WHERE '+scope.where+' GROUP BY r.status',scope.args),
    (async()=>{
     const args=[...scope.args];
     const actionWhere=actionExpression(req.auth,args);
     return pool.query('SELECT COUNT(*)::int AS count'+joins+
       'WHERE '+scope.where+' AND ('+actionWhere+')',args);
    })()
   ]);
   const counts={total:0,action:actionCount.rows[0]?.count||0,
    pending:0,recommendation:0,schoolReview:0,external:0,
    approved:0,disapproved:0,declined:0,cancelled:0};
   const field={PENDING_HEAD:'recommendation',PENDING_ADMIN:'schoolReview',
    PENDING_EXTERNAL:'external',APPROVED:'approved',REJECTED:'disapproved',DECLINED_HEAD:'declined',
    CANCELLED:'cancelled'};
   statusRows.rows.forEach(x=>{
    const count=Number(x.count)||0;
    counts.total+=count;
    if(field[x.status])counts[field[x.status]]+=count;
    if(x.status.startsWith('PENDING_'))counts.pending+=count;
   });
   if(countsOnly)return res.json({counts});
   const args=[...scope.args];
   let where=scope.where;
   if(filter==='ACTION')where+=' AND ('+actionExpression(req.auth,args)+')';
   else if(filter==='PENDING')where+=" AND r.status IN ('PENDING_HEAD','PENDING_ADMIN','PENDING_EXTERNAL')";
   else {
    const mapped={RECOMMENDATION:'PENDING_HEAD',SCHOOL_REVIEW:'PENDING_ADMIN',
     EXTERNAL:'PENDING_EXTERNAL',APPROVED:'APPROVED',DISAPPROVED:'REJECTED',DECLINED:'DECLINED_HEAD',CANCELLED:'CANCELLED'};
    if(mapped[filter]){args.push(mapped[filter]);where+=' AND r.status=$'+args.length;}
   }
   if(q){
    // No dynamic SQL from user input; escape LIKE metacharacters explicitly.
    args.push('%'+q.replace(/[%_\\]/g,'\\$&')+'%');
    const p='$'+args.length;
    where+=' AND (u.display_name ILIKE '+p+" ESCAPE '\\' OR r.request_id::text ILIKE "+p+" ESCAPE '\\')";
   }
   args.push(limit+1,offset);
   const rows=await pool.query(
    'SELECT r.*,u.role AS requester_role,u.display_name AS staff_name,'+
    'd.department_name FROM staff_leave_requests r '+
    'JOIN school_users u ON u.school_id=r.school_id AND u.user_id=r.staff_user_id '+
    'LEFT JOIN school_departments d ON d.school_id=r.school_id AND d.department_id=r.department_id '+
    'WHERE '+where+' ORDER BY r.submitted_at DESC,r.request_id DESC LIMIT $'+(args.length-1)+
    ' OFFSET $'+args.length,args);
   res.json({counts,filter,requests:rows.rows.slice(0,limit).map(r=>publicInboxRecord(r,req.auth)),
    nextOffset:rows.rows.length>limit?offset+limit:null});
  }catch(e){
   console.error('Leave inbox:',e.message);
   return res.status(503).json({error:'Leave approval inbox unavailable. No records were changed.'});
  }
 });
}
module.exports={registerStaffLeaveInboxRoutes};
