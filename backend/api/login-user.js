import { createClient } from '@supabase/supabase-js';

const parentClient = createClient(
    process.env.PARENT_DB_URL,
    process.env.PARENT_SERVICE_ROLE
);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    console.log('Incoming body:', req.body);

    const { org_code, email, reg_no } = req.body;

    if (!org_code || !email || !reg_no) {
        console.log('❌ Missing:', { org_code, email, reg_no });
        return res.status(400).json({ error: 'Missing required fields' });
    }
    // Step 1: Get DB details from parent DB
    const { data: school, error } = await parentClient
        .from('schools')
        .select('db_url, anon_key, status')
        .eq('org_code', org_code)
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

    // Step 4: Device binding logic
    const incomingDeviceId = req.body.device_id;

    if (!incomingDeviceId)
        return res.status(400).json({ error: 'Missing device_id' });

    if (student.device_id && student.device_id !== incomingDeviceId) {
        return res.status(403).json({ error: 'Account is locked to a different device.' });
    }

    // Check if this device ID is already used by another student
    const { data: conflictingUser } = await schoolClient
        .from('students')
        .select('id')
        .neq('email', email)
        .eq('device_id', incomingDeviceId)
        .maybeSingle();

    if (conflictingUser) {
        return res.status(403).json({ error: 'This device is already linked to another account.' });
    }

    // Step 5: If device_id is empty, update it to bind the account
    if (!student.device_id) {
        await schoolClient
            .from('students')
            .update({ device_id: incomingDeviceId })
            .eq('id', student.id);
    }

    // Success
    return res.status(200).json({ message: 'Login successful', student });
}
