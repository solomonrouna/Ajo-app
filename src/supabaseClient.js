import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://mqigjcqcamcyruldbftf.supabase.co'
const supabaseKey = 'sb_publishable_mjYmdikYQYER5QiLZvkgqg_fDFk6yDX'

export const supabase = createClient(supabaseUrl, supabaseKey)

