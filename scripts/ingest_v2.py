"""Ingest v2: rezanje pogojev po členih z metapodatki.

Način: python3 ingest_v2.py dry    -> samo statistika, brez pisanja v bazo
       python3 ingest_v2.py upload -> izbriši + naloži vse dokumente
"""
import json, re, sys, time, urllib.request, urllib.parse
from pathlib import Path
from pypdf import PdfReader

REPO = Path('/Users/Aljaz/Desktop/skornsek_rag_knowledge_bot')
PDF_DIR = REPO / 'data' / 'pdfs'

ENV = {}
for line in (REPO / 'data' / '.env.local').read_text().splitlines():
    m = re.match(r'^([A-Z_]+)=(.*)$', line.strip())
    if m: ENV[m.group(1)] = m.group(2).strip()

# --- metapodatki iz pogoji-links.json ---
meta = {}
links = json.loads((REPO / 'data' / 'pogoji-links.json').read_text())
for s in links['sources']:
    url = s.get('url', '')
    fname = urllib.parse.unquote(url.split('?')[0].rsplit('/', 1)[-1])
    if fname.lower().endswith('.pdf'):
        meta[fname] = {'title': s['title'], 'group': s.get('group', ''), 'category': s.get('category', '')}

def doc_meta(pdf_path, first_page_text):
    m = meta.get(pdf_path.name)
    if m: return m
    # rezerva: naslov iz prve strani PDF-ja
    lines = [l.strip() for l in first_page_text.splitlines() if len(l.strip()) > 15]
    title = ''
    for l in lines[:8]:
        if re.search(r'pogoji|zavarovanj|seznam|tabela', l, re.I):
            title = l; break
    return {'title': title or pdf_path.stem, 'group': '', 'category': ''}

CLEN_RE = re.compile(r'(?<![\d.])(\d{1,3})\.\s*člen\s*[:\-–]?\s*([^\n]{0,90})', re.U)

def normalize(t):
    t = t.replace('­', '')
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r'\n{2,}', '\n', t)
    return t.strip()

def split_by_clen(text):
    """Vrne [(header, body)] — razrez po 'N. člen'."""
    matches = list(CLEN_RE.finditer(text))
    # zahtevaj naraščajoče številke členov, da ne ujamemo sklicev sredi stavka
    filtered, last = [], 0
    for m in matches:
        n = int(m.group(1))
        if n == last + 1 or (n > last and n <= last + 3):
            filtered.append(m); last = n
    if len(filtered) < 3:
        return None
    sections = []
    if filtered[0].start() > 80:
        sections.append(('Uvodne določbe', text[:filtered[0].start()]))
    for i, m in enumerate(filtered):
        end = filtered[i + 1].start() if i + 1 < len(filtered) else len(text)
        naslov = re.sub(r'\s+', ' ', m.group(2)).strip(' .-–:')
        header = f'{m.group(1)}. člen' + (f' — {naslov}' if naslov else '')
        sections.append((header, text[m.start():end]))
    return sections

def window(text, size=1500, overlap=200):
    out, start = [], 0
    while start < len(text):
        c = text[start:start + size].strip()
        if len(c) > 50: out.append(c)
        start += size - overlap
    return out

def build_chunks(pdf_path):
    ocr_file = pdf_path.parent.parent / (pdf_path.stem + '.ocr.txt')
    if ocr_file.exists():
        pages = [ocr_file.read_text()]
    else:
        reader = PdfReader(str(pdf_path))
        pages = [(p.extract_text() or '') for p in reader.pages]
    text = normalize('\n'.join(pages))
    dm = doc_meta(pdf_path, pages[0] if pages else '')
    arh = ' | ARHIVSKI POGOJI (veljajo za starejše police, ne za nove sklenitve)' if '-arh' in pdf_path.stem.lower() else ''
    prefix_parts = [dm['title']]
    if dm['category']: prefix_parts.append(dm['category'])
    if dm['group']: prefix_parts.append(dm['group'])
    prefix = '[' + ' | '.join(prefix_parts) + arh + ']'

    flat = re.sub(r'\s+', ' ', text)
    sections = split_by_clen(text)
    chunks = []
    if sections:
        for header, body in sections:
            body_flat = re.sub(r'\s+', ' ', body).strip()
            if len(body_flat) < 60: continue
            if len(body_flat) <= 2400:
                chunks.append(f'{prefix}\n{header}\n{body_flat}')
            else:
                for j, part in enumerate(window(body_flat, 1800, 250)):
                    cont = ' (nadaljevanje)' if j else ''
                    chunks.append(f'{prefix}\n{header}{cont}\n{part}')
        mode = f'{len(sections)} členov'
    else:
        chunks = [f'{prefix}\n{part}' for part in window(flat)]
        mode = 'drseče okno'
    return dm, chunks, mode, len(flat)

