function getSupabaseUrl() {
  return (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  )
    .trim()
    .replace(/\/rest\/v1\/?$/, '')
    .replace(/\/$/, '')
}

export default async function handler(req, res) {
  const supabaseUrl = getSupabaseUrl()
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, error: 'Supabase env vars missing' })
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/documents?select=id&limit=1`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    })

    if (!response.ok) {
      console.error('[keepalive] Supabase query failed:', response.status)
      return res.status(502).json({ ok: false, status: response.status })
    }

    return res.status(200).json({ ok: true, pinged_at: new Date().toISOString() })
  } catch (error) {
    console.error('[keepalive] Supabase unreachable:', error)
    return res.status(502).json({ ok: false, error: 'Supabase unreachable' })
  }
}
