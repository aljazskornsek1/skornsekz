import { createClient } from '@supabase/supabase-js'

// Uradni vir: Zavarovalnica Triglav, d.d. — objava odobrena (14. 7. 2026).
const VIR = 'https://www.triglav.si/wps/wcm/connect/triglav.si/ajax/pog-servisi-ajax?wcmitemid=50c27a3e-cd01-4b0b-a75f-7f3dcbee56a4'
const BUCKET = 'leads'
const POT = 'podatki/izvajalci_v2.json'

// D48/Gauss-Krüger (EPSG:3912) → WGS84; validirano proti pyproj (odstopanje < 1 m)
function gk2wgs(y, x) {
  const a = 6377397.155, f = 1 / 299.1528128
  const k0 = 0.9999, lon0 = 15 * Math.PI / 180, FE = 500000, FN = -5000000
  const e2 = 2 * f - f * f
  const ep2 = e2 / (1 - e2)
  const Nm = (x - FN) / k0
  const mu = Nm / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256))
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu)
  const sp = Math.sin(phi1), cp = Math.cos(phi1), tp = Math.tan(phi1)
  const C1 = ep2 * cp * cp, T1 = tp * tp
  const N1 = a / Math.sqrt(1 - e2 * sp * sp)
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sp * sp, 1.5)
  const D = (y - FE) / (N1 * k0)
  const phi = phi1 - (N1 * tp / R1) * (D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720)
  const lam = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / cp
  const sphi = Math.sin(phi), cphi = Math.cos(phi)
  const Nn = a / Math.sqrt(1 - e2 * sphi * sphi)
  const X = Nn * cphi * Math.cos(lam), Y = Nn * cphi * Math.sin(lam), Z = Nn * (1 - e2) * sphi
  const dx = 426.9, dy = 142.6, dz = 460.1
  const rx = 4.91 / 3600 * Math.PI / 180, ry = 4.49 / 3600 * Math.PI / 180, rz = -12.42 / 3600 * Math.PI / 180
  const s = 17.1e-6
  const X2 = dx + (1 + s) * (X - rz * Y + ry * Z)
  const Y2 = dy + (1 + s) * (rz * X + Y - rx * Z)
  const Z2 = dz + (1 + s) * (-ry * X + rx * Y + Z)
  const aw = 6378137, fw = 1 / 298.257223563, e2w = 2 * fw - fw * fw
  const p = Math.sqrt(X2 * X2 + Y2 * Y2)
  let phiw = Math.atan2(Z2, p * (1 - e2w))
  for (let i = 0; i < 6; i++) {
    const sw = Math.sin(phiw)
    const Nw = aw / Math.sqrt(1 - e2w * sw * sw)
    phiw = Math.atan2(Z2 + e2w * Nw * sw, p)
  }
  return [Math.round(phiw * 180 / Math.PI * 1e6) / 1e6, Math.round(Math.atan2(Y2, X2) * 180 / Math.PI * 1e6) / 1e6]
}
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
    ...(s.x_coordinate && s.y_coordinate ? (([lat, lng]) => ({ lat, lng }))(gk2wgs(s.y_coordinate, s.x_coordinate)) : {}),
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