def garbage_ratio(t):
    ok = len(re.findall(r'[a-zA-ZčšžČŠŽđĐćĆäöüÄÖÜ0-9\s.,;:()\[\]%€/\-–"\'!?]', t))
    return 1 - ok / max(len(t), 1)

def req(url, data=None, headers=None, method=None, retries=3):
    for attempt in range(retries):
        try:
            r = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
            with urllib.request.urlopen(r, timeout=180) as resp:
                return resp.status, resp.read().decode()
        except Exception as e:
            if attempt == retries - 1: raise
            print(f'  ponovni poskus ({e})'); time.sleep(5)

def embed_all(chunks):
    embs = []
    for i in range(0, len(chunks), 100):
        batch = chunks[i:i + 100]
        _, body = req('https://api.openai.com/v1/embeddings',
            data=json.dumps({'model': 'text-embedding-3-small', 'input': batch}).encode(),
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ENV['OPENAI_API_KEY']})
        embs += [d['embedding'] for d in json.loads(body)['data']]
    return embs

SB = {
    'Content-Type': 'application/json',
    'apikey': ENV['SUPABASE_SERVICE_ROLE_KEY'],
    'Authorization': 'Bearer ' + ENV['SUPABASE_SERVICE_ROLE_KEY'],
    'Prefer': 'return=minimal',
}

def upload_doc(pdf_path, dm, chunks):
    embs = embed_all(chunks)
    assert len(embs) == len(chunks)
    # izbris starih vrstic tega PDF-ja (po filename IN po starem title=stem)
    for col, val in (('filename', pdf_path.name), ('title', pdf_path.stem)):
        req(ENV['SUPABASE_URL'] + f'/rest/v1/documents?{col}=eq.' + urllib.parse.quote(val, safe=''),
            headers=SB, method='DELETE')
    rows = [{'content': c, 'embedding': e, 'title': dm['title'], 'source': pdf_path.name,
             'filename': pdf_path.name, 'chunk_index': i + 1}
            for i, (c, e) in enumerate(zip(chunks, embs))]
    for i in range(0, len(rows), 30):
        req(ENV['SUPABASE_URL'] + '/rest/v1/documents', data=json.dumps(rows[i:i + 30]).encode(),
            headers=SB, method='POST')

mode_arg = sys.argv[1] if len(sys.argv) > 1 else 'dry'
pdfs = sorted(PDF_DIR.glob('*.pdf'))
print(f'PDF-jev: {len(pdfs)}; način: {mode_arg}\n')
total = 0
problems = []
for p in pdfs:
    try:
        dm, chunks, mode, nchars = build_chunks(p)
    except Exception as e:
        problems.append(f'{p.name}: NAPAKA {e}'); print(f'!! {p.name}: {e}'); continue
    g = sum(1 for c in chunks if garbage_ratio(c) > 0.15)
    total += len(chunks)
    flag = f'  <-- {g} SMETI!' if g else ''
    print(f'{p.name:45s} {mode:15s} {len(chunks):4d} chunkov  ({nchars} zn){flag}')
    if g: problems.append(f'{p.name}: {g}/{len(chunks)} smeti')
    if mode_arg == 'upload' and not g:
        upload_doc(p, dm, chunks)
        print(f'  -> naloženo ({dm["title"][:60]})')
    elif mode_arg == 'upload' and g:
        print('  -> PRESKOČENO zaradi smeti')

print(f'\nSkupaj chunkov: {total}')
if problems:
    print('TEŽAVE:'); [print(' -', x) for x in problems]
