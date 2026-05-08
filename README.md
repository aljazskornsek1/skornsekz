# Skornšek RAG Knowledge Bot

Ta paket spremeni trenutnega chatbota v RAG sistem, ki išče po PDF pogojih in odgovarja na podlagi relevantnih odlomkov.

## Datoteke v paketu

- `data/pogoji-links.json` — seznam PDF pogojev
- `supabase/setup.sql` — SQL za Supabase tabelo in iskalno funkcijo
- `scripts/ingest.js` — prenese PDF-je, prebere tekst, naredi embeddings in jih shrani v Supabase
- `api/chat.js` — nov Vercel API endpoint, ki išče po bazi znanja
- `package.rag.json` — dependencies, ki jih moraš združiti s svojim `package.json`
- `.env.example` — katere environment variables rabiš

## Koraki

### 1. Ustvari Supabase projekt

Pojdi na Supabase in ustvari nov projekt.

### 2. Zaženi SQL

V Supabase:
SQL Editor → New Query → prilepi vse iz:

`supabase/setup.sql`

Klikni Run.

### 3. Dodaj environment variables lokalno

V root projekta naredi `.env`:

```env
OPENAI_API_KEY=sk-proj-...
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=ey...
```

`SUPABASE_SERVICE_ROLE_KEY` naj bo samo na serverju. Ne daj ga v frontend.

### 4. Posodobi package.json

V svoj trenutni `package.json` dodaj dependencies iz `package.rag.json`.

Najpomembnejše:

```json
"@supabase/supabase-js": "^2.49.1",
"dotenv": "^16.4.7",
"pdf-parse": "^1.1.1",
"openai": "^4.77.0"
```

in script:

```json
"ingest": "node scripts/ingest.js"
```

### 5. Zaženi ingestion

Na računalniku v terminalu:

```bash
npm install
npm run ingest
```

To bo preneslo PDF-je, jih prebralo in shranilo v Supabase.

### 6. Zamenjaj API

Na GitHubu zamenjaj obstoječi:

`api/chat.js`

z novim iz tega paketa.

### 7. Dodaj environment variables v Vercel

V Vercel → Project → Settings → Environment Variables dodaj:

```env
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Potem naredi Redeploy.

## Kako bot odgovarja

Uporabnik vpraša vprašanje.
API:
1. naredi embedding vprašanja,
2. poišče najbolj relevantne odlomke v Supabase,
3. te odlomke pošlje modelu,
4. model odgovori samo na podlagi najdenega konteksta.

## Pomembno

Bot ne sme garantirati kritij ali cen. Končno veljajo konkretna polica, izbrana kritja, izključitve in aktualni pogoji.
