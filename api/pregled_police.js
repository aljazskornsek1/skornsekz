import Busboy from 'busboy'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: false } }

const BUCKET = 'police'
const TABLE = 'pregled_polic'
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = new Map([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
])

function respond(res, status, payload) {
  res.status(status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.end(JSON.stringify(payload))
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

async function sendReviewNotification({ supabase, filePath, name, email, phone, insuranceType, message }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('Policy review email not sent: RESEND_API_KEY is missing')
    return
  }

  try {
    const storedPath = `${BUCKET}/${filePath}`
    const { data: signedFile, error: signedUrlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(filePath, 7 * 24 * 60 * 60)
    if (signedUrlError) console.error('Policy review signed URL error:', signedUrlError)

    const submittedAt = new Intl.DateTimeFormat('sl-SI', {
      dateStyle: 'full',
      timeStyle: 'medium',
      timeZone: 'Europe/Ljubljana',
    }).format(new Date())
    const fileReference = signedFile?.signedUrl || storedPath
    const safeMessage = message || 'Ni dodatnega sporočila.'
    const fileHtml = signedFile?.signedUrl
      ? `<a href="${escapeHtml(signedFile.signedUrl)}" style="color:#173f7a">Odpri naloženo polico</a><br><small>${escapeHtml(storedPath)}</small>`
      : escapeHtml(storedPath)

    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Zavarovanje Skornšek <onboarding@resend.dev>',
      to: ['aljaz.skornsek1@gmail.com'],
      replyTo: email,
      subject: 'Nova polica za pregled',
      text: [
        'Nova polica za pregled',
        `Ime: ${name}`,
        `Email: ${email}`,
        `Telefon: ${phone}`,
        `Tip zavarovanja: ${insuranceType}`,
        `Sporočilo: ${safeMessage}`,
        `Datoteka: ${fileReference}`,
        `Pot v Storage: ${storedPath}`,
        `Datum in čas oddaje: ${submittedAt}`,
      ].join('\n'),
      html: `<div style="font-family:Arial,sans-serif;color:#102238;line-height:1.6;max-width:640px"><h1 style="font-size:26px">Nova polica za pregled</h1><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 0;color:#61707a">Ime</td><td style="padding:8px 0"><strong>${escapeHtml(name)}</strong></td></tr><tr><td style="padding:8px 0;color:#61707a">Email</td><td style="padding:8px 0">${escapeHtml(email)}</td></tr><tr><td style="padding:8px 0;color:#61707a">Telefon</td><td style="padding:8px 0">${escapeHtml(phone)}</td></tr><tr><td style="padding:8px 0;color:#61707a">Tip zavarovanja</td><td style="padding:8px 0">${escapeHtml(insuranceType)}</td></tr><tr><td style="padding:8px 0;color:#61707a">Sporočilo</td><td style="padding:8px 0">${escapeHtml(safeMessage)}</td></tr><tr><td style="padding:8px 0;color:#61707a">Datoteka</td><td style="padding:8px 0">${fileHtml}</td></tr><tr><td style="padding:8px 0;color:#61707a">Datum in čas</td><td style="padding:8px 0">${escapeHtml(submittedAt)}</td></tr></table></div>`,
    }, {
      idempotencyKey: `policy-review/${filePath}`,
    })
    if (error) console.error('Policy review email error:', error)
  } catch (error) {
    console.error('Policy review email error:', error)
  }
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    let parser
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fields: 12, fileSize: MAX_FILE_SIZE },
      })
    } catch {
      reject(new Error('Zahteva mora uporabljati multipart/form-data.'))
      return
    }

    const fields = {}
    let uploadedFile = null
    let fileTooLarge = false
    let settled = false

    parser.on('field', (name, value) => {
      fields[name] = value
    })
    parser.on('file', (_name, stream, info) => {
      const chunks = []
      stream.on('data', chunk => chunks.push(chunk))
      stream.on('limit', () => { fileTooLarge = true })
      stream.on('end', () => {
        if (!fileTooLarge) {
          uploadedFile = {
            buffer: Buffer.concat(chunks),
            filename: info.filename,
            mimeType: info.mimeType,
          }
        }
      })
    })
    parser.on('filesLimit', () => reject(new Error('Dovoljena je samo ena datoteka.')))
    parser.on('error', reject)
    parser.on('finish', () => {
      if (settled) return
      settled = true
      if (fileTooLarge) reject(new Error('Datoteka je večja od 10 MB.'))
      else resolve({ fields, file: uploadedFile })
    })
    req.pipe(parser)
  })
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return respond(res, 200, {
      success: true,
      route: '/api/pregled_police',
      accepts: 'multipart/form-data',
    })
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return respond(res, 405, { success: false, error: 'Dovoljena je samo metoda POST.' })
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return respond(res, 503, { success: false, error: 'Storitev trenutno ni pravilno nastavljena.' })
  }

  try {
    const { fields, file } = await parseMultipart(req)
    const name = cleanText(fields.name, 160)
    const email = cleanText(fields.email, 254).toLowerCase()
    const phone = cleanText(fields.phone, 80)
    const insuranceType = cleanText(fields.insurance_type, 120)
    const message = cleanText(fields.message, 4000)

    if (!name || !phone || !insuranceType || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return respond(res, 400, { success: false, error: 'Prosimo, izpolnite vsa obvezna polja.' })
    }
    const extension = file && ALLOWED_TYPES.get(file.mimeType)
    if (!file || !extension || !file.buffer.length) {
      return respond(res, 400, { success: false, error: 'Dodajte veljavno datoteko PDF, JPG ali PNG.' })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const month = new Date().toISOString().slice(0, 7)
    const filePath = `${month}/${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(filePath, file.buffer, {
      contentType: file.mimeType,
      cacheControl: '3600',
      upsert: false,
    })
    if (uploadError) throw uploadError

    const { error: insertError } = await supabase.from(TABLE).insert({
      name,
      email,
      phone,
      insurance_type: insuranceType,
      message: message || null,
      file_url: `${BUCKET}/${filePath}`,
      status: 'new',
    })
    if (insertError) {
      await supabase.storage.from(BUCKET).remove([filePath])
      throw insertError
    }

    await sendReviewNotification({
      supabase,
      filePath,
      name,
      email,
      phone,
      insuranceType,
      message,
    })

    return respond(res, 200, { success: true })
  } catch (error) {
    console.error('Pregled police API error:', error)
    const message = error instanceof Error && error.message
      ? error.message
      : 'Oddaje trenutno ni bilo mogoče dokončati.'
    return respond(res, 500, { success: false, error: message })
  }
}
