import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { zgradiPdf } from './_pdf/porocilo.js'

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

// e-mail s celotnim poročilom analize potreb za STRANKO (sl/en/de)
const L = {
  sl: {
    subject: 'Vaša analiza zavarovalnih potreb — Zavarovanje Skornšek',
    hello: n => `Pozdravljeni, ${n}!`,
    intro: 'Hvala za zaupanje. Spodaj je vaše osebno poročilo analize zavarovalnih potreb. V enem delovnem dnevu vas kontaktiramo za brezplačen posvet.',
    score: 'Ocena zaščitenosti',
    risks: 'Prepoznana tveganja', gaps: 'Na kaj bodite pozorni pri obstoječih kritjih',
    recs: 'Priporočeni koraki', qs: 'Vprašanja za vaš posvet', sol: 'Rešitev',
    contact: 'Vaša svetovalca', disclaimer: 'Analiza je informativne narave in ne predstavlja zavarovalnega svetovanja ali ponudbe. Za točen obseg kritij veljajo pogoji posameznega zavarovanja.',
    potencial: 'po ureditvi prioritet', vir: 'Vir',
    openBtn: 'Odprite svoje poročilo', pdfNote: 'Celotno poročilo je priloženo tudi kot PDF dokument, spletna različica pa je vedno na voljo na zgornji povezavi.',
  },
  en: {
    subject: 'Your insurance needs analysis — Zavarovanje Skornšek',
    hello: n => `Hello, ${n}!`,
    intro: 'Thank you for your trust. Below is your personal insurance needs report. We will contact you within one business day for a free consultation.',
    score: 'Protection score',
    risks: 'Identified risks', gaps: 'What to watch in your existing coverage',
    recs: 'Recommended steps', qs: 'Questions for your consultation', sol: 'Solution',
    contact: 'Your advisors', disclaimer: 'This analysis is informative in nature and does not constitute insurance advice or an offer. The terms of each individual policy apply.',
    potencial: 'after addressing priorities', vir: 'Source',
    openBtn: 'Open your report', pdfNote: 'The full report is also attached as a PDF document; the web version is always available at the link above.',
  },
  de: {
    subject: 'Ihre Analyse des Versicherungsbedarfs — Zavarovanje Skornšek',
    hello: n => `Guten Tag, ${n}!`,
    intro: 'Vielen Dank für Ihr Vertrauen. Unten finden Sie Ihren persönlichen Bericht zur Versicherungsbedarfsanalyse. Wir melden uns innerhalb eines Werktags für eine kostenlose Beratung.',
    score: 'Schutz-Bewertung',
    risks: 'Erkannte Risiken', gaps: 'Worauf Sie bei bestehendem Schutz achten sollten',
    recs: 'Empfohlene Schritte', qs: 'Fragen für Ihre Beratung', sol: 'Lösung',
    contact: 'Ihre Berater', disclaimer: 'Diese Analyse ist informativer Natur und stellt keine Versicherungsberatung oder ein Angebot dar. Es gelten die Bedingungen der jeweiligen Versicherung.',
    potencial: 'nach Regelung der Prioritäten', vir: 'Quelle',
    openBtn: 'Ihren Bericht öffnen', pdfNote: 'Der vollständige Bericht ist auch als PDF-Dokument beigefügt; die Web-Version ist jederzeit über den obigen Link verfügbar.',
  },
}
const BASE_URL = 'https://www.zav-skornsek.si'

function scoreColor(s) { return s >= 70 ? '#2e7d4f' : s >= 40 ? '#B08D57' : '#b3402a' }

