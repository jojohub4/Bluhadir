import { createClient } from '@supabase/supabase-js';

const parentClient = createClient(
  process.env.PARENT_DB_URL,
  process.env.PARENT_SERVICE_ROLE
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { school_code, email, reg_no } = req.body;

  if (!school_code || !email || !reg_no)
    return res.status(400).json({ error: 'Missing required fields' });

  // Step 1: Get DB details from parent DB
  const { data: school, error } = await parentClient
    .from('schools')
    .select('db_url, anon_key, status')
    .eq('school_code', school_code)
    .single();

  if (error || !school) return res.status(404).json({ error: 'Invalid school code' });
  if (school.status !== 'active') return res.status(403).json({ error: 'School suspended' });

  // Step 2: Connect to the school DB
  const schoolClient = createClient(school.db_url, school.anon_key);

  const { data: student, error: loginError } = await schoolClient
    .from('students')
    .select('*')
    .eq('email', email)
    .eq('reg_no', reg_no)
    .maybeSingle();

  if (loginError || !student)
    return res.status(401).json({ error: 'Invalid credentials' });

  // Success
  return res.status(200).json({ message: 'Login successful', student });
}
