import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';

// This publishable key is public; database permissions and RLS protect user data.
export const supabase = createClient(
  'https://gsbemjemdiofppgjxiyi.supabase.co',
  'sb_publishable_ZtwtWMtyNcNcYnsVOEGXbg_7S5BuMXz'
);
