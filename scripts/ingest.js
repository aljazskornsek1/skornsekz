import dotenv from "dotenv";
dotenv.config({ path: "./data/.env.local" });

import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { PDFParse } from "pdf-parse";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EMBEDDING_MODEL = "text-embedding-3-small";

const PDF_DIR = path.join(process.cwd(), "data", "pdfs");

function chunkText(text, chunkSize = 1200, overlap = 200) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = start + chunkSize;
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }

  return chunks;
}

async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);

  const parser = new PDFParse({
    data: buffer
  });

  const result = await parser.getText();

  await parser.destroy();

  return result.text;
}

async function main() {
  const files = fs
    .readdirSync(PDF_DIR)
    .filter((file) => file.endsWith(".pdf"));

  console.log(`Najdenih PDF-jev: ${files.length}`);

  for (const file of files) {
    const filePath = path.join(PDF_DIR, file);

    console.log(`\nBerem PDF: ${file}`);

    const text = await extractPdfText(filePath);

    const cleanText = text.replace(/\s+/g, " ").trim();

    const chunks = chunkText(cleanText);

    console.log(`Chunkov: ${chunks.length}`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      const embeddingResponse = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: chunk
      });

      const embedding = embeddingResponse.data[0].embedding;

      const { error } = await supabase
        .from("documents")
        .insert({
          content: chunk,
          embedding: embedding
        });

      if (error) {
        console.error("Supabase napaka:", error);
        process.exit(1);
      }

      console.log(`Shranjen chunk ${i + 1}/${chunks.length}`);
    }
  }

  console.log("\nPDF ingest končan.");
}

main().catch((err) => {
  console.error(err);
});