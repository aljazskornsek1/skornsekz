import fs from "fs";
import path from "path";

const linksFile = "./data/links.txt";
const outputDir = "./data/pdfs";

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const links = fs
  .readFileSync(linksFile, "utf-8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

async function downloadFile(url, index) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.log(`Napaka pri ${url}`);
      return;
    }

    const arrayBuffer = await response.arrayBuffer();

    const safeName =
      url.split("/").pop()?.split("?")[0] || `pdf-${index + 1}.pdf`;

    fs.writeFileSync(
      path.join(outputDir, safeName),
      Buffer.from(arrayBuffer)
    );

    console.log(`Prenesen: ${safeName}`);
  } catch (err) {
    console.log(`Napaka: ${url}`);
  }
}

async function main() {
  for (let i = 0; i < links.length; i++) {
    await downloadFile(links[i], i);
  }

  console.log("Končano.");
}

main();