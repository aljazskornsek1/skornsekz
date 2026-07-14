// Deterministični točkovnik za analizo zavarovalnih potreb.
// Vsako področje dobi IZPOSTAVLJENOST (0..1+, koliko je za ta profil pomembno)
// in POKRITOST (0..1, koliko jo obstoječa zavarovanja pokrivajo).
// Ocena področja = 100 * pokritost, omejena na [5, 95] — nikoli 0 in nikoli "popolno".
// Skupna ocena = povprečje področij, tehtano z izpostavljenostjo.
// Vse meje in uteži so namerno v kodi, da jih je mogoče ročno kalibrirati.

const ima = (arr, x) => Array.isArray(arr) && arr.includes(x)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export function izracunajOceno(p) {
  const obst = Array.isArray(p.obstojeca) ? p.obstojeca : []
  const vozila = Array.isArray(p.vozila) ? p.vozila : []
  const posebnosti = Array.isArray(p.dom_posebnosti) ? p.dom_posebnosti : []
  const tveganjaDoma = Array.isArray(p.dom_tveganja) ? p.dom_tveganja : []
  const otrociStarost = Array.isArray(p.otroci_starost) ? p.otroci_starost : []
  const jeSp = p.zaposlitev === 's.p. ali podjetnik'
  const jeUpokojen = p.zaposlitev === 'upokojen'
  const imaOtroke = p.status === 'družina z otroki'
  const podrocja = []

  // ── 1. Dom in premoženje ────────────────────────────────────────────────
  {
    let izp = p.bivanje === 'lastnik hiše' ? 1.0 : p.bivanje === 'lastnik stanovanja' ? 0.8 : 0.4
    if (p.vrednost_nepremicnine === 'nad 300.000 €') izp += 0.15
    if (posebnosti.some(x => x !== 'nič od naštetega')) izp += 0.1
    if (tveganjaDoma.some(x => x !== 'nič od naštetega')) izp += 0.15
    const razlogi = []
    let pok
    if (ima(obst, 'zavarovanje doma')) {
      pok = 0.72
      razlogi.push('Zavarovanje doma obstaja.')
      if (ima(posebnosti, 'sončna elektrarna')) { pok -= 0.12; razlogi.push('Sončna elektrarna pogosto ni samodejno krita — preveriti dogovor.') }
      if (ima(posebnosti, 'dragocena oprema')) { pok -= 0.08; razlogi.push('Dragocena oprema običajno zahteva dodatno kritje.') }
      if (ima(tveganjaDoma, 'bližina vodotoka ali poplavno območje')) { pok -= 0.12; razlogi.push('Poplavno kritje pri osnovni polici pogosto omejeno.') }
      if (ima(tveganjaDoma, 'klet ali pritličje')) { pok -= 0.05; razlogi.push('Izpostavljenost izlivu/poplavi (klet ali pritličje).') }
    } else {
      pok = p.bivanje === 'najemnik' ? 0.18 : 0.08
      razlogi.push(p.bivanje === 'najemnik' ? 'Oprema in odgovornost najemnika nista zavarovani.' : 'Nepremičnina ni zavarovana.')
    }
    podrocja.push({ naziv: 'Dom in premoženje', izp: clamp(izp, 0.2, 1.3), pok: clamp(pok, 0, 1), razlogi, fiksOb: 0.85 })
  }

  // ── 2. Vozila in mobilnost ──────────────────────────────────────────────
  if (vozila.length && !ima(vozila, 'nimam vozila')) {
    let izp = 0.6
    if (p.vrednost_vozila === '15.000–30.000 €') izp = 0.85
    if (p.vrednost_vozila === 'nad 30.000 €') izp = 1.0
    if (ima(vozila, 'dva ali več avtov')) izp += 0.1
    if (p.mladi_voznik === 'da') izp += 0.15
    const razlogi = []
    let pok = 0
    if (ima(obst, 'avtomobilska odgovornost (AO)')) { pok += 0.42; razlogi.push('AO krije škodo drugim, ne vašega vozila.') }
    else razlogi.push('AO ni označen — preveriti osnovno kritje.')
    const dragoVozilo = p.vrednost_vozila === '15.000–30.000 €' || p.vrednost_vozila === 'nad 30.000 €'
    if (ima(obst, 'kasko')) { pok += dragoVozilo ? 0.42 : 0.3; razlogi.push('Kasko krije lastno vozilo.') }
    else if (dragoVozilo) razlogi.push('Vozilo večje vrednosti brez kaska — škodo na lastnem vozilu krijete sami.')
    else { pok += 0.18; razlogi.push('Pri vozilu manjše vrednosti je kasko manj kritičen.') }
    if (p.mladi_voznik === 'da' && !ima(obst, 'kasko')) razlogi.push('Mladi voznik statistično poveča verjetnost škode.')
    podrocja.push({ naziv: 'Vozila in mobilnost', izp: clamp(izp, 0.3, 1.25), pok: clamp(pok, 0, 1), razlogi, fiksOb: 0.88 })
  }

  // ── 3. Življenje in dohodek ─────────────────────────────────────────────
  {
    let izp = 0.35
    if (p.kredit === 'stanovanjski kredit' || p.kredit === 'oba') izp += 0.3
    if (p.kredit === 'potrošniški kredit') izp += 0.15
    if (p.kredit_znesek === 'nad 150.000 €') izp += 0.1
    if (imaOtroke) izp += 0.2
    if (p.dohodek === 'moj dohodek je edini') izp += 0.2
    if (p.rezerva === 'manj kot 3 mesece') izp += 0.12
    if (jeSp && p.sp_izpad === 'stoji — vse je na meni') izp += 0.15
    if (jeUpokojen && p.kredit === 'brez kredita') izp = 0.15
    const razlogi = []
    let pok
    const imaKredit = p.kredit && p.kredit !== 'brez kredita'
    if (ima(obst, 'življenjsko')) {
      const v = p.zivljenjsko_vsota
      pok = v === 'nad 100.000 €' ? 0.82 : v === '50.000–100.000 €' ? 0.6 : v === 'pod 50.000 €' ? 0.38 : 0.5
      razlogi.push('Življenjsko zavarovanje obstaja' + (v && v !== 'ne vem' ? ` (vsota ${v}).` : ', vsota ni znana.'))
      if (imaKredit && (v === 'pod 50.000 €') && p.kredit_znesek && p.kredit_znesek !== 'do 50.000 €') { pok -= 0.1; razlogi.push('Vsota verjetno ne pokrije ostanka kredita.') }
    } else {
      pok = jeUpokojen && !imaKredit ? 0.6 : 0.1
      if (imaKredit) razlogi.push('Kredit ni zavarovan — ob najhujšem breme pade na družino.')
      else if (!jeUpokojen) razlogi.push('Ni zaščite dohodka za svojce.')
    }
    if (ima(obst, 'naložbeno ali pokojninsko')) { pok = clamp(pok + 0.12, 0, 1); razlogi.push('Naložbeno/pokojninsko delno blaži dolgoročni izpad.') }
    if (p.rezerva === 'več kot 6 mesecev') { pok = clamp(pok + 0.08, 0, 1); razlogi.push('Solidna finančna rezerva.') }
    podrocja.push({ naziv: 'Življenje in dohodek', izp: clamp(izp, 0.15, 1.35), pok: clamp(pok, 0, 1), razlogi, fiksOb: 0.85 })
  }

  // ── 4. Zdravje in nezgode ───────────────────────────────────────────────
  {
    let izp = 0.5
    if (imaOtroke && p.otroci_zascita !== 'da') izp += 0.2
    if (p.sport === 'tekmovalno / ekstremni športi') izp += 0.25
    else if (p.sport === 'rekreativno') izp += 0.08
    if (p.starost === '61 let ali več') izp += 0.12
    if (jeSp) izp += 0.12
    const razlogi = []
    let pok = 0
    if (ima(obst, 'nezgodno')) { pok += 0.35; razlogi.push('Nezgodno zavarovanje obstaja.') }
    if (ima(obst, 'dopolnilno zdravstveno')) { pok += 0.2; razlogi.push('Dopolnilno zdravstveno krije doplačila.') }
    if (ima(obst, 'nadstandardno zdravstveno')) { pok += 0.2; razlogi.push('Nadstandardno krajša čakalne dobe.') }
    if (imaOtroke) {
      if (p.otroci_zascita === 'da') { pok += 0.12; razlogi.push('Otroci imajo nezgodno kritje.') }
      else razlogi.push('Otroci brez lastnega nezgodnega kritja.')
    }
    if (p.sport === 'tekmovalno / ekstremni športi') razlogi.push('Tekmovalni šport pogosto zahteva razširjeno nezgodno kritje.')
    podrocja.push({ naziv: 'Zdravje in nezgode', izp: clamp(izp, 0.4, 1.2), pok: clamp(pok, 0, 0.92), razlogi, fiksOb: 0.85 })
  }

  // ── 5. Odgovornost ──────────────────────────────────────────────────────
  {
    let izp = 0.3
    if (p.bivanje === 'lastnik hiše') izp += 0.18
    if (imaOtroke) izp += 0.18
    if (p.ljubljencki === 'pes' || p.ljubljencki === 'pes in mačka ali drugo') izp += 0.18
    if (jeSp) izp += 0.15
    const razlogi = []
    let pok
    if (ima(obst, 'zavarovanje odgovornosti')) { pok = 0.8; razlogi.push('Zasebna odgovornost je zavarovana.') }
    else if (ima(obst, 'zavarovanje doma')) { pok = 0.3; razlogi.push('Paketi doma pogosto vključujejo osnovno odgovornost — preveriti obseg.') }
    else { pok = 0.08; razlogi.push('Zasebna odgovornost ni zavarovana.') }
    if (jeSp) {
      if (p.sp_odgovornost === 'da') { pok = clamp(pok + 0.12, 0, 1); razlogi.push('Odgovornost dejavnosti urejena.') }
      else razlogi.push('Odgovornost iz dejavnosti (s.p.) ni potrjena.')
    }
    podrocja.push({ naziv: 'Odgovornost', izp: clamp(izp, 0.25, 1.1), pok: clamp(pok, 0, 1), razlogi, fiksOb: 0.85 })
  }

  // ── 6. Potovanja in prosti čas ──────────────────────────────────────────
  if (p.potovanja === '1–2× letno' || p.potovanja === 'večkrat letno') {
    const izp = p.potovanja === 'večkrat letno' ? 0.7 : 0.45
    const razlogi = []
    let pok
    if (ima(obst, 'letno potovalno zavarovanje')) { pok = 0.85; razlogi.push('Letno potovalno zavarovanje obstaja.') }
    else { pok = 0.12; razlogi.push('Potovanja v tujino brez stalnega zdravstvenega kritja.') }
    podrocja.push({ naziv: 'Potovanja in prosti čas', izp, pok: clamp(pok, 0, 1), razlogi, fiksOb: 0.85 })
  }

  // ── agregacija ──────────────────────────────────────────────────────────
  // Nizka izpostavljenost omili manko kritja: česar ne potrebuješ zares,
  // te ne dela "nezaščitenega" (relief = polovica manjkajočega × (1 − izp)).
  const out = podrocja.map(a => {
    const relief = Math.max(0, 1 - a.izp) * 0.5
    const eff = a.pok + (1 - a.pok) * relief
    return {
      naziv: a.naziv,
      ocena: Math.round(clamp(eff * 100, 5, 95)),
      utez: a.izp,
      razlogi: a.razlogi,
      fiksOb: a.fiksOb,
    }
  })
  const sumU = out.reduce((s, a) => s + a.utez, 0) || 1
  const skupaj = Math.round(out.reduce((s, a) => s + a.ocena * a.utez, 0) / sumU)
  // potencial: področja pod 70 po ureditvi priporočil dosežejo fiksOb (85–88 %)
  const potencial = Math.round(out.reduce((s, a) => s + Math.max(a.ocena, a.fiksOb * 100) * a.utez, 0) / sumU)

  return {
    skupaj: clamp(skupaj, 5, 95),
    potencial: clamp(Math.max(potencial, skupaj), 5, 95),
    podrocja: out.map(({ naziv, ocena, razlogi }) => ({ naziv, ocena, razlogi })),
  }
}
