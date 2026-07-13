import { createClient } from '@supabase/supabase-js'

const BUCKET = 'leads'

function respond(res, status, payload) {
  res.status(status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  return res.end(JSON.stringify(payload))
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return respond(res, 405, { error: 'Samo GET.' })
  }
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return respond(res, 503, { error: 'Storitev ni pravilno nastavljena.' })

  const id = typeof req.query?.id === 'string' ? req.query.id : ''
  if (!/^[a-f0-9]{32}$/.test(id)) return respond(res, 400, { error: 'Neveljavna povezava.' })

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await supabase.storage.from(BUCKET).download(`porocila/${id}.json`)
    if (error || !data) return respond(res, 404, { error: 'Poročila ni mogoče najti. Preverite povezavo iz e-pošte.' })
    const rec = JSON.parse(await data.text())
    return respond(res, 200, { ime: rec.ime, language: rec.language, ustvarjeno: rec.ustvarjeno, porocilo: rec.porocilo })
  } catch (error) {
    console.error('[porocilo] error:', error)
    return respond(res, 500, { error: 'Poročila trenutno ni mogoče naložiti.' })
  }
}
