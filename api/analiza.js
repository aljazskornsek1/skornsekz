import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const ANSWER_MODEL_STRONG = process.env.OPENAI_ANSWER_MODEL_STRONG || 'gpt-5.4'
const EMBEDDING_MODEL = 'text-embedding-3-small'

function respond(res, status, payload) {
  res.status(status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.end(JSON.stringify(payload))
}

// katalog produktov s pravimi URL-ji (statične podstrani) — model sme povezovati SAMO nanje
const KATALOG = [
  ['Paketi avtomobilskih zavarovanj', '/paketi-avtomobilskih-zavarovanj.html'],
  ['Avtomobilska odgovornost (AO)', '/zavarovanje-avtomobilske-odgovornosti-ao.html'],
  ['Zavarovanje voznika (AO plus)', '/zavarovanje-voznika-ao-plus.html'],
  ['Kasko zavarovanje', '/zavarovanje-avtomobilskega-kaska.html'],
  ['Avtomobilska asistenca', '/zavarovanje-avtomobilske-asistence.html'],
  ['Nezgodno zavarovanje voznika in potnikov', '/nezgodno-zavarovanje-voznika-in-potnikov.html'],
  ['Zavarovanje mladega voznika', '/zavarovanje-mladi-voznik.html'],
  ['Zavarovanje motorja', '/zavarovanje-motorja.html'],
  ['Zavarovanje avtodoma', '/zavarovanje-avtodoma.html'],
  ['Zavarovanje mikromobilnosti (kolo, e-skiro)', '/zavarovanje-mikro-mobilnosti.html'],
  ['Zavarovanje doma', '/zavarovanje-doma.html'],
  ['Zavarovanje naprav', '/zavarovanje-naprav.html'],
  ['Zavarovanje medicinskih pripomočkov', '/zavarovanje-medicinskih-pripomockov.html'],
  ['Življenjsko zavarovanje za primer smrti', '/zivljenjsko-zavarovanje-za-primer-smrti.html'],
  ['Življenjsko zavarovanje Lajf', '/zivljenjsko-zavarovanje-lajf.html'],
  ['Življenjsko zavarovanje Jesen življenja', '/zivljenjsko-zavarovanje-jesen-zivljenja.html'],
  ['Individualno nezgodno zavarovanje', '/individualno-nezgodno-zavarovanje.html'],
  ['Nezgodno zavarovanje otrok in mladih', '/nezgodno-zavarovanje-otrok-in-mladih.html'],
  ['Nezgodno zavarovanje starejših', '/nezgodno-zavarovanje-starejsih.html'],
  ['Nezgodno zavarovanje športnikov', '/nezgodno-zavarovanje-sportnikov.html'],
  ['Zavarovanje Specialisti', '/zavarovanje-specialisti-in-specialisti-plus.html'],
  ['Zavarovanje Zobje', '/zavarovanje-zobje-in-zobje-plus.html'],
  ['Zavarovanje Zdravnik 360', '/zavarovanje-zdravnik-360.html'],
  ['Zavarovanje operacij', '/zavarovanje-operacije.html'],
  ['Zavarovanje potovanj v tujino', '/zavarovanje-potovanj-v-tujino.html'],
  ['Zavarovanje odpovedi turističnih potovanj', '/zavarovanje-odpovedi-turisticnih-potovanj.html'],
  ['Paketno zavarovanje osebne zaščite', '/paketno-zavarovanje-osebne-zascite.html'],
  ['Zavarovanje odgovornosti', '/zavarovanje-odgovornosti.html'],
  ['Zavarovanje zlorabe plačilnih kartic', '/zavarovanje-zlorabe-placilnih-kartic.html'],
  ['Zavarovanje brezposelnosti, smrti in trajne invalidnosti', '/zavarovanje-brezposelnosti-smrti-in-trajne-invalidnosti.html'],
  ['Naložbena zavarovanja (Fleksi, i.fleks)', '/nalozbena-zavarovanja.html'],
  ['Pokojninska zavarovanja', '/pokojninska-zavarovanja.html'],
  ['Zavarovanje psov', '/zavarovanje-psov.html'],
  ['Zavarovanje mačk', '/zavarovanje-mack.html'],
]

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    teaser: {
      type: 'array', minItems: 3, maxItems: 3,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          naslov: { type: 'string' },
          zakaj: { type: 'string' },
          predlog: { type: 'string' },
        },
        required: ['naslov', 'zakaj', 'predlog'],
      },
    },
    tveganja: {
      type: 'array', minItems: 4, maxItems: 9,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          naslov: { type: 'string' },
          stopnja: { type: 'string', enum: ['visoka', 'srednja', 'nizka'] },
          zakaj: { type: 'string' },
          resitev: { type: 'string' },
        },
        required: ['naslov', 'stopnja', 'zakaj', 'resitev'],
      },
    },
    luknje: { type: 'array', maxItems: 6, items: { type: 'string' } },
    priporocila: {
      type: 'array', minItems: 3, maxItems: 8,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          produkt: { type: 'string' },
          razlog: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['produkt', 'razlog', 'url'],
      },
    },
    vprasanja_za_posvet: { type: 'array', minItems: 3, maxItems: 6, items: { type: 'string' } },
    povzetek: { type: 'string' },
  },
  required: ['teaser', 'tveganja', 'luknje', 'priporocila', 'vprasanja_za_posvet', 'povzetek'],
}

