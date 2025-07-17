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
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const schoolClient = await getSchoolClient(org_code);
    if (!schoolClient) {
      return res.status(404).json({ error: 'Invalid organization code' });
    }

    // First get existing record if it exists
    const { data: existingRecord, error: fetchError } = await schoolClient
      .from('attendance')
      .select()
      .eq('student_id', student_id)
      .eq('course_code', course_code)
      .eq('date', date)
      .maybeSingle();

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

    // Calculate total_hours if both check_in and check_out exist
    if (existingRecord) {
      if (action === 'check_out' && existingRecord.check_in) {
        const checkInTime = new Date(`1970-01-01T${existingRecord.check_in}Z`);
        const checkOutTime = new Date(`1970-01-01T${time}Z`);
        const diffMs = checkOutTime - checkInTime;
        const diffHrs = Math.floor(diffMs / 3600000);
        const diffMins = Math.floor((diffMs % 3600000) / 60000);
        
        updateData.total_hours = `${diffHrs.toString().padStart(2, '0')}:${diffMins.toString().padStart(2, '0')}`;
      }
    }

    // Upsert the attendance record
    const { error } = await schoolClient.from('attendance').upsert(updateData, {
      onConflict: 'student_id,course_code,date'
    });

    if (error) {
      console.error('❌ Attendance DB Error:', error);
      return res.status(500).json({ error: 'Failed to record attendance' });
    }

    // Log the attendance (optional)
    const logDir = path.join(process.cwd(), 'logs');
    const logPath = path.join(logDir, `attendance-${date}.log`);
    const logEntry = `[${new Date().toISOString()}] ${student_name} (${regNo}) ${action} for ${course_code} at ${time}\n`;
    appendFileSync(logPath, logEntry);

    return res.status(200).json({ message: 'Attendance recorded successfully' });

  } catch (err) {
    console.error('🔥 Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
