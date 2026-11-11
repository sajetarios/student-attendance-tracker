require('dotenv').config();
const { Pool } = require('pg');
const readline = require('readline');
const { hashPassword } = require('./auth-security');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function ask(question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function askHidden(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      return reject(new Error('Run this command in an interactive PowerShell or Command Prompt window.'));
    }
    process.stdout.write(question);
    let answer = '';
    const finish = () => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      resolve(answer);
    };
    const onData = chunk => {
      for (const ch of String(chunk)) {
        if (ch === '\u0003') {
          input.removeListener('data', onData);
          input.setRawMode(false);
          process.stdout.write('\nCancelled.\n');
          process.exit(130);
        } else if (ch === '\r' || ch === '\n') {
          finish();
          return;
        } else if (ch === '\u0008' || ch === '\u007f') {
          if (answer.length) {
            answer = answer.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch >= ' ') {
          answer += ch;
          process.stdout.write('*');
        }
      }
    };
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    input.on('data', onData);
  });
}

async function main() {
  const [kind, schoolCode, roleArg] = process.argv.slice(2);
  if (!['platform', 'school'].includes(kind)) {
    throw new Error(
      'Usage:\n  node create-account.js platform\n  node create-account.js school LEGACY-SCHOOL SCHOOL_ADMIN\n  node create-account.js school LEGACY-SCHOOL DEPARTMENT_HEAD\n  node create-account.js school LEGACY-SCHOOL GATE_KEEPER\n  node create-account.js school LEGACY-SCHOOL TEACHER'
    );
  }
  let role = null;
  let schoolId = null;
  if (kind === 'school') {
    if (!schoolCode || !['SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'GATE_KEEPER', 'TEACHER'].includes(roleArg)) {
      throw new Error('For school accounts, provide a school code and one of SCHOOL_ADMIN, DEPARTMENT_HEAD, GATE_KEEPER, or TEACHER.');
    }
    const school = await pool.query(
      'SELECT school_id, school_name FROM schools WHERE lower(school_code)=lower($1) AND active=TRUE',
      [schoolCode]
    );
    if (!school.rowCount) throw new Error('Active school code not found in this database.');
    schoolId = school.rows[0].school_id;
    role = roleArg;
    console.log(`Creating ${role} account for ${school.rows[0].school_name} (${schoolCode}).`);
  } else {
    const existing = await pool.query('SELECT COUNT(*)::int AS count FROM platform_users');
    if (existing.rows[0].count > 0) {
      console.log('A platform account already exists. Additional platform accounts should be created through an authorized admin workflow.');
      process.exitCode = 2;
      return;
    }
    console.log('Creating the initial Super Administrator account.');
  }

  const username = await ask('Username: ');
  const displayName = await ask('Display name: ');
  if (!username || !displayName) throw new Error('Username and display name are required.');
  const password = await askHidden('Password (minimum 12 characters; input hidden): ');
  const confirm = await askHidden('Confirm password: ');
  if (password !== confirm) throw new Error('Passwords do not match.');
  const passwordHash = await hashPassword(password);

  if (kind === 'platform') {
    const result = await pool.query(
      `INSERT INTO platform_users (username, display_name, password_hash)
       VALUES ($1,$2,$3) RETURNING user_id`,
      [username, displayName, passwordHash]
    );
    console.log(`Created Super Administrator account. User ID: ${result.rows[0].user_id}`);
  } else {
    const result = await pool.query(
      `INSERT INTO school_users (school_id, username, display_name, password_hash, role, teacher_designations)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING user_id`,
      [schoolId, username, displayName, passwordHash, role, role === 'TEACHER' ? ['SUBJECT_TEACHER'] : []]
    );
    console.log(`Created ${role} account. User ID: ${result.rows[0].user_id}`);
  }
  console.log('Keep the username and password private. The password is not stored in plain text.');
}

main().catch(err => {
  console.error('Account creation failed:', err.message);
  process.exitCode = 1;
}).finally(async () => {
  rl.close();
  await pool.end();
});
