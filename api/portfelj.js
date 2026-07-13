import OpenAI from 'openai'

const ANSWER_MODEL_STRONG = process.env.OPENAI_ANSWER_MODEL_STRONG || 'gpt-5.4'

function respond(res, status, payload) {
  res.status(status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.end(JSON.stringify(payload))
}

export const config = { api: { bodyParser: { sizeLimit: '18mb' } } }

const POLICA_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    je_polica: { type: 'boolean' },
    zavarovalnica: { type: 'string' },
    produkt: { type: 'string' },
    zavarovanec: { type: 'string' },
    veljavnost_do: { type: 'string' },
    letna_premija: { type: 'string' },
    kritja: {
      type: 'array', maxItems: 14,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          naziv: { type: 'string' },
          vsota: { type: 'string' },
          fransiza: { type: 'string' },
        },
        required: ['naziv', 'vsota', 'fransiza'],
      },
    },
    opombe: { type: 'string' },
  },
  required: ['je_polica', 'zavarovalnica', 'produkt', 'zavarovanec', 'veljavnost_do', 'letna_premija', 'kritja', 'opombe'],
}

const ANALIZA_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    teaser: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
    podvojena_kritja: { type: 'array', maxItems: 6, items: { type: 'string' } },
    luknje: { type: 'array', maxItems: 8, items: { type: 'string' } },
    podzavarovanje: { type: 'array', maxItems: 6, items: { type: 'string' } },
    opozorila_poteki: { type: 'array', maxItems: 6, items: { type: 'string' } },
    povzetek: { type: 'string' },
  },
  required: ['teaser', 'podvojena_kritja', 'luknje', 'podzavarovanje', 'opozorila_poteki', 'povzetek'],
}

function fileInput(f) {
  const data = typeof f.data === 'string' ? f.data.replace(/[^A-Za-z0-9+/=]/g, '') : ''
  const mime = f.mime === 'application/pdf'
    ? 'application/pdf'
    : typeof f.mime === 'string' && /^image\/(jpeg|png|webp)$/.test(f.mime) ? f.mime : null
  if (!data || !mime || data.length > 4500000) return null
  return mime === 'application/pdf'
    ? { type: 'input_file', filename: (f.name || 'polica.pdf').slice(0, 80), file_data: `data:application/pdf;base64,${data}` }
    : { type: 'input_image', image_url: `data:${mime};base64,${data}` }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return respond(res, 405, { error: 'Samo POST.' })
  }
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) return respond(res, 503, { error: 'Storitev ni pravilno nastavljena.' })

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}')
    const files = Array.isArray(body.files) ? body.files.slice(0, 5) : []
    const language = ['sl', 'en', 'de'].includes(body.language) ? body.language : 'sl'
    const potrebe = typeof body.potrebe === 'string' ? body.potrebe.slice(0, 2000) : ''
    if (!files.length) return respond(res, 400, { error: 'Priložite vsaj eno polico.' })

    const inputs = files.map(fileInput)
    if (inputs.some(i => !i)) return respond(res, 400, { error: 'Neveljavna ali prevelika datoteka (PDF do 3 MB ali slika).' })

    const openai = new OpenAI({ apiKey: openaiKey })
    const langNote = language === 'en' ? 'Write all text fields in English.' : language === 'de' ? 'Alle Textfelder auf Deutsch.' : 'Vsa besedila v slovenščini.'

    // 1) ekstrakcija vsake police posebej (vzporedno)
    const extractions = await Promise.all(inputs.map((inp, idx) =>
      openai.responses.create({
        model: ANSWER_MODEL_STRONG,
        input: [
          { role: 'system', content: `Si natančen analitik zavarovalnih polic. Iz priloženega dokumenta izlušči podatke. ${langNote}
Pravila: če dokument NI zavarovalna polica (ali je neberljiv), nastavi je_polica=false in pusti ostalo prazno ('').
Datum veljavnosti zapiši kot YYYY-MM-DD, če je razviden, sicer ''. Zneskov si ne izmišljuj — če česa ni, pusti ''.` },
          { role: 'user', content: [{ type: 'input_text', text: `Dokument ${idx + 1}: izlušči podatke police.` }, inp] },
        ],
        max_output_tokens: 2200,
        ...(ANSWER_MODEL_STRONG.startsWith('gpt-5') ? { reasoning: { effort: 'low' } } : {}),
        text: { format: { type: 'json_schema', name: 'polica', strict: true, schema: POLICA_SCHEMA } },
      }).then(r => { try { return JSON.parse(r.output_text) } catch { return null } })
    ))

    const police = extractions.map((p, i) => ({ ...(p || { je_polica: false, zavarovalnica: '', produkt: '', zavarovanec: '', veljavnost_do: '', letna_premija: '', kritja: [], opombe: 'Dokumenta ni bilo mogoče prebrati.' }), datoteka: (files[i].name || `dokument-${i + 1}`).slice(0, 80) }))
    const veljavne = police.filter(p => p.je_polica)
    if (!veljavne.length) return respond(res, 422, { error: 'V priloženih datotekah nismo prepoznali nobene zavarovalne police.' })

    // 2) skupna analiza portfelja
    const analiza = await openai.responses.create({
      model: ANSWER_MODEL_STRONG,
      input: [
        { role: 'system', content: `Si zavarovalni svetovalec agencije Zavarovanje Skornšek (ekskluzivni zastopnik Zavarovalnice Triglav). Analiziraj portfelj polic stranke. ${langNote}
Pravila:
- Objektivno in dejstveno; konkurenčnih zavarovalnic ne blati, primerjaj samo kritja in vsote.
- "podvojena_kritja": kje se kritja prekrivajo med policami (npr. asistenca na dveh policah).
- "luknje": pomembna tveganja, ki jih NOBENA polica ne krije (izhajaj iz tipičnih potreb gospodinjstva).
- "podzavarovanje": kjer so vsote očitno nizke glede na namen kritja; brez izmišljenih številk.
- "opozorila_poteki": police, ki potečejo v 60 dneh, ali kjer datum ni razviden.
- "teaser": do 3 NAJPOMEMBNEJŠE ugotovitve, konkretno.
- Vsak nasvet je informativen predlog za posvet.${potrebe ? '\n- Stranka je pred tem opravila analizo potreb (spodaj). V "luknje" IZRECNO preveri, katere od ugotovljenih potreb naložene police pokrivajo in katerih ne.' : ''}` },
        { role: 'user', content: 'PORTFELJ POLIC (JSON):\n' + JSON.stringify(veljavne).slice(0, 24000) + (potrebe ? '\n\nUGOTOVLJENE POTREBE IZ ANALIZE:\n' + potrebe : '') },
      ],
      max_output_tokens: 2600,
      ...(ANSWER_MODEL_STRONG.startsWith('gpt-5') ? { reasoning: { effort: 'low' } } : {}),
      text: { format: { type: 'json_schema', name: 'portfelj', strict: true, schema: ANALIZA_SCHEMA } },
    })

    let ugotovitve
    try { ugotovitve = JSON.parse(analiza.output_text) } catch {
      return respond(res, 502, { error: 'Analize trenutno ni mogoče pripraviti.' })
    }
    return respond(res, 200, { police, ugotovitve })
  } catch (error) {
    console.error('[portfelj] error:', error)
    return respond(res, 500, { error: 'Analize trenutno ni mogoče pripraviti. Poskusite znova.' })
  }
}
