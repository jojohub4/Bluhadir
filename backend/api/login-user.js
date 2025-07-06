import { createClient } from '@supabase/supabase-js';

const parentClient = createClient(
  process.env.PARENT_DB_URL,
  process.env.PARENT_SERVICE_ROLE
);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { org_code, email, reg_no, device_id } = req.body;

    console.log('📥 Incoming Request:', { org_code, email, reg_no, device_id });

    if (!org_code || !email || !reg_no || !device_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Step 1: Fetch organization DB credentials
    const { data: org, error: orgError } = await parentClient
      .from('schools')
      .select('db_url, anon_key, status')
      .eq('org_code', org_code)
      .single();

    if (orgError || !org) {
      console.error('❌ Invalid org code:', orgError);
      return res.status(404).json({ error: 'Invalid organization code' });
    }

    if (org.status !== 'active') {
      return res.status(403).json({ error: 'Organization suspended' });
    }

    const orgClient = createClient(org.db_url, org.anon_key);
    console.log('✅ Connected to org DB');

    const { data: dump } = await orgClient
      .from('students')
      .select('id, email, reg_no')
      .limit(10);

    console.log('🗂 Sample student records:', dump);

    // Step 2: Check for student match
    console.log('🔎 Checking email match with:', email);
    console.log('🔎 Checking reg_no match with:', reg_no);

    const { data: student, error: loginError } = await orgClient
      .from('students')
      .select('*')
      .eq('email', email.trim())
      .eq('reg_no', reg_no.trim())
      .maybeSingle();

    if (loginError || !student) {
      console.warn('⚠️ Invalid credentials');

      // DEBUG: Check email match
      const { data: emailMatch } = await orgClient
        .from('students')
        .select('id, reg_no')
        .eq('email', email.toLowerCase());

      // DEBUG: Check reg_no match
      const { data: regNoMatch } = await orgClient
        .from('students')
        .select('id, email')
        .eq('reg_no', reg_no.toLowerCase());

      console.log('🔍 Email match:', emailMatch);
      console.log('🔍 Reg No match:', regNoMatch);

      return res.status(401).json({
        error: 'Invalid credentials',
        debug: {
          emailFound: emailMatch?.length > 0,
          regNoFound: regNoMatch?.length > 0,
        },
      });
    }


    // Step 3: Check if device is used by another student
    const { data: other } = await orgClient
      .from('students')
      .select('id')
      .neq('email', email)
      .eq('device_id', device_id)
      .maybeSingle();

    if (other) {
      console.warn('🔒 Device already linked to another account');
      return res.status(403).json({
        error: 'This device is already linked to another account.',
      });
    }

    // Step 4: Check if student already locked to different device
    if (student.device_id && student.device_id !== device_id) {
      console.warn('🔐 Account is locked to a different device');
      return res.status(403).json({
        error: 'This account is already locked to a different device.',
      });
    }

    // Step 5: First login, bind device
    if (!student.device_id) {
      const { error: updateError } = await orgClient
        .from('students')
        .update({ device_id })
        .eq('id', student.id);

      if (updateError) {
        console.error('❌ Failed to bind device_id:', updateError);
        return res.status(500).json({ error: 'Failed to lock device' });
      }

      student.device_id = device_id; // update local copy
    }

    // ✅ Success
    console.log('✅ Login success for', student.email);
    return res.status(200).json({
      message: 'Login successful',
      student,
    });

  } catch (err) {
    console.error('🔥 Unhandled Error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}