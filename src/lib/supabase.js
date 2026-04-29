import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ── Profile helpers ───────────────────────────────────────────────────────────

// Load all profiles for a given household code (works across devices).
// Falls back to legacy session_id lookup so existing users aren't stranded.
export async function loadProfiles(householdCode, legacySessionId) {
  // Primary lookup: household_code
  let { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('household_code', householdCode)
    .order('slot')

  if (error) throw error

  // Fallback for legacy installs that haven't been migrated yet:
  // if no rows found, try session_id and adopt it as the household code
  if ((!data || data.length === 0) && legacySessionId) {
    const legacy = await supabase
      .from('profiles')
      .select('*')
      .eq('session_id', legacySessionId)
      .order('slot')
    if (legacy.error) throw legacy.error
    if (legacy.data && legacy.data.length > 0) {
      // Backfill household_code on these rows so future loads work directly
      await supabase
        .from('profiles')
        .update({ household_code: householdCode })
        .eq('session_id', legacySessionId)
        .is('household_code', null)
      // Re-read with household_code set
      const reread = await supabase
        .from('profiles')
        .select('*')
        .eq('household_code', householdCode)
        .order('slot')
      data = reread.data
    }
  }

  return data || []
}

export async function saveProfile(profile) {
  const { data, error } = await supabase
    .from('profiles')
    .upsert(profile, { onConflict: 'id' })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteProfile(profileId) {
  const { error } = await supabase
    .from('profiles')
    .delete()
    .eq('id', profileId)
  if (error) throw error
}

export async function saveQuestResult(result) {
  const { error } = await supabase
    .from('quest_results')
    .insert(result)

  if (error) throw error
}

export async function loadQuestHistory(profileId) {
  const { data, error } = await supabase
    .from('quest_results')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  return data
}
