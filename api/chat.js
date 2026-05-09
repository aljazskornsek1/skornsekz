import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EMBEDDING_MODEL = "text-embedding-3-small";
const CHAT_MODEL = "gpt-4o-mini";

function normalizeMessages(body) {
  if (Array.isArray(body?.messages)) {
    return body.messages
      .filter((m) => m && typeof m.content === "string")
      .slice(-8);
  }

  if (typeof body?.message === "string") {
    return [{ role: "user", content: body.message }];
  }

  return [];
}

function lastUserMessage(messages) {
  const userMessages = messages.filter((m) => m.role === "user");
  return userMessages[userMessages.length - 1]?.content || "";
}

function formatContext(matches) {
  if (!matches || matches.length === 0) {
    return "Ni najdenih relevantnih virov.";
  }

  return matches
    .map((m, index) => {
      return `
[VIR ${index + 1}]
Relevantnost: ${Number(m.similarity || 0).toFixed(3)}
Vsebina:
${m.content}
`.trim();
    })
    .join("\n\n---\n\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const messages = normalizeMessages(req.body);
    const question = lastUserMessage(messages);

    if (!question) {
      return res.status(400).json({
        error: "Manjka vprašanje uporabnika.",
      });
    }

    const embeddingResponse = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: question,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    const { data: matches, error: matchError } = await supabase.rpc(
      "match_documents",
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.05,
        match_count: 10,
      }
    );

    if (matchError) {
      console.error("Supabase match error:", matchError);
      throw matchError;
    }

    const context = formatContext(matches);

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
Ti si premium AI asistent za Zavarovanje Skornšek.

Odgovarjaj:
- vedno v slovenščini,
- profesionalno,
- jasno,
- konkretno,
- brez izmišljanja,
- kot zavarovalni svetovalec, ne kot robot.

Uporabljaj predvsem podatke iz najdenih virov spodaj.
Če viri niso dovolj jasni, povej, da za natančno razlago pogojev priporočaš pogovor z zastopnikom.

Ne izmišljaj cen, kritij ali pogojev, če tega ni v virih.

Kontakti:
- Aljaž Skornšek: 031 544 416
- Igor Skornšek: 041 661 362

Najdeni viri:
${context}
          `.trim(),
        },
        ...messages,
      ],
    });

    const reply =
      completion.choices[0]?.message?.content ||
      "Trenutno nimam dovolj podatkov za zanesljiv odgovor.";

    return res.status(200).json({
      reply: reply,
      answer: reply,
      message: reply,
      sources: matches?.slice(0, 5) || [],
    });
  } catch (error) {
    console.error("Chat error:", error);

    return res.status(500).json({
      error: "Napaka pri AI odgovoru.",
      reply: "Prišlo je do napake pri AI odgovoru.",
      answer: "Prišlo je do napake pri AI odgovoru.",
      message: "Prišlo je do napake pri AI odgovoru.",
      details: error.message,
    });
  }
}