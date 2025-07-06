import { Pool } from 'pg';

// Parent DB connection
const parentPool = new Pool({
  connectionString: process.env.PARENT_DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Helper: Get school DB URL from parent DB
async function getDatabaseUrlFromSchoolCode(org_code) {
  const client = await parentPool.connect();
  try {
    const res = await client.query('SELECT database_url FROM schools WHERE org_code = $1 LIMIT 1', [org_code]);
    if (res.rows.length === 0) throw new Error('School not found');
    return res.rows[0].database_url;
  } finally {
    client.release();
  }
}

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
  const monthsDiff = (now.getFullYear() - registrationDate.getFullYear()) * 12 + (currentMonth - registrationDate.getMonth());
  const semesterIndex = Math.floor(monthsDiff / 4);
  const year = Math.floor(semesterIndex / 2) + 1;
  const semester = semesterIndex % 2 === 0 ? 1 : 2;
  const maxYear = level.toLowerCase() === 'diploma' ? 3 : 4;
  return { year: Math.min(year, maxYear), semester };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, reg_no, org_code } = req.query;

  if (!email || !reg_no || !org_code) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const dbUrl = await getDatabaseUrlFromSchoolCode(org_code);

    const schoolPool = new Pool({
      connectionString: dbUrl,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    const client = await schoolPool.connect();

    try {
      const studentQuery = `
        SELECT id, first_name, last_name, course, email, reg_no, date_of_registration, level
        FROM students 
        WHERE email = $1 AND reg_no = $2 LIMIT 1
      `;
      const studentResult = await client.query(studentQuery, [email, reg_no]);

      if (studentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Student not found' });
      }

      const student = studentResult.rows[0];
      const { date_of_registration, level, course } = student;

      const { year, semester } = getCurrentSemesterAndYear(date_of_registration, level);

      await client.query(
        `UPDATE students SET year = $1, semester = $2, updated_at = NOW() WHERE id = $3`,
        [year, semester, student.id]
      );

      const coursesQuery = `
        SELECT id, course_code, course_name, program, year, semester, delivery_mode
        FROM courses 
        WHERE program = $1 AND year = $2 AND semester = $3
        ORDER BY course_code ASC
      `;
      const coursesResult = await client.query(coursesQuery, [course, `Y${year}`, `S${semester}`]);

      return res.status(200).json({
        student: { ...student, year, semester },
        courses: coursesResult.rows,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
