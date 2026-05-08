import fs from "fs";
import OpenAI from "openai";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: "./data/.env.local" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const INPUT_FILE = "./data/knowledge-base.json";

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  return response.data[0].embedding;
}

async function main() {
  const raw = fs.readFileSync(INPUT_FILE, "utf8");
  const items = JSON.parse(raw);

  console.log(`Nalagam v Supabase: ${items.length} zapisov`);

  for (const item of items) {
    const content = item.text || item.url || JSON.stringify(item);
    const embedding = item.embedding || await createEmbedding(content);

    const { error } = await supabase.from("documents").insert({
      content,
      embedding,
    });

    if (error) {
      console.error("Supabase napaka:", error);
    } else {
      console.log("Naloženo:", content.slice(0, 80));
    }
  }

  console.log("Končano.");
}

main().catch(console.error);