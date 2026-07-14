import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const NAVY = '#0A1428'
const GOLD = '#B08D57'
const INK = '#1f2937'
const MUTE = '#6b7280'
const LINE = '#e3dccb'

const F = {
  serif: path.join(__dirname, 'fonts', 'Georgia.ttf'),
  serifB: path.join(__dirname, 'fonts', 'Georgia Bold.ttf'),
  sans: path.join(__dirname, 'fonts', 'Arial.ttf'),
  sansB: path.join(__dirname, 'fonts', 'Arial Bold.ttf'),
}
const LOGO = path.join(__dirname, 'logo.png')
const PODPIS = path.join(__dirname, 'podpis.png')

const T = {
  sl: {
    doc: 'ANALIZA ZAVAROVALNIH POTREB', zaupno: 'Osebno poročilo — zaupno',
    za: 'Pripravljeno za', datum: 'Datum',
    score: 'Ocena zaščitenosti', potencial: 'po ureditvi prioritet',
    matrix: 'Kaj urediti najprej', mv: 'Verjetnost', mp: 'Posledica',
    ver: ['velika', 'srednja', 'majhna'], pos: ['blaga', 'resna', 'kritična'],
    risks: 'Prepoznana tveganja', sol: 'Rešitev', vir: 'Vir',
    gaps: 'Pozor pri obstoječih kritjih', recs: 'Priporočeni koraki',
    qs: 'Vprašanja za posvet', regards: 'S spoštovanjem,',
    role1: 'zavarovalni zastopnik', role2: 'zavarovalni zastopnik',
    disclaimer: 'Analiza je informativne narave in ne predstavlja zavarovalnega svetovanja ali ponudbe. Za točen obseg kritij veljajo pogoji posameznega zavarovanja. Zavarovanje Skornšek — ekskluzivni zastopnik Zavarovalnice Triglav, d.d.',
    page: 'Stran', vsota: 'Priporočena vsota', qr: 'Spletno poročilo',
  },
  en: {
    doc: 'INSURANCE NEEDS ANALYSIS', zaupno: 'Personal report — confidential',
    za: 'Prepared for', datum: 'Date',
    score: 'Protection score', potencial: 'after addressing priorities',
    matrix: 'What to address first', mv: 'Likelihood', mp: 'Impact',
    ver: ['high', 'medium', 'low'], pos: ['minor', 'serious', 'critical'],
    risks: 'Identified risks', sol: 'Solution', vir: 'Source',
    gaps: 'Watch-outs in existing coverage', recs: 'Recommended steps',
    qs: 'Questions for your consultation', regards: 'Kind regards,',
    role1: 'insurance agent', role2: 'insurance agent',
    disclaimer: 'This analysis is informative in nature and does not constitute insurance advice or an offer. The terms of each individual policy apply. Zavarovanje Skornšek — exclusive agent of Zavarovalnica Triglav, d.d.',
    page: 'Page', vsota: 'Recommended sum insured', qr: 'Online report',
  },
  de: {
    doc: 'ANALYSE DES VERSICHERUNGSBEDARFS', zaupno: 'Persönlicher Bericht — vertraulich',
    za: 'Erstellt für', datum: 'Datum',
    score: 'Schutz-Bewertung', potencial: 'nach Regelung der Prioritäten',
    matrix: 'Was zuerst zu regeln ist', mv: 'Wahrscheinlichkeit', mp: 'Folgen',
    ver: ['hoch', 'mittel', 'gering'], pos: ['gering', 'ernst', 'kritisch'],
    risks: 'Erkannte Risiken', sol: 'Lösung', vir: 'Quelle',
    gaps: 'Worauf bei bestehendem Schutz zu achten ist', recs: 'Empfohlene Schritte',
    qs: 'Fragen für die Beratung', regards: 'Mit freundlichen Grüßen,',
    role1: 'Versicherungsvertreter', role2: 'Versicherungsvertreter',
    disclaimer: 'Diese Analyse ist informativer Natur und stellt keine Versicherungsberatung oder ein Angebot dar. Es gelten die Bedingungen der jeweiligen Versicherung. Zavarovanje Skornšek — exklusiver Vertreter der Zavarovalnica Triglav, d.d.',
    page: 'Seite', vsota: 'Empfohlene Versicherungssumme', qr: 'Online-Bericht',
  },
}

const col = s => (s >= 70 ? '#2e7d4f' : s >= 40 ? GOLD : '#b3402a')

