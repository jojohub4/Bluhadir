import { createClient } from '@supabase/supabase-js';
const { writeFileSync, appendFileSync } = require('fs');
const path = require('path');

const parentClient = createClient(
  process.env.PARENT_DB_URL,
  process.env.PARENT_SERVICE_ROLE
);

// Enhanced logging function
function logToFile(message, data = null) {
  const logDir = path.join(process.cwd(), 'logs');
  const logPath = path.join(logDir, 'api-debug.log');
  
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] ${message}\n`;
    
    if (data) {
      logEntry += `Data: ${JSON.stringify(data, null, 2)}\n`;
    }
    
    appendFileSync(logPath, logEntry);
    console.log(message); // Also log to console
  } catch (err) {
    console.error('Failed to write log:', err);
  }
}

async function getSchoolClient(org_code) {
  logToFile(`🔍 Fetching school client for org_code: ${org_code}`);
  
  const { data, error } = await parentClient
    .from('schools')
    .select('db_url, anon_key')
    .eq('org_code', org_code)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) {
    logToFile('❌ Failed to fetch school credentials', { error });
    return null;
  }

  logToFile('✅ Retrieved school credentials');
  return createClient(data.db_url, data.anon_key);
}

export default async function handler(req, res) {
  logToFile('📥 Incoming request', {
    method: req.method,
    body: req.body
  });

  if (req.method !== 'POST') {
    logToFile('⚠️ Method not allowed');
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

  // Validate required fields
  const requiredFields = ['org_code', 'student_id', 'course_code', 'action', 'time', 'date'];
  const missingFields = requiredFields.filter(field => !req.body[field]);
  
  if (missingFields.length > 0) {
    logToFile('❌ Missing required fields', { missingFields });
    return res.status(400).json({ 
      error: 'Missing required fields',
      missingFields
    });
  }

  try {
    logToFile('🔗 Connecting to school database...');
    const schoolClient = await getSchoolClient(org_code);
    
    if (!schoolClient) {
      logToFile('❌ Invalid organization code');
      return res.status(404).json({ error: 'Invalid organization code' });
    }

    logToFile('🔍 Checking for existing attendance record...');
    const { data: existingRecord, error: fetchError } = await schoolClient
      .from('attendance')
      .select()
      .eq('student_id', student_id)
      .eq('course_code', course_code)
      .eq('date', date)
      .maybeSingle();

    if (fetchError) {
      logToFile('❌ Error fetching existing record', { error: fetchError });
      return res.status(500).json({ error: 'Database error' });
    }

    logToFile('📝 Preparing attendance data...');
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
    if (existingRecord && action === 'check_out' && existingRecord.check_in) {
      logToFile('⏱ Calculating time difference...');
      const checkInTime = new Date(`1970-01-01T${existingRecord.check_in}Z`);
      const checkOutTime = new Date(`1970-01-01T${time}Z`);
      const diffMs = checkOutTime - checkInTime;
      const diffHrs = Math.floor(diffMs / 3600000);
      const diffMins = Math.floor((diffMs % 3600000) / 60000);
      
      updateData.total_hours = `${diffHrs.toString().padStart(2, '0')}:${diffMins.toString().padStart(2, '0')}`;
      
      logToFile('🕒 Calculated total hours', {
        check_in: existingRecord.check_in,
        check_out: time,
        total_hours: updateData.total_hours
      });
    }

    logToFile('💾 Saving attendance record...', updateData);
    const { error } = await schoolClient.from('attendance').upsert(updateData, {
      onConflict: 'student_id,course_code,date'
    });

    if (error) {
      logToFile('❌ Attendance DB Error', { error });
      return res.status(500).json({ error: 'Failed to record attendance' });
    }

    logToFile('✅ Attendance recorded successfully');
    return res.status(200).json({ message: 'Attendance recorded successfully' });

  } catch (err) {
    logToFile('🔥 Unexpected error', { error: err.message, stack: err.stack });
    return res.status(500).json({ 
      error: 'Internal server error',
      detail: err.message 
    });
  }
}
