import { createClient } from '@supabase/supabase-js';
const { writeFileSync, appendFileSync } = require('fs');
const path = require('path');

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

  if (error || !data) return null;
  return createClient(data.db_url, data.anon_key);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Add this to the top of the file
const { writeFileSync, appendFileSync } = require('fs');
const path = require('path');

// Inside POST handler
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
  action,
  log
} = req.body;

// store attendance in DB (same as before)
await schoolClient.from('attendance').upsert({
  student_id,
  course_code,
  date,
  [action]: time
}, {
  onConflict: 'student_id,course_code,date'
});

// 🔥 Save full log string to a local file (optional)
const logDir = path.join(process.cwd(), 'logs');
const logPath = path.join(logDir, `attendance-${date}.log`);
appendFileSync(logPath, `${log}\n`);


  if (!org_code || !student_id || !course_code || !check_type || !time || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const schoolClient = await getSchoolClient(org_code);
    if (!schoolClient) return res.status(404).json({ error: 'Invalid organization code' });

    // Upsert attendance record
    const { error } = await schoolClient.from('attendance').upsert({
      student_id,
      course_code,
      date,
      [check_type]: time
    }, {
      onConflict: 'student_id,course_code,date'
    });

    if (error) {
      console.error('❌ Attendance DB Error:', error);
      return res.status(500).json({ error: 'Failed to record attendance' });
    }

    return res.status(200).json({ message: 'Attendance recorded successfully' });

  } catch (err) {
    console.error('🔥 Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
