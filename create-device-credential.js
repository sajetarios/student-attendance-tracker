'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { createOpaqueToken, hashToken } = require('./auth-security');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const [schoolCode, deviceId, deviceName, entranceName] = process.argv.slice(2);
  if (![schoolCode, deviceId, deviceName, entranceName].every(v => typeof v === 'string' && v.trim())) {
    throw new Error('Usage: node create-device-credential.js SCHOOL-CODE DEVICE-ID DEVICE-NAME ENTRANCE-NAME');
  }
  const school = await pool.query(
    'SELECT school_id, school_name FROM schools WHERE lower(school_code)=lower($1) AND active=TRUE',
    [schoolCode.trim()]
  );
  if (!school.rowCount) throw new Error('Active school code not found.');
  const schoolId = school.rows[0].school_id;

  const existingDevice = await pool.query(
    'SELECT school_id FROM attendance_devices WHERE device_id=$1', [deviceId.trim()]
  );
  if (existingDevice.rowCount && existingDevice.rows[0].school_id !== schoolId) {
    throw new Error('That device ID is already registered to another school. Choose a different device ID.');
  }
  const existingCredential = await pool.query(
    `SELECT credential_id FROM device_api_credentials
     WHERE school_id=$1 AND device_id=$2 AND active=TRUE AND revoked_at IS NULL`,
    [schoolId, deviceId.trim()]
  );
  if (existingCredential.rowCount) {
    throw new Error('This device already has an active credential. Revoke it before rotating credentials.');
  }

  const token = createOpaqueToken();
  const tokenHash = hashToken(token);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO attendance_devices(device_id, device_name, entrance_name, active, school_id)
       VALUES($1,$2,$3,TRUE,$4)
       ON CONFLICT(device_id) DO UPDATE
         SET device_name=EXCLUDED.device_name, entrance_name=EXCLUDED.entrance_name,
             active=TRUE`,
      [deviceId.trim(), deviceName.trim(), entranceName.trim(), schoolId]
    );
    await client.query(
      `INSERT INTO device_api_credentials(school_id, device_id, device_name, token_hash)
       VALUES($1,$2,$3,$4)`,
      [schoolId, deviceId.trim(), deviceName.trim(), tokenHash]
    );
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, action, entity_type, entity_id, details)
       VALUES($1,'SYSTEM','DEVICE_CREDENTIAL_CREATED','DEVICE',$2,$3::jsonb)`,
      [schoolId, deviceId.trim(), JSON.stringify({ deviceName: deviceName.trim(), entranceName: entranceName.trim() })]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('\nDevice credential created. Copy this token now; it will not be shown again.\n');
  console.log(`School: ${school.rows[0].school_name} (${schoolCode})`);
  console.log(`Device ID: ${deviceId}`);
  console.log(`Device token: ${token}`);
  console.log('\nStore the token securely in the gate device configuration. Do not share it.');
}

main().catch(err => {
  console.error('Device credential creation failed:', err.message);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
