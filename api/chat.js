import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini'
const ANSWER_MODEL = process.env.OPENAI_ANSWER_MODEL || 'gpt-5.4-mini'
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

  // dobesedno iskanje: ločena poizvedba za VSAK koren, da redki koreni zanesljivo pridejo zraven
  const [vector, ...stemResults] = await Promise.all([
    supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.25,
      match_count: 40,
    }),
    ...stems.map(s =>
      supabase.from('documents').select(columns).ilike('content', `%${s}%`).limit(15)
    ),
  ])

  if (vector.error) {
    console.error('[RAG] match_documents error:', vector.error)
    throw new Error(`match_documents failed: ${vector.error.message}`)
  }

  // točkovanje besednih zadetkov po številu zadetih korenov
  const byId = new Map()
  for (const res of stemResults) {
    for (const row of (res.error ? [] : res.data || [])) {
      if (row && row.id != null && !byId.has(row.id)) byId.set(row.id, row)
    }
  }
  const scored = [...byId.values()]
    .map(row => ({
      row,
      score: stems.filter(s => (row.content || '').toLowerCase().includes(s)).length,
    }))
    .sort((a, b) => b.score - a.score)

  // odlomki z VSEMI koreni (pri vsaj 2 korenih) gredo v kontekst zajamčeno
  const guaranteed = stems.length >= 2
    ? scored.filter(x => x.score === stems.length).slice(0, 6).map(x => x.row)
    : []
  const seen = new Set(guaranteed.map(row => row.id))

  console.info('[RAG] retrieval', {
    stems,
    vector_hits: Array.isArray(vector.data) ? vector.data.length : 0,
    keyword_hits: byId.size,
    guaranteed: guaranteed.length,
  })

  const candidates = []
  for (const row of [...scored.map(x => x.row), ...(vector.data || [])]) {
    if (row && row.id != null && !seen.has(row.id)) {
      seen.add(row.id)
      candidates.push(row)
    }
  }

  if (!guaranteed.length && !candidates.length) return ''

  const top = candidates.length ? await rerank(openai, question, candidates, stems) : []

  return [...guaranteed, ...top]
    .map(formatDocument)
    .filter(Boolean)
    .join('\n\n---\n\n')
}

async function rerank(openai, question, candidates, stems = []) {
  if (candidates.length <= 12) return candidates

  // predogled: izsek okoli prvega zadetka korena, ne nujno začetek odlomka
  const preview = content => {
    const text = (content || '').replace(/\s+/g, ' ')
    const lower = text.toLowerCase()
    let hit = -1
    for (const s of stems) {
      const i = lower.indexOf(s)
      if (i >= 0 && (hit < 0 || i < hit)) hit = i
    }
    if (hit > 250) {
      const header = text.slice(0, text.indexOf(']') + 1)
      return `${header} … ${text.slice(hit - 150, hit + 550)}`
    }
    return text.slice(0, 700)
  }

  try {
    const listing = candidates
      .map((d, i) => `[${i}] ${preview(d.content)}`)
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
- Odlomki z oznako "Zakonodaja" (Obligacijski zakonik, ZZavar-1) so splošna zakonska pravila — uporabi jih pri vprašanjih o pravicah stranke, rokih, zastaranju, zamudi premije, odstopu od pogodbe ipd. Pri razlagi konkretnih kritij imajo prednost zavarovalni pogoji; zakon navedi kot pravno podlago (npr. "po 937. členu OZ").
- Na koncu odgovora dodaj razdelek "Viri" z naslovi dokumentov, iz katerih si črpal.

KONTEKST:

${context}`
      : ragError
        ? 'Dostop do baze znanja ni uspel. Podaj le varen splošen odgovor in jasno povej, da je za natančen odgovor potreben pregled police.'
        : 'V bazi znanja ni bilo najdenih ustreznih dokumentov. Podaj le varen splošen odgovor in uporabnika usmeri k Zavarovanju Skornšek.'

    const systemPrompt = `Si izkušen zavarovalni strokovnjak agencije Zavarovanje Skornšek, specializiran za zavarovalne pogoje Zavarovalnice Triglav. ${languageInstruction}

Slog odgovora:
- Stranko VEDNO vikaj, tudi če ona tika.
- V prvem ali drugem stavku NEPOSREDNO odgovori na vprašanje (da/ne/koliko/pod kakšnimi pogoji), šele nato razčleni podrobnosti.
- Uporabljaj pravilno zavarovalniško terminologijo (zavarovalna vsota, soudeležba, franšiza, izključitve, zavarovalnina, jamstvo), a vsak strokovni izraz sproti poljudno pojasni, da ga razume vsakdo.
- Daljše odgovore strukturiraj z razdelki: kaj je krito → izključitve in omejitve → praktično opozorilo → Viri. Kratka vprašanja zaslužijo kratek odgovor brez razdelkov.
- Vedno navedi konkretne člene, odstotke, zneske, roke in oznake iz pogojev; ključne formulacije po potrebi dobesedno citiraj.
- Opozori na pasti, ki jih laik spregleda (podzavarovanje, roki za prijavo škode, soudeležba, pogoji za uveljavljanje), kadar izhajajo iz priloženih izvlečkov.
- Nikoli ne obljubljaj izplačila; splošna razlaga ni zavezujoča razlaga konkretne police. Napotitev na svetovalca je največ en stavek na koncu, in samo kadar je res potrebna.

${contextInstruction}`

    const response = await openai.responses.create({
      model: ANSWER_MODEL,
      input: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ],
      // gpt-5 modeli del proračuna porabijo za razmislek, zato višja meja
      max_output_tokens: 2500,
      ...(ANSWER_MODEL.startsWith('gpt-5') && !ANSWER_MODEL.includes('chat')
        ? { reasoning: { effort: 'low' } }
        : {}),
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