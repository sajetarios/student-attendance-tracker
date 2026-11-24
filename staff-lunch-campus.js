'use strict';
// Trusted institutional circles are independently registered by the Principal.
// Browser GPS is evidence, not proof of institutional authority or room-level presence.
const {validLatitudeLongitude,distanceMeters}=require('./staff-lunch-location');
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function validCampus(campus){
 return !!campus&&validLatitudeLongitude(campus.latitude,campus.longitude)&&Number.isInteger(campus.radiusMeters)&&campus.radiusMeters>=100&&campus.radiusMeters<=5000;
}
function containsDepartment(campus,point,accuracyMeters=0){
 return validCampus(campus)&&!!point&&validLatitudeLongitude(point.latitude,point.longitude)&&Number.isInteger(point.radiusMeters)&&point.radiusMeters>=60&&point.radiusMeters<=250&&Number.isFinite(accuracyMeters)&&accuracyMeters>=0&&distanceMeters(campus,point)+point.radiusMeters+accuracyMeters+1<=campus.radiusMeters;
}
async function campusById(db,schoolId,campusId,lock=false){
 if(!UUID.test(String(campusId||'')))return null;
 const r=await db.query(`SELECT campus_id AS "campusId",name,latitude,longitude,radius_meters AS "radiusMeters",active
 FROM staff_lunch_campuses WHERE school_id=$1 AND campus_id=$2 AND active=TRUE`+(lock?' FOR SHARE':''),[schoolId,campusId]);
 return r.rows[0]||null;
}
async function trustedDepartmentPoint(db,schoolId,point){
 if(point?.relocationPending)return null;
 if(!point||!point.campusId)return point||null; // legacy independently approved location
 const campus=await campusById(db,schoolId,point.campusId,true);
 return containsDepartment(campus,point)?point:null;
}
module.exports={validCampus,containsDepartment,campusById,trustedDepartmentPoint};
