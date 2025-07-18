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
    logEvent('warn', 'Invalid method attempt', { method: req.method });
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
    action
  } = req.body;

  if (!org_code || !student_id || !course_code || !action || !time || !date) {
    logEvent('error', 'Missing required fields', req.body);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const schoolClient = await getSchoolClient(org_code);
    if (!schoolClient) {
      return res.status(404).json({ error: 'Invalid organization code' });
    }

    const { data: existingRecord, error: fetchError } = await schoolClient
      .from('attendance')
      .select()
      .eq('student_id', student_id)
      .eq('course_code', course_code)
      .eq('date', date)
      .maybeSingle();

    if (fetchError) {
      logEvent('error', 'Error fetching existing attendance record', fetchError);
    }

    let updateData = {
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

    // Add total_hours if both check-in and check-out exist
    if (existingRecord && action === 'check_out' && existingRecord.check_in) {
      const checkInTime = new Date(`1970-01-01T${existingRecord.check_in}Z`);
      const checkOutTime = new Date(`1970-01-01T${time}Z`);
      const diffMs = checkOutTime - checkInTime;
      const diffHrs = Math.floor(diffMs / 3600000);
      const diffMins = Math.floor((diffMs % 3600000) / 60000);
      updateData.total_hours = `${diffHrs.toString().padStart(2, '0')}:${diffMins.toString().padStart(2, '0')}`;
    }

    const { error: upsertError } = await schoolClient.from('attendance').upsert(updateData, {
      onConflict: 'student_id,course_code,date'
    });

    if (upsertError) {
      logEvent('error', 'Failed to upsert attendance', upsertError);
      return res.status(500).json({ error: 'Failed to record attendance' });
    }

    logEvent('info', `${student_name} (${regNo}) ${action} at ${time}`, {
      student_id, course_code, date
    });

    return res.status(200).json({ message: 'Attendance recorded successfully' });

  } catch (err) {
    logEvent('fatal', 'Unexpected error during attendance record', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
