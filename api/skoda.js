import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const ANSWER_MODEL_STRONG = process.env.OPENAI_ANSWER_MODEL_STRONG || 'gpt-5.4'
const EMBEDDING_MODEL = 'text-embedding-3-small'

function respond(res, status, payload) {
  res.status(status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.end(JSON.stringify(payload))
}

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } }

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    ocena: {
      type: 'object', additionalProperties: false,
      properties: {
        verjetnost: { type: 'string', enum: ['kritje je verjetno', 'odvisno od sklenjenih kritij', 'kritje je malo verjetno'] },
        obrazlozitev: { type: 'string' },
        pozor: { type: 'array', maxItems: 5, items: { type: 'string' } },
      },
      required: ['verjetnost', 'obrazlozitev', 'pozor'],
    },
    dokumentacija: { type: 'array', minItems: 3, maxItems: 10, items: { type: 'string' } },
    koraki: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'string' } },
    rok_opozorilo: { type: 'string' },
  },
  required: ['ocena', 'dokumentacija', 'koraki', 'rok_opozorilo'],
}

function fileInput(f) {
  const data = typeof f.data === 'string' ? f.data.replace(/[^A-Za-z0-9+/=]/g, '') : ''
  const mime = typeof f.mime === 'string' && /^image\/(jpeg|png|webp)$/.test(f.mime) ? f.mime
    : f.mime === 'application/pdf' ? 'application/pdf' : null
  if (!data || !mime || data.length > 4200000) return null
  return mime === 'application/pdf'
    ? { type: 'input_file', filename: (f.name || 'dokument.pdf').slice(0, 80), file_data: `data:application/pdf;base64,${data}` }
    : { type: 'input_image', image_url: `data:${mime};base64,${data}` }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return respond(res, 405, { error: 'Samo POST.' })
  }
  const openaiKey = process.env.OPENAI_API_KEY
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!openaiKey) return respond(res, 503, { error: 'Storitev ni pravilno nastavljena.' })

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}')
    const vrsta = typeof body.vrsta === 'string' ? body.vrsta.slice(0, 80) : ''
    const opis = typeof body.opis === 'string' ? body.opis.slice(0, 1500) : ''
    const files = (Array.isArray(body.files) ? body.files.slice(0, 3) : []).map(fileInput).filter(Boolean)
    const language = ['sl', 'en', 'de'].includes(body.language) ? body.language : 'sl'
    if (!vrsta || opis.length < 10) return respond(res, 400, { error: 'Izberite vrsto škode in jo na kratko opišite.' })

    const openai = new OpenAI({ apiKey: openaiKey })

    // RAG: pogoji za to vrsto skode
    let context = ''
    if (supabaseUrl && supabaseKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
        const emb = await openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: [`${vrsta} kritje izključitve prijava škode`, opis.slice(0, 300)],
          encoding_format: 'float',
        })
        const results = await Promise.all(emb.data.map(d => supabase.rpc('match_documents', {
          query_embedding: d.embedding, match_threshold: 0.28, match_count: 8,
        })))
        const seen = new Set(); const chunks = []
        for (const r of results) for (const row of (r.error ? [] : r.data || [])) {
          if (seen.has(row.id)) continue
          seen.add(row.id)
          chunks.push(`[${row.title || 'dokument'}]\n${(row.content || '').slice(0, 1100)}`)
        }
        context = chunks.slice(0, 14).join('\n\n---\n\n')
      } catch (e) { console.error('[skoda] RAG:', e.message) }
    }

    const langNote = language === 'en' ? 'Write all text fields in English.' : language === 'de' ? 'Alle Textfelder auf Deutsch.' : 'Vsa besedila v slovenščini.'
    const userContent = [{ type: 'input_text', text: `VRSTA ŠKODE: ${vrsta}\nOPIS: ${opis}\n\nIZVLEČKI IZ POGOJEV:\n${context || '(ni na voljo)'}` }, ...files]

    const response = await openai.responses.create({
      model: ANSWER_MODEL_STRONG,
      input: [
        { role: 'system', content: `Si škodni svetovalec agencije Zavarovanje Skornšek (ekskluzivni zastopnik Zavarovalnice Triglav). Na podlagi opisa škode (in morebitnih fotografij) pripravi usmeritve. ${langNote}
STROGA PRAVILA:
- NIKOLI ne obljubljaj izplačila ali potrjuj kritja — samo previdna ocena ("kritje je verjetno, ČE imate sklenjeno X kritje in ni izključitve Y").
- "verjetnost" izberi konservativno; pri dvomu "odvisno od sklenjenih kritij".
- "pozor": tipične izključitve/pogoji iz pogojev, ki lahko vplivajo (npr. malomarnost, roki, franšiza).
- "dokumentacija": konkreten seznam za TO vrsto škode (fotografije, računi, zapisnik, cenilni ogled ...).
- "koraki": po vrsti; korak 1 je vedno zavarovati kraj/preprečiti večjo škodo, kjer smiselno; med koraki navedi spletno prijavo škode Zavarovalnice Triglav in kontakt agencije (Igor Skornšek 041 661 362).
- "rok_opozorilo": opozorilo o prijavnih rokih in da naj s prijavo ne odlašajo.
- Vikanje, mirno in podporno (stranka je v stresu).` },
        { role: 'user', content: userContent },
      ],
      max_output_tokens: 2400,
      ...(ANSWER_MODEL_STRONG.startsWith('gpt-5') ? { reasoning: { effort: 'low' } } : {}),
      text: { format: { type: 'json_schema', name: 'skoda', strict: true, schema: SCHEMA } },
    })

    let rezultat
    try { rezultat = JSON.parse(response.output_text) } catch {
      return respond(res, 502, { error: 'Pomoči trenutno ni mogoče pripraviti.' })
    }
    return respond(res, 200, { rezultat })
  } catch (error) {
    console.error('[skoda] error:', error)
    return respond(res, 500, { error: 'Pomoči trenutno ni mogoče pripraviti. Poskusite znova.' })
  }
}
