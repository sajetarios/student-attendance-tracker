'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES=['JHS_ONLY','SHS_ONLY','INTEGRATED'];
const ALL_GRADES=['Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
const TRACKS=['ACADEMIC','TECHPRO','TVL','SPORTS','ARTS_AND_DESIGN'];
function gradesForMode(mode){
 if(mode==='SHS_ONLY')return ALL_GRADES.slice(4);
 if(mode==='INTEGRATED')return [...ALL_GRADES];
 return ALL_GRADES.slice(0,4);
}
function defaultCurriculum(gradeLevel,schoolYearLabel){
 const year=Number(String(schoolYearLabel||'').slice(0,4));
 // Grade 11 mandatory strengthened starting SY 2026–27.
 // Grade 12 must be explicitly set to strengthened for a confirmed pilot.
 return gradeLevel==='Grade 11'&&year>=2026?'STRENGTHENED':'LEGACY';
}
function registerShsRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const readers=requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER');
 const admin=requireSchoolRoles('SCHOOL_ADMIN');
 const setPrivate=res=>res.set('Cache-Control','no-store, private');
 async function readMode(db,schoolId){
  const r=await db.query('SELECT level_mode FROM school_academic_levels WHERE school_id=$1',[schoolId]);
  return r.rows[0]?.level_mode||'JHS_ONLY';
 }
 async function readYear(db,schoolId,yearId){
  const r=await db.query('SELECT school_year_id,school_year_label,start_date,status FROM school_years WHERE school_id=$1 AND school_year_id=$2',[schoolId,yearId]);
  return r.rows[0]||null;
 }
 function fail(err,res,name){
  console.error(name,err.code||err.message);
  if(err.code==='23514')return res.status(409).json({error:'That grade level is disabled for this school. Ask the School Admin to enable it before creating the record.'});
  return res.status(503).json({error:'Academic configuration could not be saved or loaded. Existing records were not changed.'});
 }
 app.get('/api/shs/config',authenticateSchoolClient,readers,async(req,res)=>{
  setPrivate(res);
  try{
   const schoolId=req.auth.schoolId;
   const mode=await readMode(pool,schoolId);
   const years=await pool.query(
    'SELECT school_year_id AS "schoolYearId",school_year_label AS label,status FROM school_years WHERE school_id=$1 ORDER BY start_date DESC LIMIT 20',
    [schoolId]);
   const curricula=await pool.query(
    'SELECT school_year_id AS "schoolYearId",grade_level AS "gradeLevel",curriculum_version AS version,grade12_pilot_confirmed AS "pilotConfirmed" FROM shs_year_curricula WHERE school_id=$1',
    [schoolId]);
   return res.json({mode,allowedGrades:gradesForMode(mode),schoolYears:years.rows,
    curricula:curricula.rows,defaults:{grade11:'STRENGTHENED',grade12:'LEGACY'},
    note:'Curriculum settings describe instructional offerings. They do not change existing attendance, grading, or SF2 rules.'});
  }catch(err){return fail(err,res,'SHS config load');}
 });
 app.put('/api/shs/config',authenticateSchoolClient,admin,async(req,res)=>{
  setPrivate(res);
  const mode=req.body?.mode;
  if(!MODES.includes(mode))return res.status(400).json({error:'Choose JHS only, SHS only, or integrated JHS and SHS.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text),16031)',[req.auth.schoolId]);
   // No deletion or hiding of currently existing SHS/JHS learner and schedule records.
   const disabledGrades=ALL_GRADES.filter(g=>!gradesForMode(mode).includes(g));
   if(disabledGrades.length){
    const r=await client.query(
     'SELECT ('+
     ' (SELECT COUNT(*) FROM students WHERE school_id=$1 AND grade_level=ANY($2::text[]))+'+
     ' (SELECT COUNT(*) FROM student_enrollments WHERE school_id=$1 AND grade_level=ANY($2::text[]))+'+
     ' (SELECT COUNT(*) FROM school_sections WHERE school_id=$1 AND grade_level=ANY($2::text[]))+'+
     ' (SELECT COUNT(*) FROM class_periods WHERE school_id=$1 AND grade_level=ANY($2::text[]))+'+
     ' (SELECT COUNT(*) FROM class_adviser_assignments WHERE school_id=$1 AND grade_level=ANY($2::text[]))'+
     ')::integer AS total',[req.auth.schoolId,disabledGrades]);
    if(Number(r.rows[0]?.total)>0){
     await client.query('ROLLBACK');
     return res.status(409).json({error:'Cannot disable those grades while learner, section, adviser, or timetable records exist. Historical records are protected. Contact your School Admin to review them.'});
    }
   }
   await client.query(
    'INSERT INTO school_academic_levels(school_id,level_mode,updated_by_user_id) VALUES($1,$2,$3) '+
    'ON CONFLICT(school_id) DO UPDATE SET level_mode=EXCLUDED.level_mode,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW()',
    [req.auth.schoolId,mode,req.auth.userId]);
   await client.query(
    "INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) "+
    "VALUES($1,'SCHOOL',$2,'SCHOOL_ACADEMIC_LEVELS_CHANGED','school',$3,$4::jsonb)",
    [req.auth.schoolId,req.auth.userId,req.auth.schoolId,JSON.stringify({mode})]);
   await client.query('COMMIT');
   return res.json({mode,allowedGrades:gradesForMode(mode)});
  }catch(err){await client.query('ROLLBACK').catch(()=>{});return fail(err,res,'SHS config update');}
  finally{client.release();}
 });
 app.put('/api/shs/curriculum',authenticateSchoolClient,admin,async(req,res)=>{
  setPrivate(res);
  const {schoolYearId,gradeLevel,version}=req.body||{};
  const pilotConfirmed=req.body?.pilotConfirmed===true;
  if(!UUID.test(String(schoolYearId||''))||!['Grade 11','Grade 12'].includes(gradeLevel)||
   !['STRENGTHENED','LEGACY'].includes(version)|| (pilotConfirmed&&(gradeLevel!=='Grade 12'||version!=='STRENGTHENED')))
   return res.status(400).json({error:'Select an SHS grade, school year, and valid curriculum version.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   if((await readMode(client,req.auth.schoolId))==='JHS_ONLY'){
    await client.query('ROLLBACK');return res.status(409).json({error:'Enable SHS before configuring its curriculum.'});
   }
   const year=await readYear(client,req.auth.schoolId,schoolYearId);
   if(!year||year.status==='CLOSED'){
    await client.query('ROLLBACK');return res.status(409).json({error:'Select a school year belonging to this school that is not closed.'});
   }
   const startYear=Number(String(year.school_year_label).slice(0,4));
   if(gradeLevel==='Grade 11'&&startYear>=2026&&version!=='STRENGTHENED'){
    await client.query('ROLLBACK');return res.status(409).json({error:'Starting SY 2026–2027, Grade 11 must use the Strengthened SHS Curriculum.'});
   }
   if(gradeLevel==='Grade 12'&&version==='STRENGTHENED'&&startYear===2026&&!pilotConfirmed){
    await client.query('ROLLBACK');return res.status(409).json({error:'For SY 2026–2027, confirm that this school is an authorized Grade 12 SSHS pilot before selecting Strengthened.'});
   }
   await client.query(
    'INSERT INTO shs_year_curricula(school_id,school_year_id,grade_level,curriculum_version,grade12_pilot_confirmed,updated_by_user_id) '+
    'VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(school_id,school_year_id,grade_level) DO UPDATE '+
    'SET curriculum_version=EXCLUDED.curriculum_version,grade12_pilot_confirmed=EXCLUDED.grade12_pilot_confirmed,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW()',
    [req.auth.schoolId,schoolYearId,gradeLevel,version,pilotConfirmed,req.auth.userId]);
   await client.query(
    "INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) "+
    "VALUES($1,'SCHOOL',$2,'SHS_CURRICULUM_SET','school_year',$3,$4::jsonb)",
    [req.auth.schoolId,req.auth.userId,schoolYearId,JSON.stringify({gradeLevel,version,pilotConfirmed})]);
   await client.query('COMMIT');
   return res.json({schoolYearId,gradeLevel,version,pilotConfirmed});
  }catch(err){await client.query('ROLLBACK').catch(()=>{});return fail(err,res,'SHS curriculum save');}
  finally{client.release();}
 });
 app.get('/api/shs/enrollment-paths',authenticateSchoolClient,admin,async(req,res)=>{
  setPrivate(res);
  const yearId=String(req.query?.schoolYearId||'');
  if(!UUID.test(yearId))return res.status(400).json({error:'Choose a valid school year.'});
  try{
   const r=await pool.query(
    'SELECT e.enrollment_id AS "enrollmentId",e.grade_level AS "gradeLevel",e.section,e.student_id AS "studentId",s.full_name AS "fullName",'+
    'p.track_code AS track,p.strand_code AS strand '+
    'FROM student_enrollments e '+
    'JOIN school_years y ON y.school_id=e.school_id AND y.school_year_id=e.school_year_id '+
    'JOIN students s ON s.school_id=e.school_id AND s.student_id=e.student_id '+
    'LEFT JOIN shs_learner_paths p ON p.school_id=e.school_id AND p.enrollment_id=e.enrollment_id '+
    "WHERE e.school_id=$1 AND e.school_year_id=$2 AND e.grade_level IN ('Grade 11','Grade 12') "+
    "AND e.enrollment_status='ENROLLED' ORDER BY e.grade_level,e.section,s.full_name LIMIT 2000",
    [req.auth.schoolId,yearId]);
   return res.json({items:r.rows});
  }catch(err){return fail(err,res,'SHS enrollment paths load');}
 });
 app.put('/api/shs/enrollment-paths/:id',authenticateSchoolClient,admin,async(req,res)=>{
  setPrivate(res);
  const id=String(req.params.id||''),track=req.body?.track,strand=String(req.body?.strand||'').trim().toUpperCase();
  if(!UUID.test(id)||!TRACKS.includes(track)||strand.length>80|| (strand&&!/^[A-Z0-9][A-Z0-9 &/()_-]*$/.test(strand)))
   return res.status(400).json({error:'Choose a valid SHS track and optional recognized strand/cluster label.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const r=await client.query(
    'SELECT e.grade_level,e.school_year_id,sy.school_year_label FROM student_enrollments e '+
    'JOIN school_years sy ON sy.school_year_id=e.school_year_id AND sy.school_id=e.school_id '+
    'WHERE e.school_id=$1 AND e.enrollment_id=$2 AND e.enrollment_status=$3 AND sy.status<>$4 FOR UPDATE OF e',
    [req.auth.schoolId,id,'ENROLLED','CLOSED']);
   if(!r.rowCount||!['Grade 11','Grade 12'].includes(r.rows[0].grade_level)){
    await client.query('ROLLBACK');return res.status(404).json({error:'Active SHS enrollment not found in this school.'});
   }
   const row=r.rows[0];
   const curr=await client.query(
    'SELECT curriculum_version FROM shs_year_curricula WHERE school_id=$1 AND school_year_id=$2 AND grade_level=$3',
    [req.auth.schoolId,row.school_year_id,row.grade_level]);
   const version=curr.rows[0]?.curriculum_version||defaultCurriculum(row.grade_level,row.school_year_label);
   const allowedTracks=version==='STRENGTHENED'?['ACADEMIC','TECHPRO']:['ACADEMIC','TVL','SPORTS','ARTS_AND_DESIGN'];
   if(!allowedTracks.includes(track)){
    await client.query('ROLLBACK');return res.status(409).json({error:'That track does not apply to the selected SHS curriculum for this grade/year.'});
   }
   await client.query(
    'INSERT INTO shs_learner_paths(school_id,enrollment_id,track_code,strand_code,updated_by_user_id) VALUES($1,$2,$3,$4,$5) '+
    'ON CONFLICT(enrollment_id) DO UPDATE SET track_code=EXCLUDED.track_code,strand_code=EXCLUDED.strand_code,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW()',
    [req.auth.schoolId,id,track,strand||null,req.auth.userId]);
   await client.query(
    "INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) "+
    "VALUES($1,'SCHOOL',$2,'SHS_LEARNER_PATH_SET','student_enrollment',$3,$4::jsonb)",
    [req.auth.schoolId,req.auth.userId,id,JSON.stringify({track,strand:strand||null,version})]);
   await client.query('COMMIT');
   return res.json({enrollmentId:id,track,strand:strand||null,version});
  }catch(err){await client.query('ROLLBACK').catch(()=>{});return fail(err,res,'SHS learner pathway save');}
  finally{client.release();}
 });
}
module.exports={registerShsRoutes,gradesForMode,defaultCurriculum};
