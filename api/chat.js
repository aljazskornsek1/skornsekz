import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini'
const EMBEDDING_MODEL = 'text-embedding-3-small'

function respond(res, status, payload) {
  res.status(status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.end(JSON.stringify(payload))
}

function fallbackAnswer(language = 'sl') {
  if (language === 'en') return 'I can provide general insurance guidance, but I cannot access the knowledge base at the moment. For an exact review of coverage and conditions, please contact a Zavarovanje Skornšek adviser.'
  if (language === 'de') return 'Ich kann allgemeine Hinweise zu Versicherungen geben, kann aber momentan nicht auf die Wissensdatenbank zugreifen. Für eine genaue Prüfung von Deckung und Bedingungen wenden Sie sich bitte an einen Berater von Zavarovanje Skornšek.'
  return 'Lahko vam podam splošne informacije o zavarovanju, vendar trenutno ne morem dostopati do baze znanja. Za natančen pregled kritij in pogojev se obrnite na svetovalca Zavarovanje Skornšek.'
}

function generalGuidanceNotice(language = 'sl') {
  if (language === 'en') return 'This answer is based on general guidance because no relevant documents were found in the knowledge base. For an exact answer, please contact Zavarovanje Skornšek.'
  if (language === 'de') return 'Diese Antwort basiert auf allgemeinen Hinweisen, da keine passenden Dokumente in der Wissensdatenbank gefunden wurden. Für eine genaue Auskunft wenden Sie sich bitte an Zavarovanje Skornšek.'
  return 'Ta odgovor temelji na splošnih informacijah, ker v bazi znanja ni bilo najdenih ustreznih dokumentov. Za natančen odgovor se obrnite na Zavarovanje Skornšek.'
}

function nonEmptyString(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() || ''
}

function formatDocument(document, index) {
  const metadata = document?.metadata && typeof document.metadata === 'object' ? document.metadata : {}
  const title = nonEmptyString(document?.title, metadata.title, metadata.name) || `Dokument ${index + 1}`
  const source = nonEmptyString(document?.source, metadata.source, metadata.url, metadata.file_name) || 'Baza znanja Zavarovanje Skornšek'
  const content = nonEmptyString(document?.content, document?.text, document?.chunk, metadata.content, metadata.text)

  if (!content) return ''

  return `Naslov: ${title}\nVir: ${source}\nVsebina:\n${content}`
}

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

async function buildSearchQuery(openai, message, history) {
  try {
    const conversation = history
      .map(item => `${item.role === 'user' ? 'Uporabnik' : 'Asistent'}: ${item.content}`)
      .join('\n')

    const response = await openai.responses.create({
      model: CHAT_MODEL,
      input: [
        {
          role: 'system',
          content: `Pripravi iskanje po slovenskih zavarovalnih pogojih za zadnje uporabnikovo sporočilo. Vrni SAMO JSON:
{"poizvedba": "...", "koreni": ["...", "..."]}

- "poizvedba": samostojna iskalna poizvedba z vsem kontekstom iz pogovora IN sopomenkami/strokovnimi izrazi, ki se verjetno pojavljajo v uradnih pogojih (npr. "slepič" -> "slepo črevo", "odbitna franšiza" -> "soudeležba").
- "koreni": 2-4 kratki KORENI (4-6 znakov, brez končnic) samo za PREDMET vprašanja — telesni del, predmet, nevarnost, oznako (npr. za slepič: ["slep", "črev"]; za točo: ["toč"]; za kombinacijo B: ["kombinac"]). NIKOLI splošnih zavarovalniških besed (zavarovanje, polica, kritje, odstotek, vsota, izplačilo, premija).`,
        },
        {
          role: 'user',
          content: (conversation ? `Pogovor:\n${conversation}\n\n` : '') + `Zadnje sporočilo: ${message}`,
        },
      ],
      max_output_tokens: 200,
    })

    const raw = response.output_text?.trim() || ''
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}')
    const query = typeof parsed.poizvedba === 'string' && parsed.poizvedba.trim() ? parsed.poizvedba.trim() : message
    // varovalka: okrajšaj na 4 znake (ujame vse sklone) in izloči generične zavarovalniške korene
    const genericStems = new Set(['zava', 'poli', 'pogo', 'prem', 'vsot', 'izpl', 'krit'])
    const stems = [...new Set(
      (Array.isArray(parsed.koreni) ? parsed.koreni : [])
        .filter(s => typeof s === 'string')
        .map(s => s.toLowerCase().replace(/[^a-z0-9čšžđć]/g, '').slice(0, 4))
    )]
      .filter(s => s.length >= 3 && !genericStems.has(s))
      .slice(0, 4)

    return { query, stems }
  } catch (error) {
    console.error('[RAG] query rewrite failed:', error)
    return { query: message, stems: [] }
  }
}

