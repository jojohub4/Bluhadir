import { createClient } from '@supabase/supabase-js';

const parentClient = createClient(
  process.env.PARENT_DB_URL,
  process.env.PARENT_SERVICE_ROLE
);

console.log('✅ Supabase parent client initialized');

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

    const schoolClient = createClient(school.db_url, school.anon_key);

    // 🔍 Fetch student
    const { data: student, error: studentError } = await schoolClient
      .from('students')
      .select('id, first_name, last_name, course, level, date_of_registration')
      .eq('email', email)
      .eq('reg_no', reg_no)
      .maybeSingle();

    if (studentError || !student) {
      console.warn('⚠️ Student not found:', studentError);
      return res.status(404).json({ error: 'Student not found' });
    }

    console.log('👤 Found student:', `${student.first_name} ${student.last_name}`);

    const { year, semester } = getCurrentSemesterAndYear(
      student.date_of_registration,
      student.level
    );

    console.log(`📅 Calculated Year: ${year}, Semester: ${semester}`);

    // 🔍 Fetch courses
    const { data: courses, error: coursesError } = await schoolClient
      .from('courses')
      .select('id, course_code, course_name, delivery_mode')
      .eq('program', student.course)
      .eq('year', `Y${year}`)
      .eq('semester', `S${semester}`);

    if (coursesError) {
      console.error('🔥 Failed to fetch courses:', coursesError);
      return res.status(500).json({ error: 'Failed to fetch courses' });
    }

    console.log(`📚 Found ${courses.length} courses`);

    return res.status(200).json({
      student: { ...student, year, semester },
      courses,
    });

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
