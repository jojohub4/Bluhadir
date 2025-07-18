import { createClient } from '@supabase/supabase-js';

// Parent Supabase connection
const parentClient = createClient(
  process.env.PARENT_DB_URL,
  process.env.PARENT_SERVICE_ROLE
);

// Logging function
function logEvent(level, message, context = {}) {
  console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`, context);
}

// Get school-specific Supabase client
async function getSchoolClient(org_code) {
  logEvent('info', 'Fetching school client for org_code', { org_code });

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

  logEvent('info', 'Successfully fetched school Supabase config', data);
  return createClient(data.db_url, data.anon_key);
}

// Handler
export default async function handler(req, res) {
  logEvent('info', 'Incoming request to /api/record-attendance', {
    method: req.method,
    body: req.body,
  });

  if (req.method !== 'POST') {
    logEvent('warn', 'Invalid request method', { method: req.method });
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
    logEvent('error', 'Missing required fields', req.body);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const schoolClient = await getSchoolClient(org_code);
  if (!schoolClient) {
    logEvent('error', 'Invalid school org_code — client not found');
    return res.status(404).json({ error: 'Invalid organization code' });
  }

  const attendanceData = {
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
  };

  logEvent('info', 'Prepared attendance data for insertion', attendanceData);

  const { error: insertError } = await schoolClient
    .from('attendance')
    .insert([attendanceData]);

  if (insertError) {
    logEvent('error', 'Failed to insert attendance record', {
      error: insertError.message,
      attendanceData,
    });
    return res
      .status(500)
      .json({ error: 'Failed to record attendance', details: insertError.message });
  }

  logEvent('info', `Attendance recorded successfully for ${student_name}`, {
    student_id,
    course_code,
    date,
    action,
  });

  return res.status(200).json({ message: 'Attendance recorded successfully' });
}