async function retrieveContext(openai, question, stems = []) {
  const supabaseUrl = getSupabaseUrl()
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing')
  }

  console.info('[RAG] Supabase config', {
    hasUrl: Boolean(supabaseUrl),
    urlLooksOk: supabaseUrl.startsWith('https://') && supabaseUrl.endsWith('.supabase.co'),
    hasServiceKey: Boolean(supabaseKey),
  })

  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: question,
    encoding_format: 'float',
  })

  const queryEmbedding = embeddingResponse.data?.[0]?.embedding

  if (!queryEmbedding) {
    throw new Error('Embedding was not returned')
  }

  console.info('[RAG] Embedding generated', {
    model: EMBEDDING_MODEL,
    dimensions: queryEmbedding.length,
  })

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const columns = 'id,title,source,chunk_index,content'
  const empty = Promise.resolve({ data: [], error: null })

  // dobesedno iskanje po korenih: AND (vsi koreni) prednostno, OR kot širša mreža
  let keywordAnd = empty
  if (stems.length) {
    let q = supabase.from('documents').select(columns)
    for (const s of stems) q = q.ilike('content', `%${s}%`)
    keywordAnd = q.limit(12)
  }
  const keywordOr = stems.length
    ? supabase
        .from('documents')
        .select(columns)
        .or(stems.map(s => `content.ilike.%${s}%`).join(','))
        .limit(12)
    : empty

  const [vector, kwAnd, kwOr] = await Promise.all([
    supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.25,
      match_count: 40,
    }),
    keywordAnd,
    keywordOr,
  ])

  console.info('[RAG] retrieval', {
    stems,
    vector_error: vector.error?.message || null,
    vector_hits: Array.isArray(vector.data) ? vector.data.length : 0,
    keyword_and_hits: Array.isArray(kwAnd.data) ? kwAnd.data.length : 0,
    keyword_or_hits: Array.isArray(kwOr.data) ? kwOr.data.length : 0,
  })

  if (vector.error) {
    console.error('[RAG] match_documents error:', vector.error)
    throw new Error(`match_documents failed: ${vector.error.message}`)
  }

  const seen = new Set()
  const candidates = []
  const keywordRows = [...(kwAnd.error ? [] : kwAnd.data || []), ...(kwOr.error ? [] : kwOr.data || [])]
  for (const row of [...keywordRows, ...(vector.data || [])]) {
    if (row && row.id != null && !seen.has(row.id)) {
      seen.add(row.id)
      candidates.push(row)
    }
  }

  if (!candidates.length) return ''

  const top = await rerank(openai, question, candidates)

  return top
    .map(formatDocument)
    .filter(Boolean)
    .join('\n\n---\n\n')
}