export async function zgradiPdf({ porocilo, ime, language = 'sl', reportUrl = '' }) {
  const t = T[language] || T.sl
  const p = porocilo
  let qrPng = null
  if (reportUrl) {
    try { qrPng = await QRCode.toBuffer(reportUrl, { margin: 1, width: 180, color: { dark: NAVY, light: '#ffffff' } }) } catch {}
  }
  const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 70, left: 58, right: 58 }, bufferPages: true, info: { Title: t.doc, Author: 'Zavarovanje Skornšek' } })
  const chunks = []
  doc.on('data', c => chunks.push(c))
  const done = new Promise(res => doc.on('end', () => res(Buffer.concat(chunks))))

  const W = doc.page.width, L = 58, R = W - 58, CW = R - L
  const datum = new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : language === 'en' ? 'en-GB' : 'sl-SI', { dateStyle: 'long', timeZone: 'Europe/Ljubljana' }).format(new Date())

  const ensure = h => { if (doc.y + h > doc.page.height - 84) doc.addPage() }
  const heading = txt => {
    ensure(130)
    doc.moveDown(1.2)
    doc.font(F.serif).fontSize(17).fillColor(NAVY).text(txt, L)
    doc.moveTo(L, doc.y + 4).lineTo(L + 42, doc.y + 4).lineWidth(1.4).strokeColor(GOLD).stroke()
    doc.moveDown(0.9)
  }

  // ── glava dokumenta
  doc.rect(0, 0, W, 158).fill(NAVY)
  try { doc.image(LOGO, L, 34, { height: 34 }) } catch {}
  doc.font(F.sansB).fontSize(8.5).fillColor(GOLD).text('Z A V A R O V A N J E   S K O R N Š E K', L + 46, 40)
  doc.font(F.sans).fontSize(7.5).fillColor('#8fa0b8').text('www.zav-skornsek.si', L + 46, 54)
  doc.font(F.serif).fontSize(24).fillColor('#ffffff').text(t.doc.charAt(0) + t.doc.slice(1).toLowerCase(), L, 84, { width: CW })
  doc.font(F.sans).fontSize(9).fillColor('#c9d2e0')
  doc.text(`${t.za}: `, L, 126, { continued: true }).font(F.sansB).fillColor('#ffffff').text(ime, { continued: true })
    .font(F.sans).fillColor('#c9d2e0').text(`      ${t.datum}: `, { continued: true }).font(F.sansB).fillColor('#ffffff').text(datum)
  doc.font(F.sans).fontSize(7.5).fillColor(GOLD).text(t.zaupno.toUpperCase(), L, 126, { width: CW, align: 'right' })

  doc.y = 190
  // ── povzetek
  if (p.povzetek) doc.font(F.sans).fontSize(10).fillColor(INK).text(p.povzetek, L, doc.y, { width: CW, lineGap: 3 })

  // ── ocena
  const o = p.ocena_zascitenosti
  if (o && typeof o.skupaj === 'number') {
    doc.moveDown(1.2); ensure(150)
    const boxY = doc.y
    const rows = (o.podrocja || []).length
    const boxH = 92 + rows * 36
    doc.rect(L, boxY, CW, boxH).lineWidth(0.8).strokeColor(LINE).stroke()
    doc.font(F.sansB).fontSize(7.5).fillColor(GOLD).text(t.score.toUpperCase(), L + 20, boxY + 16, { characterSpacing: 1.5 })
    doc.font(F.serif).fontSize(38)
    const numW = doc.widthOfString(String(o.skupaj))
    doc.fillColor(col(o.skupaj)).text(String(o.skupaj), L + 20, boxY + 30, { lineBreak: false })
    doc.font(F.sans).fontSize(11).fillColor(MUTE).text('/ 100', L + 26 + numW, boxY + 55, { lineBreak: false })
    if (typeof o.potencial === 'number' && o.potencial > o.skupaj) {
      doc.font(F.sansB).fontSize(10).fillColor('#2e7d4f').text(`→  ${o.potencial} / 100`, L + 200, boxY + 44, { lineBreak: false })
      doc.font(F.sans).fontSize(8).fillColor(MUTE).text(t.potencial, L + 200, boxY + 58, { lineBreak: false })
    }
    let ay = boxY + 92
    for (const a of o.podrocja || []) {
      const oc = Math.max(0, Math.min(100, a.ocena | 0))
      doc.font(F.sansB).fontSize(9).fillColor(NAVY).text(a.naziv, L + 20, ay, { width: CW - 110, lineBreak: false })
      doc.font(F.sansB).fontSize(9).fillColor(col(oc)).text(String(oc), R - 40, ay, { lineBreak: false })
      doc.rect(L + 20, ay + 13, CW - 60, 4).fill('#efe9db')
      doc.rect(L + 20, ay + 13, (CW - 60) * oc / 100, 4).fill(col(oc))
      doc.font(F.sans).fontSize(7.5).fillColor(MUTE).text(a.komentar, L + 20, ay + 21, { width: CW - 60, height: 12, ellipsis: true })
      ay += 36
    }
    doc.y = boxY + boxH + 6
  }

  // ── prioritete (razvrščen seznam namesto matrike)
  const mat = (p.tveganja || []).filter(x => x.verjetnost && x.posledica)
  if (mat.length) {
    heading(t.matrix)
    const W = { velika: 3, srednja: 2, majhna: 1 }, P = { 'kritična': 3, resna: 2, blaga: 1 }
    const verMap = { velika: t.ver[0], srednja: t.ver[1], majhna: t.ver[2] }
    const posMap = { blaga: t.pos[0], resna: t.pos[1], 'kritična': t.pos[2] }
    const top = [...mat].sort((a, b) => (P[b.posledica] * 2 + W[b.verjetnost]) - (P[a.posledica] * 2 + W[a.verjetnost])).slice(0, 4)
    top.forEach((r, i) => {
      ensure(64)
      const y0 = doc.y
      doc.font(F.serif).fontSize(22).fillColor(GOLD).text(String(i + 1).padStart(2, '0'), L, y0, { lineBreak: false })
      doc.font(F.sansB).fontSize(10.5).fillColor(NAVY).text(r.naslov, L + 38, y0 + 2, { width: CW - 200 })
      doc.font(F.sans).fontSize(8.5).fillColor(INK).text(r.resitev, L + 38, doc.y + 3, { width: CW - 200, lineGap: 2 })
      const tagX = R - 138
      doc.font(F.sans).fontSize(6.5).fillColor(MUTE).text(t.mv.toUpperCase(), tagX, y0 + 2, { width: 138, characterSpacing: 1, lineBreak: false })
      doc.font(F.sansB).fontSize(8.5).fillColor(W[r.verjetnost] === 3 ? '#b3402a' : W[r.verjetnost] === 2 ? '#8a6c3c' : MUTE).text(verMap[r.verjetnost], tagX, y0 + 11, { lineBreak: false })
      doc.font(F.sans).fontSize(6.5).fillColor(MUTE).text(t.mp.toUpperCase(), tagX, y0 + 25, { width: 138, characterSpacing: 1, lineBreak: false })
      doc.font(F.sansB).fontSize(8.5).fillColor(P[r.posledica] === 3 ? '#b3402a' : P[r.posledica] === 2 ? '#8a6c3c' : MUTE).text(posMap[r.posledica], tagX, y0 + 34, { lineBreak: false })
      const yEnd = Math.max(doc.y, y0 + 46)
      doc.moveTo(L, yEnd + 6).lineTo(R, yEnd + 6).lineWidth(0.5).strokeColor(LINE).stroke()
      doc.y = yEnd + 14
    })
  }

  // ── tveganja
  if ((p.tveganja || []).length) {
    heading(t.risks)
    for (const r of p.tveganja) {
      ensure(74)
      const y0 = doc.y
      doc.font(F.sansB).fontSize(10.5).fillColor(NAVY).text(r.naslov, L + 14, y0, { width: CW - 90, continued: false })
      doc.font(F.sansB).fontSize(6.5).fillColor(GOLD).text((r.stopnja || '').toUpperCase(), R - 66, y0 + 2, { characterSpacing: 1 })
      doc.font(F.sans).fontSize(9).fillColor(INK).text(r.zakaj, L + 14, doc.y + 3, { width: CW - 28, lineGap: 2 })
      doc.font(F.sansB).fontSize(9).fillColor(NAVY).text(t.sol + ': ', L + 14, doc.y + 3, { continued: true, width: CW - 28 })
        .font(F.sans).fillColor(INK).text(r.resitev, { lineGap: 2 })
      if (r.vir) doc.font(F.sans).fontSize(7.5).fillColor(MUTE).text(`${t.vir}: ${r.vir}`, L + 14, doc.y + 2, { width: CW - 28, oblique: true })
      doc.moveTo(L, y0 - 6).lineTo(L, doc.y + 4).lineWidth(2).strokeColor(GOLD).stroke()
      doc.moveDown(0.9)
    }
  }

  // ── luknje
  if ((p.luknje || []).length) {
    heading(t.gaps)
    for (const g of p.luknje) {
      ensure(30)
      doc.circle(L + 4, doc.y + 5, 1.8).fill(GOLD)
      doc.font(F.sans).fontSize(9.5).fillColor(INK).text(g, L + 14, doc.y - 1, { width: CW - 14, lineGap: 2 })
      doc.moveDown(0.45)
    }
  }

  // ── priporocila
  if ((p.priporocila || []).length) {
    heading(t.recs)
    for (const rc of p.priporocila) {
      ensure(46)
      const y0 = doc.y
      doc.rect(L, y0 - 4, CW, 0).stroke()
      doc.font(F.sansB).fontSize(10).fillColor(NAVY).text(rc.produkt, L + 14, y0, { width: CW - 28 })
      doc.font(F.sans).fontSize(9).fillColor(INK).text(rc.razlog, L + 14, doc.y + 2, { width: CW - 28, lineGap: 2 })
      if (rc.vsota) doc.font(F.sansB).fontSize(8.5).fillColor('#8a6c3c').text(`${t.vsota}: ${rc.vsota}`, L + 14, doc.y + 2, { width: CW - 28 })
      if (rc.url && typeof rc.url === 'string') {
        const u = rc.url.startsWith('/') ? 'https://www.zav-skornsek.si' + rc.url : rc.url
        doc.font(F.sans).fontSize(7.5).fillColor(GOLD).text(u, L + 14, doc.y + 2, { link: u })
      }
      doc.moveDown(0.8)
    }
  }

  // ── vprasanja
  if ((p.vprasanja_za_posvet || []).length) {
    heading(t.qs)
    p.vprasanja_za_posvet.forEach((q, i) => {
      ensure(28)
      doc.font(F.serif).fontSize(10).fillColor(GOLD).text(String(i + 1).padStart(2, '0'), L, doc.y, { continued: false })
      doc.font(F.sans).fontSize(9.5).fillColor(INK).text(q, L + 24, doc.y - 12, { width: CW - 24, lineGap: 2 })
      doc.moveDown(0.5)
    })
  }

  // ── podpisni blok
  ensure(130)
  doc.moveDown(1.6)
  const sy = doc.y
  doc.font(F.sans).fontSize(9.5).fillColor(INK).text(t.regards, L, sy)
  let sigBottom = sy + 16
  try {
    if (fs.existsSync(PODPIS)) { doc.image(PODPIS, L, sy + 14, { height: 44 }); sigBottom = sy + 62 }
  } catch {}
  const nameY = sigBottom + 6
  doc.font(F.serifB).fontSize(11).fillColor(NAVY).text('Aljaž Skornšek', L, nameY, { lineBreak: false })
  doc.font(F.sans).fontSize(8).fillColor(MUTE).text(`${t.role2} · +386 31 544 416`, L, nameY + 17, { lineBreak: false })
  if (reportUrl) {
    doc.font(F.sans).fontSize(8).fillColor(GOLD).text(reportUrl, L, nameY + 40, { link: reportUrl, width: CW - 90 })
  }
  if (qrPng) {
    try {
      doc.image(qrPng, R - 66, nameY - 10, { width: 60 })
      doc.font(F.sans).fontSize(6.3).fillColor(MUTE).text(t.qr, R - 70, nameY + 53, { width: 68, align: 'center', lineBreak: false })
    } catch {}
  }

  // ── noga na vseh straneh
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const ob = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    const fy = doc.page.height - 46
    doc.moveTo(L, fy - 8).lineTo(R, fy - 8).lineWidth(0.5).strokeColor(LINE).stroke()
    doc.font(F.sans).fontSize(6.3).fillColor('#9ca3af').text(t.disclaimer, L, fy, { width: CW - 60, height: 28 })
    doc.font(F.sans).fontSize(7.5).fillColor(MUTE).text(`${t.page} ${i + 1}/${range.count}`, R - 52, fy, { width: 52, align: 'right', lineBreak: false })
    doc.page.margins.bottom = ob
  }

  doc.end()
  return done
}
