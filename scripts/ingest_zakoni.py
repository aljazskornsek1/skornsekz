"""Naloži OZ (zavarovalna pogodba) in ZZavar-1 v bazo znanja z oznako Zakonodaja."""
import json, re, time, urllib.request, urllib.parse
from pypdf import PdfReader

REPO = '/Users/Aljaz/Desktop/skornsek_rag_knowledge_bot'
ENV = {}
for line in open(f'{REPO}/data/.env.local'):
    m = re.match(r'^([A-Z_]+)=(.*)$', line.strip())
    if m: ENV[m.group(1)] = m.group(2).strip()

def req(url, data=None, headers=None, method=None, retries=3):
    for attempt in range(retries):
        try:
            r = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
            with urllib.request.urlopen(r, timeout=180) as resp:
                return resp.status, resp.read().decode()
        except Exception as e:
            if attempt == retries - 1: raise
            print(f'  ponovni poskus ({e})'); time.sleep(5)

SB = {
    'Content-Type': 'application/json',
    'apikey': ENV['SUPABASE_SERVICE_ROLE_KEY'],
    'Authorization': 'Bearer ' + ENV['SUPABASE_SERVICE_ROLE_KEY'],
    'Prefer': 'return=minimal',
}

def window(text, size=1800, overlap=250):
    out, start = [], 0
    while start < len(text):
        c = text[start:start + size].strip()
        if len(c) > 50: out.append(c)
        start += size - overlap
    return out

def embed(chunks):
    embs = []
    for i in range(0, len(chunks), 100):
        _, body = req('https://api.openai.com/v1/embeddings',
            data=json.dumps({'model': 'text-embedding-3-small', 'input': chunks[i:i+100]}).encode(),
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ENV['OPENAI_API_KEY']})
        embs += [d['embedding'] for d in json.loads(body)['data']]
    return embs

def upload(title, source, chunks):
    embs = embed(chunks)
    req(ENV['SUPABASE_URL'] + '/rest/v1/documents?title=eq.' + urllib.parse.quote(title, safe=''),
        headers=SB, method='DELETE')
    rows = [{'content': c, 'embedding': e, 'title': title, 'source': source,
             'filename': source, 'chunk_index': i + 1}
            for i, (c, e) in enumerate(zip(chunks, embs))]
    for i in range(0, len(rows), 30):
        req(ENV['SUPABASE_URL'] + '/rest/v1/documents', data=json.dumps(rows[i:i+30]).encode(),
            headers=SB, method='POST')
    print(f'{title}: {len(chunks)} chunkov naloženih')

# ---------- 1) OZ — zavarovalna pogodba ----------
OZ_PREFIX = '[Obligacijski zakonik (OZ), XXVI. poglavje: Zavarovalna pogodba | Zakonodaja | Splošna zakonska pravila za vse zavarovalne pogodbe — konkretni zavarovalni pogoji imajo prednost, kjer zakon dopušča odmik]'
oz_text = open(f'{REPO}/data/oz-zavarovalna-pogodba.txt').read()
oz_chunks = []
for blok in oz_text.split('\n\n'):
    blok = blok.strip()
    if not blok: continue
    header, _, body = blok.partition('\n')
    if len(body) <= 2400:
        oz_chunks.append(f'{OZ_PREFIX}\n{header}\n{body}')
    else:
        for j, part in enumerate(window(body)):
            oz_chunks.append(f'{OZ_PREFIX}\n{header}{" (nadaljevanje)" if j else ""}\n{part}')
upload('Obligacijski zakonik (OZ) — zavarovalna pogodba', 'oz-zavarovalna-pogodba.txt', oz_chunks)

# ---------- 2) ZZavar-1 ----------
ZZ_PREFIX = '[Zakon o zavarovalništvu (ZZavar-1) | Zakonodaja | Zakon o poslovanju zavarovalnic in pravicah strank — konkretni zavarovalni pogoji urejajo posamezna kritja]'
reader = PdfReader(f'{REPO}/data/pdfs/ZAKO6183_NPB6.pdf')
text = re.sub(r'[ \t]+', ' ', '\n'.join((p.extract_text() or '') for p in reader.pages))

CLEN_RE = re.compile(r'(?<![\d.])(\d{1,3})\.\s*člen\s*[:\-–]?\s*\(?([^\n)]{0,80})\)?', re.U)
matches, filtered, last = list(CLEN_RE.finditer(text)), [], 0
for m in matches:
    n = int(m.group(1))
    if n == last + 1 or (last and last < n <= last + 3):
        filtered.append(m); last = n
    elif not filtered and n == 1:
        filtered.append(m); last = 1
print('ZZavar-1 členov najdenih:', len(filtered))

zz_chunks = []
for i, m in enumerate(filtered):
    end = filtered[i + 1].start() if i + 1 < len(filtered) else len(text)
    naslov = re.sub(r'\s+', ' ', m.group(2)).strip(' .-–:')
    header = f'{m.group(1)}. člen' + (f' — {naslov}' if naslov else '')
    body = re.sub(r'\s+', ' ', text[m.start():end]).strip()
    if len(body) < 60: continue
    if len(body) <= 2400:
        zz_chunks.append(f'{ZZ_PREFIX}\n{header}\n{body}')
    else:
        for j, part in enumerate(window(body)):
            zz_chunks.append(f'{ZZ_PREFIX}\n{header}{" (nadaljevanje)" if j else ""}\n{part}')
print('ZZavar-1 chunkov:', len(zz_chunks))

garb = sum(1 for c in zz_chunks if len(re.findall(r'[a-zA-ZčšžČŠŽ0-9\s.,;:()\[\]%€/\-–"\'!?]', c)) / len(c) < 0.85)
print('smeti:', garb)
assert garb == 0, 'polomljena ekstrakcija!'
upload('Zakon o zavarovalništvu (ZZavar-1)', 'ZAKO6183_NPB6.pdf', zz_chunks)
print('konec')