async function rerank(openai, question, candidates) {
  if (candidates.length <= 12) return candidates

  try {
    const listing = candidates
      .map((d, i) => `[${i}] ${(d.content || '').slice(0, 400).replace(/\s+/g, ' ')}`)
      .join('\n\n')

    const response = await openai.responses.create({
      model: CHAT_MODEL,
      input: [
        {
          role: 'system',
          content: 'Dobiš vprašanje in oštevilčene odlomke zavarovalnih pogojev. Izberi do 12 odlomkov, ki so za odgovor na vprašanje najbolj relevantni. Vrni SAMO številke, ločene z vejicami, urejene od najbolj relevantnega (npr.: 3,0,7). Brez pojasnil.',
        },
        { role: 'user', content: `Vprašanje: ${question}\n\nOdlomki:\n${listing}` },
      ],
      max_output_tokens: 100,
    })

    const indices = [...new Set(((response.output_text || '').match(/\d+/g) || []).map(Number))]
      .filter(n => n >= 0 && n < candidates.length)

    if (indices.length >= 4) return indices.slice(0, 12).map(i => candidates[i])
    console.warn('[RAG] rerank returned too few indices, using vector order')
  } catch (error) {
    console.error('[RAG] rerank failed:', error)
  }

  return candidates.slice(0, 12)
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return respond(res, 200, { success: true, route: '/api/chat' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return respond(res, 405, { answer: fallbackAnswer('sl') })
  }

  let body = {}

  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  } catch {
    return respond(res, 400, { answer: fallbackAnswer('sl') })
  }

  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 5000) : ''
  const language = ['sl', 'en', 'de'].includes(body.language) ? body.language : 'sl'

  if (!message) {
    return respond(res, 400, { answer: fallbackAnswer(language) })
  }

  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    console.error('AI assistant unavailable: OPENAI_API_KEY is missing')
    return respond(res, 200, { answer: fallbackAnswer(language) })
  }

  const openai = new OpenAI({ apiKey })

  const history = Array.isArray(body.history)
    ? body.history
        .slice(-6)
        .filter(item =>
          item &&
          ['user', 'assistant'].includes(item.role) &&
          typeof item.content === 'string'
        )
        .map(item => ({
          role: item.role,
          content: item.content.slice(0, 2000),
        }))
    : []

  let context = ''
  let ragError = false

  try {
    const { query: searchQuery, stems } = await buildSearchQuery(openai, message, history)
    console.info('[RAG] search query:', searchQuery)
    context = await retrieveContext(openai, searchQuery, stems)
  } catch (error) {
    ragError = true
    console.error('AI assistant RAG search failed:', error)
  }

  try {
    const languageInstruction =
      language === 'en'
        ? 'Answer in English.'
        : language === 'de'
          ? 'Antworte auf Deutsch.'
          : 'Odgovori v slovenščini.'

    const contextInstruction = context
  ? `Spodaj so izvlečki iz uradnih zavarovalnih pogojev (baza znanja Zavarovanje Skornšek). Odgovori na njihovi podlagi.

Pravila:
- Odgovori KONKRETNO in POPOLNO: navedi kritja, izključitve, omejitve, franšize in zneske točno tako, kot so zapisani v pogojih.
- Kadar je smiselno, citiraj ali povzemi točno določbo (člen, alinejo) in navedi, iz katerega dokumenta je.
- Če izvlečki na vprašanje odgovarjajo samo delno, najprej povzemi, kaj pogoji GLEDE TEGA določajo (npr. katere stvari/objekti so zavarovani, katere nevarnosti so krite), in šele nato povej, česa v izvlečkih ni izrecno omenjeno. Nikoli ne odgovori samo z napotitvijo na svetovalca.
- Napotitev na osebnega svetovalca dodaj kvečjemu v enem kratkem stavku na koncu, in samo kadar je odgovor res odvisen od konkretne police.
- Ne izmišljuj si določb, ki jih ni v izvlečkih.
- Odlomki z oznako "ARHIVSKI POGOJI" veljajo za starejše, že sklenjene police — pri vprašanjih o novih sklenitvah se opri na neoznačene (aktualne) pogoje, arhivske pa omeni samo, če stranka sprašuje o obstoječi stari polici.
- Na koncu odgovora dodaj razdelek "Viri" z naslovi dokumentov, iz katerih si črpal.

KONTEKST:

${context}`
      : ragError
        ? 'Dostop do baze znanja ni uspel. Podaj le varen splošen odgovor in jasno povej, da je za natančen odgovor potreben pregled police.'
        : 'V bazi znanja ni bilo najdenih ustreznih dokumentov. Podaj le varen splošen odgovor in uporabnika usmeri k Zavarovanju Skornšek.'

    const systemPrompt = `Si virtualni zavarovalni asistent podjetja Zavarovanje Skornšek. ${languageInstruction}
Tvoja naloga je, da stranki čim bolj konkretno pojasniš vsebino zavarovalnih pogojev. Odgovori strukturirano in prijazno. Splošni odgovor ni zavezujoča razlaga konkretne police, zato ne obljubljaj izplačil, vendar to ne sme biti izgovor za izogibanje vsebinskemu odgovoru.

${contextInstruction}`

    const response = await openai.responses.create({
      model: CHAT_MODEL,
      input: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ],
      max_output_tokens: 900,
    })

    const answer = response.output_text?.trim() || fallbackAnswer(language)

    const finalAnswer = context
      ? answer
      : `${ragError ? fallbackAnswer(language) : generalGuidanceNotice(language)}\n\n${answer}`

    return respond(res, 200, { answer: finalAnswer })
  } catch (error) {
    console.error('AI assistant OpenAI response failed:', error)
    return respond(res, 200, { answer: fallbackAnswer(language) })
  }
}