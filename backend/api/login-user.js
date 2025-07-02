import { createClient } from '@supabase/supabase-js';

const parentClient = createClient(
  process.env.PARENT_DB_URL,
  process.env.PARENT_SERVICE_ROLE
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { org_code, email, reg_no, device_id } = req.body;

  console.log('Incoming:', { org_code, email, reg_no, device_id });

  if (!org_code || !email || !reg_no || !device_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Get org DB credentials
  const { data: org, error } = await parentClient
    .from('schools')
    .select('db_url, anon_key, status')
    .eq('org_code', org_code)
    .single();

  if (error || !org) return res.status(404).json({ error: 'Invalid organization code' });
  if (org.status !== 'active') return res.status(403).json({ error: 'Organization suspended' });

  const orgClient = createClient(org.db_url, org.anon_key);

  // Check for student match
  const { data: student, error: loginError } = await orgClient
    .from('students')
    .select('*')
    .eq('email', email)
    .eq('reg_no', reg_no)
    .maybeSingle();

  if (loginError || !student)
    return res.status(401).json({ error: 'Invalid credentials' });

  // Rule 1: Device already bound to another account
  const { data: other } = await orgClient
    .from('students')
    .select('id')
    .neq('email', email)
    .eq('device_id', device_id)
    .maybeSingle();

  if (other) {
    return res.status(403).json({
      error: 'This device is already linked to another account.',
    });
  }

  // Rule 2: Account is already bound to another device
  if (student.device_id && student.device_id !== device_id) {
    return res.status(403).json({
      error: 'This account is already locked to a different device.',
    });
  }

  // First time login — bind device
  if (!student.device_id) {
    await orgClient
      .from('students')
      .update({ device_id })
      .eq('id', student.id);
    student.device_id = device_id;
  }

  // Success
  return res.status(200).json({
    message: 'Login successful',
    student,
  });
}