function profilVBesedilo(p) {
  const rows = []
  const push = (k, v) => { if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) rows.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`) }
  push('Starost', p.starost)
  push('Status', p.status)
  push('Otroci', p.otroci)
  push('Zaposlitev', p.zaposlitev)
  push('Bivanje', p.bivanje)
  push('Tip nepremičnine', p.nepremicnina)
  push('Vrednost nepremičnine', p.vrednost_nepremicnine)
  push('Posebnosti doma', p.dom_posebnosti)
  push('Vozila', p.vozila)
  push('Vrednost glavnega vozila', p.vrednost_vozila)
  push('Mladi voznik v družini', p.mladi_voznik)
  push('Kredit', p.kredit)
  push('Višina kredita', p.kredit_znesek)
  push('Dohodek gospodinjstva odvisen od', p.dohodek)
  push('Finančna rezerva', p.rezerva)
  push('Šport', p.sport)
  push('Potovanja v tujino', p.potovanja)
  push('Hišni ljubljenčki', p.ljubljencki)
  push('Skrb za starše', p.starsi)
  push('Obstoječa zavarovanja', p.obstojeca)
  push('Dodatno', p.opomba)
  return rows.join('\n')
}

async function retrieve(openai, supabase, queries) {
  const chunks = []
  const emb = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: queries, encoding_format: 'float' })
  const results = await Promise.all(
    emb.data.map(d => supabase.rpc('match_documents', {
      query_embedding: d.embedding, match_threshold: 0.3, match_count: 8,
    })),
  )
  const seen = new Set()
  for (const r of results) {
    for (const row of (r.error ? [] : r.data || [])) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      chunks.push(`[${row.title || row.source || 'dokument'}]\n${(row.content || '').slice(0, 1200)}`)
    }
  }
  return chunks.slice(0, 24).join('\n\n---\n\n')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return respond(res, 405, { error: 'Samo POST.' })
  }
  const openaiKey = process.env.OPENAI_API_KEY
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!openaiKey || !supabaseUrl || !supabaseKey) {
    return respond(res, 503, { error: 'Storitev ni pravilno nastavljena.' })
  }

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}')
    const profil = body.profil && typeof body.profil === 'object' ? body.profil : null
    const language = ['sl', 'en', 'de'].includes(body.language) ? body.language : 'sl'
    if (!profil) return respond(res, 400, { error: 'Manjka profil.' })

    const profilTekst = profilVBesedilo(profil).slice(0, 4000)
    if (!profilTekst) return respond(res, 400, { error: 'Prazen profil.' })

    const openai = new OpenAI({ apiKey: openaiKey })
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })

    // poizvedbe za RAG glede na profil
    const queries = ['kritja in izključitve zavarovanje doma', 'nezgodno zavarovanje kritja invalidnost']
    const t = profilTekst.toLowerCase()
    if (/kredit/.test(t)) queries.push('življenjsko zavarovanje za primer smrti kreditojemalec zavarovalna vsota')
    if (/vozil|avto|kasko/.test(t)) queries.push('kasko zavarovanje kritja delni kasko')
    if (/potovanj/.test(t)) queries.push('zavarovanje potovanj v tujino kritja asistenca')
    if (/šport|sport/.test(t)) queries.push('nezgodno zavarovanje športnikov kritje tekmovanja')
    if (/otro(k|ci)/.test(t)) queries.push('nezgodno zavarovanje otrok in mladih kritja')
    if (/pes|mačk|mack|ljubljen/.test(t)) queries.push('zavarovanje psov in mačk kritja veterinar')
    let context = ''
    try { context = await retrieve(openai, supabase, queries.slice(0, 6)) } catch (e) { console.error('[analiza] RAG:', e.message) }

    const katalog = KATALOG.map(([n, u]) => `${n} → ${u}`).join('\n')
    const langNote = language === 'en' ? 'Write ALL text fields in English.' : language === 'de' ? 'Schreibe ALLE Textfelder auf Deutsch.' : 'Vsa besedila piši v slovenščini.'

    const system = `Si izkušen zavarovalni svetovalec agencije Zavarovanje Skornšek (ekskluzivni zastopnik Zavarovalnice Triglav).
Iz profila stranke izdelaj analizo zavarovalnih potreb. Pravila:
- Vikanje, topel a strokoven ton. ${langNote}
- NIKOLI ne navajaj premij, cen ali številk, ki jih ne moreš utemeljiti. Zavarovalnih vsot ne izmišljuj; kjer je smiselno, opiši pristop (npr. "vsota naj pokrije 5 letnih dohodkov ali ostanek kredita").
- "teaser" = 3 NAJPOMEMBNEJŠA tveganja tega profila, konkretno in osebno (ne generično).
- "priporocila": uporabi IZKLJUČNO produkte in URL-je iz kataloga spodaj; izberi samo relevantne.
- Upoštevaj obstoječa zavarovanja: česar stranka že ima, ne priporočaj znova — pri "luknje" pa opozori, če pri obstoječem kritju pogosto kaj manjka.
- Vsak nasvet je informativen predlog za posvet, ne zavezujoče svetovanje.

KATALOG PRODUKTOV (ime → url):
${katalog}`

    const user = `PROFIL STRANKE:\n${profilTekst}\n\nIZVLEČKI IZ POGOJEV (za oporo, ne citiraj dobesedno):\n${context || '(ni na voljo)'}`

    const response = await openai.responses.create({
      model: ANSWER_MODEL_STRONG,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_output_tokens: 4000,
      ...(ANSWER_MODEL_STRONG.startsWith('gpt-5') && !ANSWER_MODEL_STRONG.includes('chat')
        ? { reasoning: { effort: 'low' } }
        : {}),
      text: {
        format: { type: 'json_schema', name: 'analiza_potreb', strict: true, schema: SCHEMA },
      },
    })

    const raw = response.output_text
    let porocilo
    try { porocilo = JSON.parse(raw) } catch {
      console.error('[analiza] JSON parse fail:', (raw || '').slice(0, 300))
      return respond(res, 502, { error: 'Analize trenutno ni mogoče pripraviti. Poskusite znova.' })
    }
    return respond(res, 200, { porocilo })
  } catch (error) {
    console.error('[analiza] error:', error)
    return respond(res, 500, { error: 'Analize trenutno ni mogoče pripraviti. Poskusite znova.' })
  }
}
