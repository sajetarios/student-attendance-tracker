'use strict';
// Existing prescribed office hours: employee override takes precedence over a
// complete, authorized school-wide default. Never use class-period times.
const {validHours}=require('./form48-calculations');
function isConfiguredSchedule(value){
 if(!value||!Array.isArray(value.workdays)||!value.workdays.length||value.workdays.length>7||
  new Set(value.workdays).size!==value.workdays.length||
  !value.workdays.every(day=>Number.isInteger(day)&&day>=0&&day<=6))return false;
 return (!value.workdays.some(day=>day!==6)||validHours(value.regularHours))&&
  (!value.workdays.includes(6)||validHours(value.saturdayHours));
}
function effectiveStaffSchedule(employeeSchedule,schoolDefaults){
 if(employeeSchedule)return isConfiguredSchedule(employeeSchedule)
  ?{schedule:employeeSchedule,source:'EMPLOYEE'}:{schedule:null,source:'INVALID_EMPLOYEE'};
 if(isConfiguredSchedule(schoolDefaults))return {schedule:schoolDefaults,source:'SCHOOL'};
 return {schedule:null,source:'UNCONFIGURED'};
}
module.exports={isConfiguredSchedule,effectiveStaffSchedule};
