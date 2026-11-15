#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const readline = require('readline');
const { hashPassword } = require('../auth-security');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Copy your existing .env file into this project folder.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultValue = '') {
  return new Promise(resolve => rl.question(question, answer => {
    const value = answer.trim();
    resolve(value || defaultValue);
  }));
}

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
  const username = await ask('School username to reset [sajeta]: ', 'sajeta');
  if (!username || username.length > 80) throw new Error('Enter a valid school username.');

  const candidates = await pool.query(
    `SELECT su.user_id, su.school_id, su.username, su.display_name, su.role,
            s.school_code, s.school_name
     FROM school_users su
     JOIN schools s ON s.school_id=su.school_id
     WHERE lower(su.username)=lower($1) AND su.active=TRUE AND s.active=TRUE
     ORDER BY s.school_name`,
    [username]
  );
  if (!candidates.rowCount) throw new Error(`No active school account was found for username "${username}".`);

  let account;
  if (candidates.rowCount === 1) {
    account = candidates.rows[0];
  } else {
    console.log('\nMore than one active account uses that username:');
    candidates.rows.forEach((row, i) => {
      console.log(`${i + 1}. ${row.school_name} (school code: ${row.school_code}) — ${row.display_name}, ${row.role}`);
    });
    const selectedCode = await ask('Enter the exact school code for the account to reset: ');
    account = candidates.rows.find(row => row.school_code.toLowerCase() === selectedCode.toLowerCase());
    if (!account) throw new Error('The school code did not match one of the listed accounts. No changes were made.');
  }

  console.log('\nAccount selected:');
  console.log(`  Name: ${account.display_name}`);
  console.log(`  Username: ${account.username}`);
  console.log(`  Role: ${account.role}`);
  console.log(`  School: ${account.school_name} (${account.school_code})`);
  const confirmation = await ask('\nType RESET to change this account password: ');
  if (confirmation !== 'RESET') throw new Error('Confirmation did not match. No changes were made.');

  const password = await askHidden('New password (12–256 characters; input hidden): ');
  const confirm = await askHidden('Confirm new password: ');
  if (password !== confirm) throw new Error('Passwords do not match. No changes were made.');
  const passwordHash = await hashPassword(password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT user_id FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND active=TRUE
       FOR UPDATE`,
      [account.school_id, account.user_id]
    );
    if (!locked.rowCount) throw new Error('The account is no longer active. No changes were made.');

    await client.query(
      `UPDATE school_users
       SET password_hash=$3, failed_login_attempts=0, locked_until=NULL, updated_at=NOW()
       WHERE school_id=$1 AND user_id=$2`,
      [account.school_id, account.user_id, passwordHash]
    );
    const revoked = await client.query(
      `UPDATE user_sessions
       SET revoked_at=NOW()
       WHERE principal_type='SCHOOL' AND school_id=$1 AND school_user_id=$2
         AND revoked_at IS NULL`,
      [account.school_id, account.user_id]
    );
    await client.query('COMMIT');
    console.log(`\nPassword reset completed for ${account.username}.`);
    console.log(`Revoked ${revoked.rowCount} existing session(s).`);
    console.log('Sign in again using the new password. Your account role and teacher designations were not changed.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch(err => {
    console.error(`\nPassword reset failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await pool.end();
  });
