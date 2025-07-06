import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function getCurrentSemesterAndYear(regDate, level) {
  const now = new Date();
  const intakes = [0, 4, 8]; // Jan (0), May (4), Sept (8)
  const currentMonth = now.getMonth();
  
  // Find the closest intake month to registration date
  const registrationDate = new Date(regDate);
  const registrationMonth = registrationDate.getMonth();
  const closestIntake = intakes.reduce((prev, curr) => 
    Math.abs(curr - registrationMonth) < Math.abs(prev - registrationMonth) ? curr : prev
  );
  
  // Adjust registration date to the closest intake
  registrationDate.setMonth(closestIntake);
  registrationDate.setDate(1);
  
  // Calculate months since registration
  const monthsDiff = (now.getFullYear() - registrationDate.getFullYear()) * 12 + 
                    (currentMonth - registrationDate.getMonth());
  
  // Calculate academic semester (every 4 months)
  const semesterIndex = Math.floor(monthsDiff / 4);
  const year = Math.floor(semesterIndex / 2) + 1;
  const semester = semesterIndex % 2 === 0 ? 1 : 2;

  // Cap year based on program level
  const maxYear = level.toLowerCase() === 'diploma' ? 3 : 4;
  const cappedYear = Math.min(year, maxYear);

  return { year: cappedYear, semester };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Only GET requests are supported'
    });
  }

  const { email, reg_no } = req.query;

  if (!email || !reg_no) {
    return res.status(400).json({ 
      error: 'Missing required parameters',
      details: {
        email: !email ? 'Email is required' : undefined,
        reg_no: !reg_no ? 'Registration number is required' : undefined
      }
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ 
      error: 'Invalid email format' 
    });
  }

  try {
    const client = await pool.connect();

    try {
      // Get student record
      const studentQuery = `
        SELECT 
          id, first_name, last_name, course, email, 
          reg_no, date_of_registration, level
        FROM students 
        WHERE email = $1 AND reg_no = $2 
        LIMIT 1
      `;
      const studentResult = await client.query(studentQuery, [email, reg_no]);

      if (studentResult.rows.length === 0) {
        return res.status(404).json({ 
          error: 'Student not found',
          message: 'No student found with the provided credentials'
        });
      }

      const student = studentResult.rows[0];
      const { date_of_registration, level, course } = student;

      // Calculate current academic progression
      const { year, semester } = getCurrentSemesterAndYear(date_of_registration, level);

      // Update student's academic progress with updated_at
      const updateQuery = `
        UPDATE students 
        SET 
          year = $1, 
          semester = $2, 
          updated_at = NOW() 
        WHERE id = $3
      `;
      await client.query(updateQuery, [year, semester, student.id]);

      // Fetch courses matching student's course (as program) and current semester
      const coursesQuery = `
        SELECT 
          id, course_code, course_name, 
          program, year, semester, delivery_mode
        FROM courses 
        WHERE program = $1 
          AND year = $2 
          AND semester = $3
        ORDER BY course_code ASC
      `;
      const coursesResult = await client.query(coursesQuery, [
        course,
        `Y${year}`, 
        `S${semester}`
      ]);

      return res.status(200).json({
        student: {
          ...student,
          year,
          semester,
        },
        courses: coursesResult.rows,
        academic_info: {
          program: course,
          level: level,
          current_year: year,
          current_semester: semester,
          formatted_year: `Year ${year}`,
          formatted_semester: `Semester ${semester}`
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to process your request'
    });
  }
}