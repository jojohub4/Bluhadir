import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

// Supabase parent DB client (API-based, authenticated)
const parentClient = createClient(
  process.env.PARENT_DB_URL,            // Supabase URL (e.g., https://xyz.supabase.co)
  process.env.PARENT_SERVICE_ROLE       // service_role key
);

console.log('✅ Supabase parent client initialized');

// 🔍 Fetch school DB credentials from parent Supabase table
async function getSchoolCredentials(org_code) {
  console.log(`🔍 Fetching credentials for org_code: ${org_code}`);

  const { data, error } = await parentClient
    .from('schools')
    .select('db_url, anon_key')
    .eq('org_code', org_code)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) {
    console.error('❌ Failed to fetch school credentials:', error);
    return null;
  }

  console.log('✅ Fetched school DB credentials');
  return data;
}

// Main API handler
export default async function handler(req, res) {
  console.log('📥 Request received:', req.body);

  const { email, reg_no, org_code } = req.body;

  if (!email || !reg_no || !org_code) {
    console.warn('⚠️ Missing required fields');
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const school = await getSchoolCredentials(org_code);
    if (!school) {
      console.warn('⚠️ No active school found for code:', org_code);
      return res.status(404).json({ error: 'School not found or inactive' });
    }

    // Connect to school DB directly
    const schoolPool = new Pool({
      connectionString: school.db_url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });

    let schoolClient;
    try {
      console.log('🔗 Connecting to school DB...');
      schoolClient = await schoolPool.connect();
      console.log('✅ Connected to school DB');

      const studentQuery = `
        SELECT id, first_name, last_name, course, level, date_of_registration 
        FROM students 
        WHERE email = $1 AND reg_no = $2 
        LIMIT 1
      `;
      const studentRes = await schoolClient.query(studentQuery, [email, reg_no]);

      if (studentRes.rows.length === 0) {
        console.warn('⚠️ Student not found in school DB');
        return res.status(404).json({ error: 'Student not found' });
      }

      const student = studentRes.rows[0];
      console.log('👤 Found student:', `${student.first_name} ${student.last_name}`);

      const { year, semester } = getCurrentSemesterAndYear(
        student.date_of_registration,
        student.level
      );
      console.log(`📅 Calculated Year: ${year}, Semester: ${semester}`);

      const coursesQuery = `
        SELECT id, course_code, course_name 
        FROM courses 
        WHERE program = $1 AND year = $2 AND semester = $3
      `;
      const coursesParams = [student.course, `Y${year}`, `S${semester}`];
      const coursesRes = await schoolClient.query(coursesQuery, coursesParams);

      console.log(`📚 Found ${coursesRes.rows.length} courses`);

      return res.status(200).json({
        student: { ...student, year, semester },
        courses: coursesRes.rows,
      });

    } catch (err) {
      console.error('🔥 School DB error:', err);
      return res.status(500).json({ error: 'Failed to fetch student/courses' });
    } finally {
      if (schoolClient) schoolClient.release();
      schoolPool.end();
    }

  } catch (err) {
    console.error('🔥 Handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// 🎓 Semester & year calculator
function getCurrentSemesterAndYear(regDate, level) {
  const now = new Date();
  const intakes = [0, 4, 8]; // Jan, May, Sept
  const currentMonth = now.getMonth();
  const registrationDate = new Date(regDate);
  const registrationMonth = registrationDate.getMonth();
  const closestIntake = intakes.reduce((prev, curr) =>
    Math.abs(curr - registrationMonth) < Math.abs(prev - registrationMonth) ? curr : prev
  );
  registrationDate.setMonth(closestIntake);
  registrationDate.setDate(1);
  const monthsDiff =
    (now.getFullYear() - registrationDate.getFullYear()) * 12 +
    (currentMonth - registrationDate.getMonth());
  const semesterIndex = Math.floor(monthsDiff / 4);
  const year = Math.floor(semesterIndex / 2) + 1;
  const semester = semesterIndex % 2 === 0 ? 1 : 2;
  const maxYear = level.toLowerCase() === 'diploma' ? 3 : 4;
  return { year: Math.min(year, maxYear), semester };
}
