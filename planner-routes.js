'use strict';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES=new Set(['TASK','LESSON','MEETING','DEADLINE','REMINDER','ACTIVITY']);
const PRIORITIES=new Set(['LOW','NORMAL','HIGH']);
const STATUSES=new Set(['PLANNED','DONE','CANCELLED']);
function registerPlannerRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}) {
 const auth=[authenticateSchoolClient,requireSchoolRoles('TEACHER','DEPARTMENT_HEAD')];
 async function actor(req){
   const a=await pool.query(`SELECT su.user_id AS "userId",su.department_id AS "departmentId",su.role,
       d.department_name AS "departmentName",
       (d.active=TRUE AND d.department_code<>'UNASSIGNED') AS "canShare"
       FROM school_users su LEFT JOIN school_departments d ON d.school_id=su.school_id AND d.department_id=su.department_id
       WHERE su.school_id=$1 AND su.user_id=$2 AND su.active=TRUE AND su.role IN ('TEACHER','DEPARTMENT_HEAD')`,
       [req.auth.schoolId,req.auth.userId]);
   return a.rows[0]||null;
 }
 const vis=(a)=>`(p.owner_user_id=$2 OR (p.visibility='DEPARTMENT' AND p.department_id=$3))`;
 function normalize(data,a) {
   const title=typeof data.title==='string'?data.title.trim():'';
   const details=typeof data.details==='string'?data.details.trim():'';
   const start=new Date(data.startAt),end=new Date(data.endAt);
   const visibility=data.visibility==='DEPARTMENT'?'DEPARTMENT':'PERSONAL';
   const type=String(data.itemType||'TASK').toUpperCase(),priority=String(data.priority||'NORMAL').toUpperCase();
   const status=String(data.status||'PLANNED').toUpperCase();
   if(title.length<1||title.length>160||details.length>3000||!TYPES.has(type)||!PRIORITIES.has(priority)||!STATUSES.has(status)
      ||!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start
      ||end-start>14*86400000||!['PERSONAL','DEPARTMENT'].includes(visibility))
       return {error:'Check title, event type, priority, and start/end dates (maximum 14 days).'};
   if(visibility==='DEPARTMENT'&&!a.canShare)
       return {error:'To share planner items, ask your School Admin to assign you to an active department.'};
   return {title,details,startAt:start.toISOString(),endAt:end.toISOString(),
      visibility,itemType:type,priority,status,allDay:data.allDay===true,
      departmentId:visibility==='DEPARTMENT'?a.departmentId:null};
 }
 const projection=`p.item_id AS "itemId",p.owner_user_id AS "ownerUserId",p.visibility,
     p.item_type AS "itemType",p.title,p.details,
     p.start_at AS "startAt",p.end_at AS "endAt",
     p.all_day AS "allDay",p.priority,p.status,p.updated_at AS "updatedAt",
     u.display_name AS "ownerName"`;
 app.get('/api/planner/items',...auth,async(req,res)=>{
   try{
     const a=await actor(req);if(!a)return res.status(403).json({error:'Planner is limited to active teachers and Department Heads.'});
     const from=new Date(String(req.query.from||'')),to=new Date(String(req.query.to||''));
     if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||to<=from||to-from>95*86400000)
       return res.status(400).json({error:'Select a valid date range of up to 95 days.'});
     const result=await pool.query(`SELECT ${projection} FROM planner_items p
        JOIN school_users u ON u.school_id=p.school_id AND u.user_id=p.owner_user_id
        WHERE p.school_id=$1 AND ${vis(a)}
        AND p.start_at<$5 AND p.end_at>$4
        ORDER BY p.start_at,p.item_id LIMIT 1000`,
       [req.auth.schoolId,req.auth.userId,a.departmentId,from.toISOString(),to.toISOString()]);
     return res.json({items:result.rows,canShare:Boolean(a.canShare),departmentName:a.departmentName||null});
   }catch(error){console.error('Planner load failed:',error.message);return res.status(500).json({error:'Could not load Planner.'})}
 });
 app.post('/api/planner/items',...auth,async(req,res)=>{
   try{
     const a=await actor(req);if(!a)return res.status(403).json({error:'Planner access denied.'});
     const item=normalize(req.body||{},a);if(item.error)return res.status(400).json({error:item.error});
     const r=await pool.query(`INSERT INTO planner_items
       (school_id,owner_user_id,department_id,visibility,item_type,title,details,start_at,end_at,all_day,priority,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING item_id AS "itemId"`,
       [req.auth.schoolId,req.auth.userId,item.departmentId,item.visibility,item.itemType,item.title,item.details,item.startAt,item.endAt,item.allDay,item.priority,item.status]);
     return res.status(201).json({itemId:r.rows[0].itemId});
   }catch(error){console.error('Planner create failed:',error.message);return res.status(500).json({error:'Could not save Planner item.'})}
 });
 app.patch('/api/planner/items/:id',...auth,async(req,res)=>{
   if(!uuid.test(String(req.params.id||'')))return res.status(400).json({error:'Invalid item.'});
   try{
     const a=await actor(req);if(!a)return res.status(403).json({error:'Planner access denied.'});
     const item=normalize(req.body||{},a);if(item.error)return res.status(400).json({error:item.error});
     const r=await pool.query(`UPDATE planner_items SET department_id=$4,visibility=$5,item_type=$6,title=$7,
        details=$8,start_at=$9,end_at=$10,all_day=$11,priority=$12,status=$13,updated_at=NOW()
        WHERE school_id=$1 AND owner_user_id=$2 AND item_id=$3
        RETURNING item_id AS "itemId"`,
       [req.auth.schoolId,req.auth.userId,req.params.id,item.departmentId,item.visibility,item.itemType,item.title,item.details,item.startAt,item.endAt,item.allDay,item.priority,item.status]);
     if(!r.rowCount)return res.status(404).json({error:'Planner item not found or not owned by you.'});
     return res.json({itemId:r.rows[0].itemId});
   }catch(error){console.error('Planner update failed:',error.message);return res.status(500).json({error:'Could not update Planner item.'})}
 });
 app.delete('/api/planner/items/:id',...auth,async(req,res)=>{
   if(!uuid.test(String(req.params.id||'')))return res.status(400).json({error:'Invalid item.'});
   try{
     const r=await pool.query('DELETE FROM planner_items WHERE school_id=$1 AND owner_user_id=$2 AND item_id=$3 RETURNING item_id',
         [req.auth.schoolId,req.auth.userId,req.params.id]);
     if(!r.rowCount)return res.status(404).json({error:'Item not found or not owned by you.'});
     return res.json({deleted:true});
   }catch(error){console.error('Planner delete failed:',error.message);return res.status(500).json({error:'Could not delete Planner item.'})}
 });
}
module.exports={registerPlannerRoutes};