function reportEmailHtml({ ime, porocilo, language, reportUrl }) {
  const l = L[language] || L.sl
  const e = escapeHtml
  const p = porocilo
  const sec = t => `<h2 style="font-family:Georgia,serif;font-weight:400;font-size:22px;color:#0A1428;margin:34px 0 12px">${e(t)}</h2>`
  let h = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.65;max-width:640px;margin:auto">
    <div style="background:#0A1428;padding:26px 28px">
      <div style="color:#B08D57;font-size:11px;letter-spacing:3px;font-weight:700">ZAVAROVANJE SKORNŠEK</div>
      <div style="font-family:Georgia,serif;color:#ffffff;font-size:26px;margin-top:8px">${e(l.subject.split('—')[0].trim())}</div>
    </div>
    <div style="padding:26px 28px;background:#ffffff;border:1px solid #e8e2d5;border-top:0">
    <p style="font-size:16px"><strong>${e(l.hello(ime))}</strong></p>
    <p style="font-size:14px;color:#4b5563">${e(l.intro)}</p>
    ${reportUrl ? `<div style="margin:22px 0"><a href="${e(reportUrl)}" style="display:inline-block;background:#0A1428;color:#dec89e;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;padding:14px 28px">${e(l.openBtn)} →</a>
    <div style="font-size:11.5px;color:#9ca3af;margin-top:10px">${e(l.pdfNote)}</div></div>` : ''}`
  const o = p.ocena_zascitenosti
  if (o && typeof o.skupaj === 'number') {
    h += `<div style="border:1px solid #e8e2d5;background:#faf8f3;padding:20px 22px;margin:20px 0">
      <div style="font-size:11px;letter-spacing:2px;color:#8a6c3c;font-weight:700;text-transform:uppercase">${e(l.score)}</div>
      <div style="font-family:Georgia,serif;font-size:44px;color:${scoreColor(o.skupaj)};margin:4px 0 10px">${o.skupaj | 0}<span style="font-size:20px;color:#9ca3af"> / 100</span>${typeof o.potencial === 'number' && o.potencial > o.skupaj ? `<span style="font-size:15px;color:#2e7d4f;font-family:Arial,sans-serif">&nbsp;&nbsp;→ ${o.potencial | 0} ${e(l.potencial)}</span>` : ''}</div>`
    for (const a of o.podrocja || []) {
      h += `<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;font-size:13px;color:#374151"><span>${e(a.naziv)}</span><strong style="color:${scoreColor(a.ocena)}">&nbsp;${a.ocena | 0}</strong></div>
        <div style="height:5px;background:#ece7db;margin-top:4px"><div style="height:5px;width:${Math.max(2, Math.min(100, a.ocena | 0))}%;background:${scoreColor(a.ocena)}"></div></div></div>`
    }
    h += `</div>`
  }
  if (p.povzetek) h += `<p style="font-size:14px;color:#374151">${e(p.povzetek)}</p>`
  if (Array.isArray(p.tveganja) && p.tveganja.length) {
    h += sec(l.risks)
    for (const t of p.tveganja) {
      h += `<div style="border:1px solid #e8e2d5;padding:14px 16px;margin-bottom:10px">
        <div style="font-size:15px;color:#0A1428"><strong>${e(t.naslov)}</strong> <span style="font-size:10px;letter-spacing:1px;text-transform:uppercase;background:#f1ece1;color:#8a6c3c;padding:2px 8px">${e(t.stopnja || '')}</span></div>
        <div style="font-size:13px;color:#4b5563;margin-top:6px">${e(t.zakaj)}</div>
        <div style="font-size:13px;color:#0A1428;margin-top:6px"><strong>${e(l.sol)}:</strong> ${e(t.resitev)}</div>${t.vir ? `<div style="font-size:11px;color:#9ca3af;margin-top:5px;font-style:italic">${e(l.vir)}: ${e(t.vir)}</div>` : ''}</div>`
    }
  }
  if (Array.isArray(p.luknje) && p.luknje.length) {
    h += sec(l.gaps) + '<ul style="padding-left:18px;font-size:13.5px;color:#374151">' + p.luknje.map(x => `<li style="margin:6px 0">${e(x)}</li>`).join('') + '</ul>'
  }
  if (Array.isArray(p.priporocila) && p.priporocila.length) {
    h += sec(l.recs)
    for (const r of p.priporocila) {
      const url = typeof r.url === 'string' && r.url.startsWith('/') ? BASE_URL + r.url : BASE_URL
      h += `<div style="border:1px solid #e8e2d5;padding:13px 16px;margin-bottom:8px">
        <a href="${e(url)}" style="color:#0A1428;font-size:14.5px;font-weight:bold;text-decoration:none">${e(r.produkt)} →</a>
        <div style="font-size:13px;color:#4b5563;margin-top:4px">${e(r.razlog)}</div></div>`
    }
  }
  if (Array.isArray(p.vprasanja_za_posvet) && p.vprasanja_za_posvet.length) {
    h += sec(l.qs) + '<ul style="padding-left:18px;font-size:13.5px;color:#374151">' + p.vprasanja_za_posvet.map(x => `<li style="margin:6px 0">${e(x)}</li>`).join('') + '</ul>'
  }
  h += `<div style="background:#0A1428;padding:20px 22px;margin-top:28px">
      <div style="color:#B08D57;font-size:11px;letter-spacing:2px;font-weight:700;text-transform:uppercase">${e(l.contact)}</div>
      <div style="color:#ffffff;font-size:14px;margin-top:8px">Igor Skornšek · <a href="tel:+38641661362" style="color:#dec89e;text-decoration:none">041 661 362</a><br>
      Aljaž Skornšek · <a href="tel:+38631544416" style="color:#dec89e;text-decoration:none">031 544 416</a><br>
      <a href="${BASE_URL}" style="color:#dec89e;text-decoration:none">www.zav-skornsek.si</a></div>
    </div>
    <p style="font-size:11px;color:#9ca3af;margin-top:16px">${e(l.disclaimer)}</p>
    </div></div>`
  return h
}

async function sendClientReportEmail({ ime, email, porocilo, language, reportUrl, pdfBuffer }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey || !porocilo) return false
  try {
    const l = L[language] || L.sl
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Zavarovanje Skornšek <onboarding@resend.dev>',
      to: [email],
      replyTo: 'aljaz.skornsek1@gmail.com',
      subject: l.subject,
      html: reportEmailHtml({ ime, porocilo, language, reportUrl }),
      ...(pdfBuffer ? { attachments: [{ filename: 'Analiza-zavarovalnih-potreb.pdf', content: pdfBuffer.toString('base64') }] } : {}),
    })
    if (error) { console.error('[lead] client email error:', error); return false }
    return true
  } catch (error) {
    console.error('[lead] client email error:', error)
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
    const language = ['sl', 'en', 'de'].includes(body.language) ? body.language : 'sl'
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

    // stranki pošljemo lepo oblikovano poročilo (samo analiza potreb)
    let clientEmailSent = false
    let reportUrl = null
    if (tip === 'analiza-potreb' && payload.porocilo && typeof payload.porocilo === 'object') {
      // trajno poročilo z žetonsko povezavo
      try {
        const token = crypto.randomUUID().replace(/-/g, '')
        const { error: repErr } = await supabase.storage.from(BUCKET).upload(
          `porocila/${token}.json`,
          Buffer.from(JSON.stringify({ ime, language, ustvarjeno: new Date().toISOString(), porocilo: payload.porocilo }), 'utf-8'),
          { contentType: 'application/json', upsert: false },
        )
        if (!repErr) reportUrl = `https://www.zav-skornsek.si/zasebniki.html#porocilo-${token}`
        else console.error('[lead] report save:', repErr.message)
      } catch (e) { console.error('[lead] report save:', e) }

      let pdfBuffer = null
      try {
        pdfBuffer = await zgradiPdf({ porocilo: payload.porocilo, ime, language, reportUrl: reportUrl || '' })
      } catch (e) { console.error('[lead] pdf:', e) }

      clientEmailSent = await sendClientReportEmail({ ime, email, porocilo: payload.porocilo, language, reportUrl, pdfBuffer })
    }

    return respond(res, 200, { success: true, emailSent, clientEmailSent, reportUrl })
  } catch (error) {
    console.error('[lead] error:', error)
    return respond(res, 500, { success: false, error: 'Oddaje trenutno ni bilo mogoče dokončati.' })
  }
}
