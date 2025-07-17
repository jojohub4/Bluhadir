import { createClient } from '@supabase/supabase-js';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function logEvent(message) {
  const date = new Date().toISOString().slice(0, 10);
  const logDir = path.join(__dirname, '..', 'logs');
  const logPath = path.join(logDir, `attendance-${date}.log`);

  if (!existsSync(logDir)) mkdirSync(logDir);

  const timestamp = new Date().toISOString();
  appendFileSync(logPath, `[${timestamp}] ${message}\n`);
}

const parentClient = createClient(
  process.env.PARENT_DB_URL,
  process.env.PARENT_SERVICE_ROLE
);

async function getSchoolClient(org_code) {
  const { data, error } = await parentClient
    .from('schools')
    .select('db_url, anon_key')
    .eq('org_code', org_code)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) {
    logEvent(`❌ Failed to fetch school DB for org_code=${org_code}`);
    return null;
  }

  logEvent(`✅ Connected to school DB for org_code=${org_code}`);
  return createClient(data.db_url, data.anon_key);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    logEvent(`❌ Rejected ${req.method} request`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const payload = req.body;
  logEvent(`📥 Incoming attendance payload: ${JSON.stringify(payload)}`);

  const {
    org_code,
    student_id,
    course_code,
    course_name,
    student_name,
    reg_no,
    email,
    program,
    beacon_name,
    uuid,
    major,
    minor,
    date,
    time,
    action
  } = payload;

  if (!org_code || !student_id || !course_code || !action || !time || !date) {
    logEvent(`❌ Missing required fields`);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const schoolClient = await getSchoolClient(org_code);
    if (!schoolClient) {
      return res.status(404).json({ error: 'Invalid organization code' });
    }

    const { data: existingRecord } = await schoolClient
      .from('attendance')
      .select()
      .eq('student_id', student_id)
      .eq('course_code', course_code)
      .eq('date', date)
      .maybeSingle();

    logEvent(existingRecord
      ? `📄 Existing record found for ${student_id} on ${date}`
      : `🆕 No existing record found — will insert`);

    const updateData = {
      student_id: parseInt(student_id),
      student_name,
      reg_no,
      email,
      program,
      course_code,
      course_name,
      beacon_name,
      uuid,
      major,
      minor,
      date,
      [action === 'check_in' ? 'check_in' : 'check_out']: time
    };

    if (existingRecord && action === 'check_out' && existingRecord.check_in) {
      const checkInTime = new Date(`1970-01-01T${existingRecord.check_in}Z`);
      const checkOutTime = new Date(`1970-01-01T${time}Z`);
      const diffMs = checkOutTime - checkInTime;
      const diffHrs = Math.floor(diffMs / 3600000);
      const diffMins = Math.floor((diffMs % 3600000) / 60000);
      updateData.total_hours = `${diffHrs.toString().padStart(2, '0')}:${diffMins.toString().padStart(2, '0')}`;
    }

    const { error: upsertError } = await schoolClient
      .from('attendance')
      .upsert(updateData, { onConflict: 'student_id,course_code,date' });

    if (upsertError) {
      logEvent(`❌ Upsert error: ${upsertError.message}`);
      return res.status(500).json({ error: 'Failed to record attendance' });
    }

    logEvent(`✅ Attendance ${action} recorded for ${student_name} (${reg_no}) on ${date} at ${time}`);
    return res.status(200).json({ message: 'Attendance recorded successfully' });

  } catch (err) {
    logEvent(`🔥 Unexpected error: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
