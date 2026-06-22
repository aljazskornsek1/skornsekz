import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-5-mini'
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

function documentText(document) {
  return [document?.content, document?.text, document?.chunk, document?.title]
    .find(value => typeof value === 'string' && value.trim())?.trim() || ''
}

async function retrieveContext(openai, question) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase environment variables are missing')

  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: question,
    encoding_format: 'float',
  })
  const queryEmbedding = embeddingResponse.data?.[0]?.embedding
  if (!queryEmbedding) throw new Error('Embedding was not returned')

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: queryEmbedding,
    match_threshold: 0.45,
    match_count: 6,
  })
  if (error) throw error

  return (Array.isArray(data) ? data : [])
    .map(documentText)
    .filter(Boolean)
    .slice(0, 6)
    .join('\n\n---\n\n')
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return respond(res, 200, { success: true, route: '/api/chat' })
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return respond(res, 405, { answer: fallbackAnswer('sl') })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 5000) : ''
  const language = ['sl', 'en', 'de'].includes(body.language) ? body.language : 'sl'
  if (!message) return respond(res, 400, { answer: fallbackAnswer(language) })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('AI assistant unavailable: OPENAI_API_KEY is missing')
    return respond(res, 200, { answer: fallbackAnswer(language) })
  }

  const openai = new OpenAI({ apiKey })
  let context = ''
  try {
    context = await retrieveContext(openai, message)
  } catch (error) {
    console.error('AI assistant RAG search failed:', error)
  }

  try {
    const history = Array.isArray(body.history)
      ? body.history.slice(-6).filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').map(item => ({ role: item.role, content: item.content.slice(0, 2000) }))
      : []
    const languageInstruction = language === 'en' ? 'Answer in English.' : language === 'de' ? 'Antworte auf Deutsch.' : 'Odgovori v slovenščini.'
    const systemPrompt = `Si virtualni zavarovalni asistent podjetja Zavarovanje Skornšek. ${languageInstruction}
Odgovori jasno, prijazno in jedrnato. Pri zavarovalnih kritjih ne ugibaj in ne predstavljaj splošnega odgovora kot zavezujočo razlago police. Kadar je za pravilen odgovor potreben pregled konkretne police ali pogojev, uporabnika usmeri k osebnemu svetovalcu.
${context ? `Uporabi predvsem naslednji pridobljeni kontekst iz baze znanja:\n\n${context}` : 'Baza znanja trenutno ni na voljo. Podaj le varen splošen odgovor in jasno povej, da je za natančen odgovor potreben pregled police.'}`
    const response = await openai.responses.create({
      model: CHAT_MODEL,
      input: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ],
      max_output_tokens: 500,
    })
    const answer = response.output_text?.trim()
    return respond(res, 200, { answer: answer || fallbackAnswer(language) })
  } catch (error) {
    console.error('AI assistant OpenAI response failed:', error)
    return respond(res, 200, { answer: fallbackAnswer(language) })
  }
}
