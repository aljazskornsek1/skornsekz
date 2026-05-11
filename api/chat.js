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
      .filter(
        (m) =>
          m &&
          typeof m.content === "string" &&
          ["user", "assistant"].includes(m.role)
      )
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
      const similarity = Number(m.similarity || 0).toFixed(3);

      return `
[VIR ${index + 1}]
Relevantnost: ${similarity}
Vsebina:
${m.content || ""}
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
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Manjka OPENAI_API_KEY.");
    }

    if (!process.env.SUPABASE_URL) {
      throw new Error("Manjka SUPABASE_URL.");
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Manjka SUPABASE_SERVICE_ROLE_KEY.");
    }

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
        match_threshold: 0.03,
        match_count: 12,
      }
    );

    if (matchError) {
      console.error("Supabase match error:", matchError);
      throw matchError;
    }

    const usefulMatches = Array.isArray(matches) ? matches : [];
    const context = formatContext(usefulMatches);

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.2,
      max_tokens: 1000,
      messages: [
        {
          role: "system",
          content: `
Ti si premium AI asistent za Zavarovanje Skornšek.

Govoriš vedno v slovenščini.

Tvoj slog:
- profesionalen,
- jasen,
- konkreten,
- prijazen,
- samozavesten,
- kot izkušen zavarovalni svetovalec,
- nikoli kot robot.

Pravila:
- Uporabljaj predvsem podatke iz najdenih virov.
- Na koncu odgovora vedno dodaj razdelek "Viri:".
- V razdelku "Viri:" navedi največ 3 uporabljene vire.
- Vire napiši v obliki:
  Vir 1: kratek povzetek uporabljene vsebine.
  Vir 2: kratek povzetek uporabljene vsebine.
  Vir 3: kratek povzetek uporabljene vsebine.
- Če viri niso najdeni ali niso dovolj natančni, napiši:
  Viri: Za to vprašanje nisem našel dovolj natančnega vira v bazi znanja.
- Ne izmišljaj virov, imen PDF datotek, členov ali številk strani, če niso podani.
- Ne izmišljaj cen, kritij, izključitev, popustov ali pogojev.
- Če v virih ni dovolj informacij, to jasno povej.
- Če uporabnik sprašuje po ceni, povej, da je cena odvisna od podatkov konkretnega primera.
- Če gre za pomembno odločitev, priporočaj pogovor z zastopnikom.
- Ne omenjaj tehničnih izrazov, kot so vektorji, embeddingi, Supabase, RAG ali baza podatkov.
- Ne piši predolgih odgovorov, razen če uporabnik zahteva podrobno razlago.
- Če je smiselno, odgovor zaključi s ponudbo za pomoč ali kontakt.

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
      reply,
      answer: reply,
      message: reply,
      sources: usefulMatches.slice(0, 5),
    });
  } catch (error) {
    console.error("Chat error:", error);

    return res.status(500).json({
      error: "Napaka pri AI odgovoru.",
      reply:
        "Prišlo je do napake pri AI odgovoru. Poskusite ponovno ali kontaktirajte zastopnika.",
      answer:
        "Prišlo je do napake pri AI odgovoru. Poskusite ponovno ali kontaktirajte zastopnika.",
      message:
        "Prišlo je do napake pri AI odgovoru. Poskusite ponovno ali kontaktirajte zastopnika.",
      details: error.message,
    });
  }
}