import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://euckzohvgvqphvfqngvz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eixi-jgzz3srMM45R1ak-w_keI2461f";

export const isConfigured = !SUPABASE_URL.includes("TU-PROYECTO")
  && !SUPABASE_ANON_KEY.includes("REEMPLAZAR");
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const submitRsvpUrl = `${SUPABASE_URL}/functions/v1/submit-rsvp`;
