import { Pool } from 'pg';

// Parent DB connection
const parentPool = new Pool({
  connectionString: process.env.PARENT_DB_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

console.log('ℹ️ Parent DB Connection Pool created');

// Get school DB URL by org_code
async function getSchoolCredentials(org_code) {
  let client;
  try {
    console.log(`🔍 Attempting to connect to parent DB for org_code: ${org_code}`);
    client = await parentPool.connect();
    console.log('✅ Connected to parent DB');

    const queryText = `SELECT db_url, anon_key FROM schools WHERE org_code = $1 AND status = 'active' LIMIT 1`;
    console.log(`📝 Executing query: ${queryText} with params: [${org_code}]`);

    const res = await client.query(queryText, [org_code]);
    console.log(`🔍 Query result row count: ${res.rows.length}`);

    return res.rows[0] || null;
  } catch (err) {
    console.error('🔥 Parent DB Error:', {
      message: err.message,
      stack: err.stack,
      code: err.code
    });
    throw err;
  } finally {
    if (client) {
      console.log('🔌 Releasing parent DB connection');
      client.release();
    }
  }
}

// MAIN HANDLER
export default async function handler(req, res) {
  console.log('📥 Incoming request headers:', req.headers);
  console.log('📥 Incoming request body:', req.body);

  try {
    const { email, reg_no, org_code } = req.body;

    if (!email || !reg_no || !org_code) {
      console.warn('⚠️ Missing required fields');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log('🔍 Fetching school credentials...');
    const school = await getSchoolCredentials(org_code);

    if (!school) {
      console.warn(`⚠️ School not found for org_code: ${org_code}`);
      return res.status(404).json({ error: 'School not found' });
    }

    console.log('🏫 School DB URL:', school.db_url.replace(/\/\/.*@/, '//[REDACTED]@'));

    const schoolPool = new Pool({
      connectionString: school.db_url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });

    let schoolClient;
    try {
      console.log('🔗 Connecting to school DB...');
      schoolClient = await schoolPool.connect();
      console.log('✅ Connected to school DB');

      // Student query
      const studentQuery = `
        SELECT id, first_name, last_name, course, level, date_of_registration 
        FROM students 
        WHERE email = $1 AND reg_no = $2 
        LIMIT 1
      `;
      console.log(`📝 Executing student query: ${studentQuery}`);

      const studentRes = await schoolClient.query(studentQuery, [email, reg_no]);
      console.log(`🔍 Student query returned ${studentRes.rows.length} rows`);

      if (studentRes.rows.length === 0) {
        console.warn('⚠️ Student not found');
        return res.status(404).json({ error: 'Student not found' });
      }

      const student = studentRes.rows[0];
      console.log('👤 Found student:', {
        id: student.id,
        name: `${student.first_name} ${student.last_name}`
      });

      // Semester calculation
      const { year, semester } = getCurrentSemesterAndYear(
        student.date_of_registration,
        student.level
      );
      console.log(`📅 Calculated year: ${year}, semester: ${semester}`);

      // Courses query
      const coursesQuery = `
        SELECT id, course_code, course_name 
        FROM courses 
        WHERE program = $1 AND year = $2 AND semester = $3
      `;
      const coursesParams = [student.course, `Y${year}`, `S${semester}`];
      console.log(`📝 Executing courses query: ${coursesQuery} with params:`, coursesParams);

      const coursesRes = await schoolClient.query(coursesQuery, coursesParams);
      console.log(`📚 Found ${coursesRes.rows.length} courses`);

      return res.status(200).json({
        student: { ...student, year, semester },
        courses: coursesRes.rows
      });

    } catch (err) {
      console.error('🔥 School DB Error:', {
        message: err.message,
        stack: err.stack,
        code: err.code
      });
      return res.status(500).json({
        error: 'Database operation failed',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    } finally {
      if (schoolClient) {
        console.log('🔌 Releasing school DB connection');
        schoolClient.release();
      }
      schoolPool.end();
    }
  } catch (err) {
    console.error('🔥 Endpoint Error:', {
      message: err.message,
      stack: err.stack,
      code: err.code
    });
    return res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
}

// Semester/year logic
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
