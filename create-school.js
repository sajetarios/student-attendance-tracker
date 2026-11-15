'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const [schoolCodeArg, ...schoolNameParts] = process.argv.slice(2);
const schoolCode = String(schoolCodeArg || '').trim();
const schoolName = schoolNameParts.join(' ').trim();

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing.');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(schoolCode) || schoolName.length < 2 || schoolName.length > 200) {
    throw new Error('Usage: node create-school.js SCHOOL-CODE "School Name"');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(
      `INSERT INTO schools(school_code, school_name)
       VALUES($1,$2)
       RETURNING school_id, school_code, school_name`,
      [schoolCode, schoolName]
    );
    console.log('School created successfully:');
    console.log(`School ID: ${result.rows[0].school_id}`);
    console.log(`School Code: ${result.rows[0].school_code}`);
    console.log(`School Name: ${result.rows[0].school_name}`);
    console.log(`Next: node create-account.js school ${result.rows[0].school_code} SCHOOL_ADMIN`);
  } catch (error) {
    if (error.code === '23505') throw new Error('That school code is already registered. Use a different school code.');
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
