import { createClient } from '@supabase/supabase-js';

// Parent Supabase connection
const parentClient = createClient(
  process.env.PARENT_DB_URL,
  process.env.PARENT_SERVICE_ROLE
);

// Logging function to console
function logEvent(level, message, context = {}) {
  console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`, context);
}

// Get school-specific Supabase client
async function getSchoolClient(org_code) {
  const { data, error } = await parentClient
    .from('schools')
    .select('db_url, anon_key')
    .eq('org_code', org_code)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) {
    logEvent('error', 'Failed to fetch school client', { error, org_code });
    return null;
  }

  return createClient(data.db_url, data.anon_key);
}

// Handler function
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
  } = req.body;

  if (!org_code || !student_id || !course_code || !action || !time || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const schoolClient = await getSchoolClient(org_code);
  if (!schoolClient) {
    return res.status(404).json({ error: 'Invalid organization code' });
  }

  const { error: insertError } = await schoolClient.from('attendance').insert([
    {
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
      time,
      action,
    },
  ]);

  if (insertError) {
    return res.status(500).json({ error: 'Failed to record attendance', details: insertError.message });
  }

  return res.status(200).json({ message: 'Attendance recorded successfully' });
}
