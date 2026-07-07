import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini'
const ANSWER_MODEL = process.env.OPENAI_ANSWER_MODEL || 'gpt-5.4-mini'
const ANSWER_MODEL_STRONG = process.env.OPENAI_ANSWER_MODEL_STRONG || 'gpt-5.4'
const EMBEDDING_MODEL = 'text-embedding-3-small'

function respond(res, status, payload) {
  res.status(status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.end(JSON.stringify(payload))
}

// omejitev klicev na IP (v pomnilniku instance; priponke štejejo 5x)
const RATE = { windowMs: 60 * 60 * 1000, ipBudget: 40, globalBudget: 800 }
const rateBuckets = new Map()
let globalBucket = { used: 0, resetAt: Date.now() + RATE.windowMs }

function rateLimited(ip, cost) {
  const now = Date.now()
  if (now > globalBucket.resetAt) globalBucket = { used: 0, resetAt: now + RATE.windowMs }
  if (rateBuckets.size > 5000) rateBuckets.clear()
  let bucket = rateBuckets.get(ip)
  if (!bucket || now > bucket.resetAt) {
    bucket = { used: 0, resetAt: now + RATE.windowMs }
    rateBuckets.set(ip, bucket)
  }
  if (bucket.used + cost > RATE.ipBudget || globalBucket.used + cost > RATE.globalBudget) return true
  bucket.used += cost
  globalBucket.used += cost
  return false
}

function rateLimitAnswer(language = 'sl') {
  if (language === 'en') return 'You have reached the hourly limit of questions. Please try again in a while or contact a Zavarovanje Skornšek adviser directly.'
  if (language === 'de') return 'Sie haben das stündliche Fragenlimit erreicht. Bitte versuchen Sie es später erneut oder wenden Sie sich direkt an einen Berater von Zavarovanje Skornšek.'
  return 'Dosegli ste urno omejitev vprašanj. Poskusite znova čez nekaj časa ali pa se obrnite neposredno na svetovalca Zavarovanje Skornšek.'
}

function parseAttachment(raw) {
  if (!raw || typeof raw !== 'object') return { fileInput: null, error: false }
  const data = typeof raw.data === 'string' ? raw.data.replace(/[^A-Za-z0-9+/=]/g, '') : ''
  const mime = raw.mime === 'application/pdf'
    ? 'application/pdf'
    : typeof raw.mime === 'string' && /^image\/(jpeg|png|webp|gif)$/.test(raw.mime) ? raw.mime : null
  const maxChars = mime === 'application/pdf' ? 4200000 : 2600000
  if (!data || !mime || data.length > maxChars) return { fileInput: null, error: true }
  const fileInput = mime === 'application/pdf'
    ? {
        type: 'input_file',
        filename: (typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'dokument.pdf').slice(0, 80),
        file_data: `data:application/pdf;base64,${data}`,
      }
    : { type: 'input_image', image_url: `data:${mime};base64,${data}` }
  return { fileInput, error: false }
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

// okrajšaj korene na 4 znake (ujame vse sklone) in izloči generične zavarovalniške
function sanitizeStems(rawList) {
  const genericStems = new Set(['zava', 'poli', 'pogo', 'prem', 'vsot', 'izpl', 'krit'])
  return [...new Set(
    (Array.isArray(rawList) ? rawList : [])
      .filter(s => typeof s === 'string')
      .map(s => s.toLowerCase().replace(/[^a-z0-9čšžđć]/g, '').slice(0, 4))
  )]
    .filter(s => s.length >= 3 && !genericStems.has(s))
    .slice(0, 4)
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
{"poizvedba": "...", "koreni": ["...", "..."], "zahtevnost": "preprosto" ali "zahtevno"}

- "poizvedba": samostojna iskalna poizvedba z vsem kontekstom iz pogovora IN sopomenkami/strokovnimi izrazi, ki se verjetno pojavljajo v uradnih pogojih (npr. "slepič" -> "slepo črevo", "odbitna franšiza" -> "soudeležba").
- "koreni": 2-4 kratki KORENI (4-6 znakov, brez končnic) samo za PREDMET vprašanja — telesni del, predmet, nevarnost, oznako (npr. za slepič: ["slep", "črev"]; za točo: ["toč"]; za kombinacijo B: ["kombinac"]). NIKOLI splošnih zavarovalniških besed (zavarovanje, polica, kritje, odstotek, vsota, izplačilo, premija).
- "zahtevnost": "zahtevno" pri primerjavah več zavarovanj, večdelnih vprašanjih, izračunih, pravnih vprašanjih ali sporih; sicer "preprosto".`,
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
    const stems = sanitizeStems(parsed.koreni)

    return { query, stems, complex: parsed.zahtevnost === 'zahtevno' }
  } catch (error) {
    console.error('[RAG] query rewrite failed:', error)
    return { query: message, stems: [], complex: false }
  }
}

async function retrieveContext(openai, question, stems = [], { light = false } = {}) {
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
      match_threshold: light ? 0.3 : 0.25,
      match_count: light ? 16 : 40,
    }),
    ...stems.map(s =>
      supabase.from('documents').select(columns).ilike('content', `%${s}%`).limit(light ? 8 : 15)
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

  // lahki način (dodatna iskanja iz agentne zanke): brez LLM prefiltriranja in sosedov
  if (light) {
    return [...guaranteed, ...candidates.slice(0, 10)]
      .slice(0, 12)
      .map(formatDocument)
      .filter(Boolean)
      .join('\n\n---\n\n')
  }

  const top = candidates.length ? await rerank(openai, question, candidates, stems) : []
  const chosen = [...guaranteed, ...top]

  // sosednji odlomki: za prvih 5 zadetkov dodaj še odlomek pred in za njim,
  // da se člen ali tabela ne odreže na polovici
  let neighbors = []
  try {
    const anchors = chosen.slice(0, 5).filter(row => row.title && Number.isFinite(row.chunk_index))
    if (anchors.length) {
      const orParts = []
      for (const anchor of anchors) {
        const title = `"${String(anchor.title).replace(/"/g, '')}"`
        orParts.push(`and(title.eq.${title},chunk_index.eq.${anchor.chunk_index - 1})`)
        orParts.push(`and(title.eq.${title},chunk_index.eq.${anchor.chunk_index + 1})`)
      }
      const res = await supabase.from('documents').select(columns).or(orParts.join(',')).limit(12)
      const chosenIds = new Set(chosen.map(row => row.id))
      neighbors = (res.error ? [] : res.data || []).filter(row => row && row.id != null && !chosenIds.has(row.id))
      console.info('[RAG] neighbors', { anchors: anchors.length, added: neighbors.length })
    }
  } catch (error) {
    console.error('[RAG] neighbor fetch failed:', error)
  }

  return [...chosen, ...neighbors]
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

  let message = typeof body.message === 'string' ? body.message.trim().slice(0, 5000) : ''
  const language = ['sl', 'en', 'de'].includes(body.language) ? body.language : 'sl'

  const { fileInput, error: attachmentError } = parseAttachment(body.attachment)
  if (attachmentError) {
    return respond(res, 400, { answer: language === 'en'
      ? 'The attached file could not be processed. Supported: images and PDF up to 3 MB.'
      : language === 'de'
        ? 'Die angehängte Datei konnte nicht verarbeitet werden. Unterstützt: Bilder und PDF bis 3 MB.'
        : 'Priložene datoteke ni bilo mogoče obdelati. Podprte so slike in PDF do 3 MB.' })
  }

  if (!message && fileInput) message = 'Preglej priloženo datoteko in povzemi ključne podatke, pomembne za zavarovanje.'
  if (!message) {
    return respond(res, 400, { answer: fallbackAnswer(language) })
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'neznan'
  if (rateLimited(ip, fileInput ? 5 : 1)) {
    return respond(res, 429, { answer: rateLimitAnswer(language) })
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
  let complexQuestion = false

  try {
    const { query: searchQuery, stems, complex } = await buildSearchQuery(openai, message, history)
    complexQuestion = complex
    console.info('[RAG] search query:', searchQuery, { complex })
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
- Odgovori KONKRETNO in TOČNO po pogojih, a izberi samo tisto, kar je za vprašanje bistveno — točnost izbranega je pomembnejša od popolnosti naštevanja.
- Dobesedno citiraj določbo samo, kadar je formulacija odločilna ali dvoumna.
- Če izvlečki na vprašanje odgovarjajo samo delno, najprej povzemi, kaj pogoji GLEDE TEGA določajo (npr. katere stvari/objekti so zavarovani, katere nevarnosti so krite), in šele nato povej, česa v izvlečkih ni izrecno omenjeno. Nikoli ne odgovori samo z napotitvijo na svetovalca.
- Napotitev na osebnega svetovalca dodaj kvečjemu v enem kratkem stavku na koncu, in samo kadar je odgovor res odvisen od konkretne police.
- Ne izmišljuj si določb, ki jih ni v izvlečkih.
- KLJUČNO za pravilnost: pri določbah s strukturo "zavarovanje krije ..., razen zaradi: 1) ..., 2) ..." je vse, kar sledi besedi "razen", IZKLJUČENO iz kritja — ne krito. Preden našteješ kritja in izključitve, preveri, na katero stran določbe ("krije" ali "razen"/"ne krije") spada vsaka postavka. Če pomen ni nedvoumen, določbo raje dobesedno citiraj, kot da jo napačno povzameš.
- Odlomki z oznako "ARHIVSKI POGOJI" veljajo za starejše, že sklenjene police — pri vprašanjih o novih sklenitvah se opri na neoznačene (aktualne) pogoje, arhivske pa omeni samo, če stranka sprašuje o obstoječi stari polici.
- Odlomki z oznako "Zakonodaja" (Obligacijski zakonik, ZZavar-1) so splošna zakonska pravila — uporabi jih pri vprašanjih o pravicah stranke, rokih, zastaranju, zamudi premije, odstopu od pogodbe ipd. Pri razlagi konkretnih kritij imajo prednost zavarovalni pogoji; zakon navedi kot pravno podlago (npr. "po 937. členu OZ").
- Če priloženi izvlečki ne zadoščajo za popoln odgovor (manjka člen, tabela, odstotek ali drugi del vprašanja), NAJPREJ uporabi orodje isci_pogoje z drugače ubesedeno poizvedbo — šele če tudi to ne najde, povej, da informacije v pogojih ni.
- Odlomki z oznako "VPRAŠALNIK" so obrazci s podatki, ki jih agencija potrebuje za pripravo ponudbe — uporabi jih, ko stranka sprašuje, kaj potrebuje za ponudbo ali sklenitev. NIKOLI jih ne navajaj kot vir o tem, kaj zavarovanje krije (vprašalnik našteva vprašanja, ne kritij).
- Na koncu odgovora v eni vrstici navedi "Vir: <naslovi dokumentov>" — brez imen datotek in brez posebnega razdelka.

KONTEKST:

${context}`
      : ragError
        ? 'Dostop do baze znanja ni uspel. Podaj le varen splošen odgovor in jasno povej, da je za natančen odgovor potreben pregled police.'
        : 'V bazi znanja ni bilo najdenih ustreznih dokumentov. Podaj le varen splošen odgovor in uporabnika usmeri k Zavarovanju Skornšek.'

    const systemPrompt = `Si izkušen zavarovalni strokovnjak agencije Zavarovanje Skornšek, specializiran za zavarovalne pogoje Zavarovalnice Triglav. ${languageInstruction}

Slog odgovora:
- Stranko VEDNO vikaj, tudi če ona tika.
- Odgovarjaj kot dober svetovalec v pogovoru, ne kot pravno mnenje: v prvem stavku neposreden odgovor (da/ne/koliko/pod kakšnimi pogoji), nato samo bistvene podrobnosti v tekočih, kratkih odstavkih.
- Dolžino prilagodi vprašanju: na preprosto vprašanje odgovori v nekaj stavkih, BREZ naslovov in alinej. Razdelke in alineje uporabi samo pri res večdelnih vprašanjih (primerjave, več produktov hkrati).
- Ne naštevaj vsega, kar veš — izberi, kar stranko dejansko zanima. Podrobnosti raje ponudi: "Če želite, razložim še izključitve / postopek prijave."
- Odločilne številke (odstotki, zneski, franšize, roki, čakalne dobe) vedno navedi točno. Številke členov pa navedi samo, kadar stranka izrecno sprašuje, kaj piše v pogojih, ali kadar so nujne za razumevanje — sicer jih izpusti.
- Strokovni izraz (soudeležba, doba jamčenja ipd.) ob prvi uporabi kratko poljudno pojasni.
- Na koncu navedi vir v ENI vrstici: "Vir: <naslov dokumenta>" (brez imen datotek, brez posebnega razdelka). Pri več dokumentih jih loči z vejico.
- Največ eno praktično opozorilo, in samo če je res pomembna past.
- Če je vprašanje dvoumno, ker ni jasno, za katero vrsto zavarovanja gre (npr. "kako prijavim škodo", "kaj je krito", "koliko stane"), NE ugibaj in ne odgovarjaj s postopkom enega naključnega produkta: v enem stavku vprašaj, za katero zavarovanje oziroma škodo gre (avto, dom, zdravje ...), in šele nato odgovori. Pri prijavi škode vedno omeni tudi, da lahko stranka vse uredi prek agencije Zavarovanje Skornšek (zavihek Škode na strani ali klic svetovalcu).
- Nikoli ne obljubljaj izplačila; splošna razlaga ni zavezujoča razlaga konkretne police. Napotitev na svetovalca je največ en stavek, samo kadar je res potrebna.

${contextInstruction}`

    const attachmentInstruction = fileInput
      ? '\n\nStranka je sporočilu priložila datoteko. Natančno jo preberi. Če je zavarovalna polica ali ponudba, razberi sklenjena kritja, zavarovalne vsote in soudeležbe ter jih poveži z ustreznimi določili iz baze znanja. Če je fotografija škode, opiši, kaj je razvidno, in pojasni, katera kritja običajno pridejo v poštev. Osebnih podatkov (EMŠO, naslov) ne izpisuj po nepotrebnem.'
      : ''

    // eskalacija: zahtevna vprašanja, priponke in dolgi pogovori gredo na močnejši model
    const answerModel = complexQuestion || fileInput || history.length >= 6 ? ANSWER_MODEL_STRONG : ANSWER_MODEL
    console.info('[RAG] answer model:', answerModel)

    const searchTool = {
      type: 'function',
      name: 'isci_pogoje',
      strict: true,
      description:
        'Dodatno iskanje po bazi znanja (zavarovalni pogoji, Obligacijski zakonik, ZZavar-1). Uporabi, kadar priloženi izvlečki ne zadoščajo za popoln in natančen odgovor — namesto da odgovoriš, da informacije ni.',
      parameters: {
        type: 'object',
        properties: {
          poizvedba: { type: 'string', description: 'Iskalna poizvedba v slovenščini, s sopomenkami in strokovnimi izrazi.' },
          koreni: {
            type: 'array',
            items: { type: 'string' },
            description: '2-4 koreni najbolj razlikovalnih besed brez končnic (npr. ["slep","črev"]), da dobesedno iskanje ujame vse sklone.',
          },
        },
        required: ['poizvedba', 'koreni'],
        additionalProperties: false,
      },
    }

    let convo = [
      { role: 'system', content: systemPrompt + attachmentInstruction },
      ...history,
      {
        role: 'user',
        content: fileInput ? [{ type: 'input_text', text: message }, fileInput] : message,
      },
    ]

    let searchesLeft = 2
    let response = null

    for (let round = 0; round < 3; round++) {
      response = await openai.responses.create({
        model: answerModel,
        input: convo,
        ...(searchesLeft > 0 ? { tools: [searchTool] } : {}),
        // gpt-5 modeli del proračuna porabijo za razmislek, zato višja meja
        max_output_tokens: 2500,
        ...(answerModel.startsWith('gpt-5') && !answerModel.includes('chat')
          ? { reasoning: { effort: 'low' } }
          : {}),
      })

      const calls = (response.output || []).filter(item => item.type === 'function_call')
      if (!calls.length) break

      convo = convo.concat(response.output)
      for (const call of calls) {
        let result = ''
        if (searchesLeft > 0) {
          searchesLeft--
          try {
            const args = JSON.parse(call.arguments || '{}')
            const extraQuery = String(args.poizvedba || '').slice(0, 300)
            console.info('[RAG] agent search:', extraQuery)
            if (extraQuery) {
              result = await retrieveContext(openai, extraQuery, sanitizeStems(args.koreni), { light: true })
            }
          } catch (error) {
            console.error('[RAG] agent search failed:', error)
          }
        }
        convo.push({ type: 'function_call_output', call_id: call.call_id, output: result || 'Ni dodatnih zadetkov.' })
      }
    }

    const answer = response?.output_text?.trim() || fallbackAnswer(language)

    const finalAnswer = context
      ? answer
      : `${ragError ? fallbackAnswer(language) : generalGuidanceNotice(language)}\n\n${answer}`

    return respond(res, 200, { answer: finalAnswer })
  } catch (error) {
    console.error('AI assistant OpenAI response failed:', error)
    return respond(res, 200, { answer: fallbackAnswer(language) })
  }
}