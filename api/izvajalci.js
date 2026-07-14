import { createClient } from '@supabase/supabase-js'

// Uradni vir: Zavarovalnica Triglav, d.d. — objava odobrena (14. 7. 2026).
const VIR = 'https://www.triglav.si/wps/wcm/connect/triglav.si/ajax/pog-servisi-ajax?wcmitemid=50c27a3e-cd01-4b0b-a75f-7f3dcbee56a4'
const BUCKET = 'leads'
const POT = 'podatki/izvajalci.json'
const TTL_MS = 24 * 60 * 60 * 1000 // dnevna osvežitev

function respond(res, status, payload) {
  res.status(status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400')
  return res.end(JSON.stringify(payload))
}

const ura = t => (typeof t === 'string' && t.length >= 5 && t !== '00:00:00') ? t.slice(0, 5) : ''

function normaliziraj(surovi) {
  const seznam = surovi?.servisi?.list?.['si.zav_triglav.etriglav.vpogledi.servisi.Servis'] || []
  return seznam.map(s => ({
    ime: s.name || '',
    vrsta: (s.vrsta_servisa_opis || '').trim(),
    naslov: [s.adr_street, s.adr_house_nr, s.adr_hn_appendix].filter(Boolean).join(' ').trim(),
    kraj: s.adr_place || '',
    posta: [s.adr_post_code, s.adr_post_name].filter(Boolean).join(' '),
    obcina: s.adr_community || '',
    telefon: s.telefon || '',
    email: s.email || '',
    kontakt: s.kontakt || '',
    znamka: s.zastopstvo || '',
    oprema: s.opremljenost || '',
    kritja: (s.skplus_labele || '').split(',').map(x => x.trim()).filter(Boolean),
    pooblascen: s.pooblasceni_servis === 'DA',
    delovnik: ura(s.delovnikod) && ura(s.delovnikdo) ? `${ura(s.delovnikod)}–${ura(s.delovnikdo)}` : '',
    sobota: ura(s.soboteod) && ura(s.sobotedo) ? `${ura(s.soboteod)}–${ura(s.sobotedo)}` : '',
  })).filter(x => x.ime)
}

async function svezeIzTriglava() {
  const r = await fetch(VIR, { headers: { 'User-Agent': 'Mozilla/5.0 (zav-skornsek.si; odobreno)' } })
  if (!r.ok) throw new Error('vir ' + r.status)
  const izvajalci = normaliziraj(await r.json())
  if (izvajalci.length < 50) throw new Error('sumljivo malo zapisov: ' + izvajalci.length)
  return { osvezeno: new Date().toISOString(), vir: 'Zavarovalnica Triglav, d.d.', izvajalci }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return respond(res, 405, { error: 'Samo GET.' })
  }
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabase = supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null

  try {
    // 1) poskusi predpomnilnik
    if (supabase) {
      try {
        const { data } = await supabase.storage.from(BUCKET).download(POT)
        if (data) {
          const cached = JSON.parse(await data.text())
          if (cached.osvezeno && Date.now() - Date.parse(cached.osvezeno) < TTL_MS) {
            return respond(res, 200, cached)
          }
          // zastarel: poskusi osvežiti, ob napaki postrezi starega
          try {
            const svez = await svezeIzTriglava()
            await supabase.storage.from(BUCKET).upload(POT, Buffer.from(JSON.stringify(svez)), { contentType: 'application/json', upsert: true })
            return respond(res, 200, svez)
          } catch (e) {
            console.error('[izvajalci] osvežitev ni uspela, strežem zastarelo:', e.message)
            return respond(res, 200, cached)
          }
        }
      } catch {}
    }
    // 2) ni predpomnilnika — svež prenos
    const svez = await svezeIzTriglava()
    if (supabase) {
      try { await supabase.storage.from(BUCKET).upload(POT, Buffer.from(JSON.stringify(svez)), { contentType: 'application/json', upsert: true }) } catch {}
    }
    return respond(res, 200, svez)
  } catch (error) {
    console.error('[izvajalci] error:', error)
    return respond(res, 502, { error: 'Seznama izvajalcev trenutno ni mogoče naložiti.' })
  }
}
