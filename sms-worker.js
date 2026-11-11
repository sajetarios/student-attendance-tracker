require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const API_URL = "https://api.semaphore.co/api/v4/messages";
const POLL_MS = Number(process.env.SMS_POLL_INTERVAL_MS || 5000);
const MAX_ATTEMPTS = Number(process.env.SMS_MAX_ATTEMPTS || 5);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function claimOne() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id,event_id,recipient,message,attempts
       FROM sms_outbox WHERE status='PENDING' AND attempts < $1
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      [MAX_ATTEMPTS]
    );
    if (!result.rowCount) { await client.query("COMMIT"); return null; }
    const row = result.rows[0];
    await client.query(
      "UPDATE sms_outbox SET status='SENDING', attempts=attempts+1 WHERE id=$1",
      [row.id]
    );
    await client.query("COMMIT");
    return row;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
}

async function deliver(row) {
  const key = process.env.SEMAPHORE_API_KEY;
  if (!key) throw new Error("SEMAPHORE_API_KEY is not configured");
  const body = new URLSearchParams({
    apikey: key,
    number: row.recipient,
    message: row.message
  });
  if (process.env.SEMAPHORE_SENDER_NAME) body.set("sendername", process.env.SEMAPHORE_SENDER_NAME);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const raw = await response.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
  if (!response.ok) throw new Error(`Semaphore HTTP ${response.status}: ${raw.slice(0,500)}`);
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!item || !item.message_id) throw new Error(`Unexpected Semaphore response: ${raw.slice(0,500)}`);

  await pool.query(
    `UPDATE sms_outbox SET status='SENT', provider_message_id=$2,
      provider_status=$3, provider_response=$4::jsonb, sent_at=NOW(), last_error=NULL
     WHERE id=$1`,
    [row.id, String(item.message_id), String(item.status || "Queued"), JSON.stringify(parsed)]
  );
  console.log(`Semaphore accepted SMS outbox=${row.id} message_id=${item.message_id} status=${item.status}`);
}

async function run() {
  console.log("Semaphore SMS worker started");
  while (true) {
    let row;
    try { row = await claimOne(); }
    catch (e) { console.error("Claim error:", e.message); await sleep(POLL_MS); continue; }
    if (!row) { await sleep(POLL_MS); continue; }

    try {
      await deliver(row);
    } catch (e) {
      console.error(`SMS outbox ${row.id} failed:`, e.message);
      const nextStatus = (Number(row.attempts) + 1 >= MAX_ATTEMPTS) ? "FAILED" : "PENDING";
      await pool.query(
        "UPDATE sms_outbox SET status=$2,last_error=$3 WHERE id=$1",
        [row.id, nextStatus, e.message.slice(0,1000)]
      );
      // Gentle backoff before the next attempt.
      await sleep(Math.min(30000, POLL_MS * Math.pow(2, Number(row.attempts))));
    }
  }
}
run().catch(e => { console.error(e); process.exit(1); });
