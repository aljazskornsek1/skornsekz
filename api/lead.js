import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'leads'
const TABLE = 'pregled_polic'
const TIPI = new Set(['analiza-potreb', 'portfelj', 'skodni-pomocnik'])

function respond(res, status, payload) {
  res.status(status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.end(JSON.stringify(payload))
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c])
}

async function ensureBucket(supabase) {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message || '')) {
    console.error('[lead] createBucket:', error.message)
  }
}

function tipNaslov(tip) {
  if (tip === 'analiza-potreb') return 'Nova analiza potreb'
  if (tip === 'portfelj') return 'Nova portfeljska analiza polic'
  return 'Nov škodni primer (pomočnik)'
}

async function sendLeadEmail({ tip, ime, email, telefon, povzetek, storagePath, signedUrl }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[lead] email not sent: RESEND_API_KEY missing')
    return false
  }
  try {
    const submittedAt = new Intl.DateTimeFormat('sl-SI', {
      dateStyle: 'full', timeStyle: 'medium', timeZone: 'Europe/Ljubljana',
    }).format(new Date())
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Zavarovanje Skornšek <onboarding@resend.dev>',
      to: ['aljaz.skornsek1@gmail.com'],
      replyTo: email || undefined,
      subject: `${tipNaslov(tip)} — ${ime}`,
      text: [
        tipNaslov(tip),
        `Ime: ${ime}`,
        `Email: ${email}`,
        `Telefon: ${telefon}`,
        '',
        'Povzetek:',
        povzetek,
        '',
        `Celotno poročilo (JSON): ${signedUrl || storagePath}`,
        `Oddano: ${submittedAt}`,
      ].join('\n'),
      html: `<div style="font-family:Arial,sans-serif;color:#102238;line-height:1.6;max-width:680px">
        <h1 style="font-size:24px">${escapeHtml(tipNaslov(tip))}</h1>
        <p><strong>${escapeHtml(ime)}</strong> · ${escapeHtml(email)} · ${escapeHtml(telefon)}</p>
        <pre style="background:#f4f4f1;padding:16px;border-radius:8px;white-space:pre-wrap;font-family:Arial,sans-serif;font-size:14px">${escapeHtml(povzetek)}</pre>
        <p>${signedUrl ? `<a href="${escapeHtml(signedUrl)}" style="color:#173f7a">Celotno poročilo (JSON, 7 dni)</a><br>` : ''}<small>${escapeHtml(storagePath)}</small></p>
        <p><small>Oddano: ${escapeHtml(submittedAt)}</small></p>
      </div>`,
    })
    if (error) { console.error('[lead] resend error:', error); return false }
    return true
  } catch (error) {
    console.error('[lead] email error:', error)
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return respond(res, 405, { success: false, error: 'Dovoljena je samo metoda POST.' })
  }
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return respond(res, 503, { success: false, error: 'Storitev trenutno ni pravilno nastavljena.' })
  }

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}')
    const tip = TIPI.has(body.tip) ? body.tip : null
    const ime = cleanText(body.ime, 160)
    const email = cleanText(body.email, 254).toLowerCase()
    const telefon = cleanText(body.telefon, 80)
    const soglasje = body.soglasje === true
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}
    const povzetek = cleanText(body.povzetek, 4000) || '(brez povzetka)'

    if (!tip) return respond(res, 400, { success: false, error: 'Neveljaven tip.' })
    if (!ime || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !telefon) {
      return respond(res, 400, { success: false, error: 'Izpolnite ime, e-pošto in telefon.' })
    }
    if (!soglasje) return respond(res, 400, { success: false, error: 'Potrebno je soglasje za obdelavo podatkov.' })

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await ensureBucket(supabase)

    const record = {
      tip, ime, email, telefon,
      soglasje: { potrjeno: true, cas: new Date().toISOString() },
      payload,
    }
    const month = new Date().toISOString().slice(0, 7)
    const filePath = `${month}/${tip}-${crypto.randomUUID()}.json`
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(
      filePath,
      Buffer.from(JSON.stringify(record, null, 2), 'utf-8'),
      { contentType: 'application/json', upsert: false },
    )
    if (uploadError) throw uploadError

    // vrstica v obstoječi tabeli, da je lead viden v istem pregledu kot police
    const { error: insertError } = await supabase.from(TABLE).insert({
      name: ime,
      email,
      phone: telefon,
      insurance_type: `lead:${tip}`,
      message: povzetek.slice(0, 3800),
      file_url: `${BUCKET}/${filePath}`,
      status: 'new',
    })
    if (insertError) console.error('[lead] insert error (nadaljujem, JSON je shranjen):', insertError.message)

    let signedUrl = null
    try {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 7 * 24 * 60 * 60)
      signedUrl = data?.signedUrl || null
    } catch {}

    const emailSent = await sendLeadEmail({
      tip, ime, email, telefon, povzetek,
      storagePath: `${BUCKET}/${filePath}`, signedUrl,
    })

    return respond(res, 200, { success: true, emailSent })
  } catch (error) {
    console.error('[lead] error:', error)
    return respond(res, 500, { success: false, error: 'Oddaje trenutno ni bilo mogoče dokončati.' })
  }
}
