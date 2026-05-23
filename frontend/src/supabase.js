import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://dqcjgvotffxutvgvahse.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_arD4r6tjnwReEbNsMvv_Hg_i3mmU-x_';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Helper: Fetch user points
export async function fetchUserPoints(address) {
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('address', address)
    .maybeSingle();
  
  if (error) console.error('fetchUserPoints error:', error);
  return data;
}

// Helper: Fetch global stats
export async function fetchStats() {
  const { data, error } = await supabase
    .from('stats')
    .select('*')
    .single();
  
  if (error) console.error('fetchStats error:', error);
  return data;
}
