(function () {
  "use strict";

  function serviceIndex(data) {
    return Object.entries(data).map(function (entry, index) {
      var key = entry[0];
      var cat = entry[1];
      return '<a class="service-row" href="#' + key + '">' +
        '<span class="service-number">' + String(index + 1).padStart(2, "0") + '</span>' +
        '<span class="service-symbol">' + cat.icon + '</span>' +
        '<span class="service-copy"><strong>' + cat.title + '</strong><small>' + cat.text + '</small></span>' +
        '<span class="service-arrow">↗</span></a>';
    }).join("");
  }

  home = function () {
    return '<section class="hero hero-advisory">' +
      '<div class="hero-media" aria-hidden="true"></div>' +
      '<div class="container hero-advisory-grid">' +
        '<div class="hero-intro"><div class="eyebrow">● Premium zavarovalno svetovanje</div>' +
        '<h1>Vsa zavarovanja na enem mestu.</h1>' +
        '<p>Zavarovanje Skornšek združuje osebni pristop, pregledno strukturo zavarovanj in premium uporabniško izkušnjo za zasebne uporabnike in podjetja.</p>' +
        '<div class="actions"><a class="btn btn-primary" href="#kontakt">Pošljite povpraševanje →</a><a class="btn btn-secondary" href="#razdelki">Oglejte si zavarovanja</a></div></div>' +
        '<aside class="hero-trust"><div class="trust-rule"></div><span>Premium pristop</span><strong>Jasna zaščita. Osebni pristop.</strong>' +
        '<div class="trust-list"><div><b>01</b><span>zasebni uporabniki</span></div><div><b>02</b><span>podjetja</span></div><div><b>03</b><span>osebno svetovanje</span></div></div></aside>' +
      '</div></section>' +
      '<section class="light audience-section" id="razdelki"><div class="container">' +
        '<div class="audience-heading"><div><div class="kicker">Razdelki</div><h2 class="section-title">Pregledna izbira zavarovanj.</h2></div><p class="section-text">Hitro izberite področje zavarovanja in odprite podrobne informacije o posameznem produktu.</p></div>' +
        '<div class="audience-editorial">' +
          '<a class="audience-panel audience-private" href="#zasebni"><span>Za posameznike in družine</span><div><b>01</b><h3>Zasebni uporabniki</h3><p>Vozila, dom, zdravje, življenje, nezgoda, potovanja, odgovornost in finančna zaščita.</p></div><em>Raziščite področje ↗</em></a>' +
          '<a class="audience-panel audience-business" href="#podjetja"><span>Za podjetnike in podjetja</span><div><b>02</b><h3>Podjetja</h3><p>Premoženje podjetja, vozila, odgovornost, zaposleni, poslovna tveganja in kibernetska zaščita.</p></div><em>Raziščite področje ↗</em></a>' +
        '</div></div></section>' + whySection() + processSection() + testimonialsSection() + contactSection();
  };

  groupPage = function (type) {
    var data = type === "zasebni" ? privateCats : businessCats;
    var title = type === "zasebni" ? "Zasebni uporabniki" : "Podjetja";
    var image = type === "zasebni" ? "assets-new/people.jpg" : "assets-new/business.jpg";
    return '<section class="page-hero page-hero-index" style="--page-image:url(\'' + image + '\')"><div class="container">' +
      '<a class="back" href="#home">← Nazaj na domov</a><div class="eyebrow">● ' + title + '</div><h1>' + title + '</h1>' +
      '<p class="section-text">Izberite kategorijo zavarovanja. Vsaka kategorija se odpre kot svoja stran s podrobnim opisom, prednostmi in kontaktom.</p></div></section>' +
      '<section class="light service-ledger"><div class="container"><div class="ledger-head"><div><div class="kicker">Kategorije</div><h2 class="section-title">Izberite področje zavarovanja.</h2></div><span>' + String(Object.keys(data).length).padStart(2, "0") + ' področij</span></div>' +
      '<div class="service-index">' + serviceIndex(data) + '</div></div></section>' + contactSection();
  };

  categoryPage = function (key) {
    var cat = allCats[key];
    var back = privateCats[key] ? "zasebni" : "podjetja";
    var products = productBreakdowns[key] || [];
    var productRows = products.map(function (item, index) {
      return '<a class="product-row" href="#' + item[0] + '"><span>' + String(index + 1).padStart(2, "0") + '</span><h3>' + item[1] + '</h3><p>' + item[2] + '</p><b>Odpri stran →</b></a>';
    }).join("");
    return '<section class="page-hero product-hero" style="--page-image:url(\'' + cat.img + '\')"><div class="container">' +
      '<a class="back" href="#' + back + '">← Nazaj</a><div class="eyebrow">' + cat.icon + ' Zavarovanje</div><h1>' + cat.title + '</h1><p class="section-text">' + cat.text + '</p>' +
      '<div class="actions"><a class="btn btn-primary" href="#kontakt">Povpraševanje za ' + cat.title + ' →</a></div></div></section>' +
      (products.length ? '<section class="light product-ledger"><div class="container"><div class="ledger-head"><div><div class="kicker">Razčlenitev</div><h2 class="section-title">' + cat.title + ' — ožje kategorije zavarovanja.</h2><p class="section-text">Kliknite posamezno možnost. Vsaka se odpre kot nova stran s podrobnejšim opisom, prednostmi in pozivom k posvetu.</p></div><span>' + String(products.length).padStart(2, "0") + ' možnosti</span></div><div class="product-index">' + productRows + '</div></div></section>' : '') +
      '<section class="light advisory-detail"><div class="container advisory-layout"><div class="advisory-sticky"><div class="kicker">Podroben opis</div><h2 class="section-title">' + cat.title + ' po meri vaših potreb.</h2><p class="section-text">Pri izbiri zavarovanja ni pomembna samo cena, ampak predvsem pravilno razumevanje kritij, omejitev, izključitev in realnih tveganj. Zato se rešitev pripravi po pogovoru in pregledu vašega stanja.</p></div>' +
      '<div class="advisory-visual"><img class="detail-img" src="' + cat.img + '" alt="' + cat.title + '"><div class="benefit-ledger">' + cat.benefits.map(function (item, i) { return '<div><span>' + String(i + 1).padStart(2, "0") + '</span><p><strong>' + item + '</strong><small>Jasna razlaga in osebno svetovanje pred sklenitvijo.</small></p></div>'; }).join("") + '</div></div></div></section>' +
      processSection() + contactSection();
  };

  productPage = function (key) {
    var p = productDetails[key];
    return '<section class="page-hero product-hero" style="--page-image:url(\'' + p.img + '\')"><div class="container">' +
      '<a class="back" href="#' + p.parent + '">← Nazaj na ' + p.categoryTitle + '</a><div class="eyebrow">' + p.icon + ' ' + p.categoryTitle + '</div><h1>' + p.title + '</h1><p class="section-text">' + p.intro + '</p><div class="actions"><a class="btn btn-primary" href="#kontakt">Povpraševanje za ' + p.title + ' →</a></div></div></section>' +
      '<section class="light product-story"><div class="container story-grid"><div class="story-title"><div class="kicker">Opis produkta</div><h2 class="section-title">' + p.title + '</h2></div><div class="story-copy">' + p.sections.map(function (text) { return '<p class="section-text">' + text + '</p>'; }).join("") + '</div>' +
      '<figure><img class="detail-img" src="' + p.img + '" alt="' + p.title + '"></figure><div class="benefit-ledger">' + p.benefits.map(function (item, i) { return '<div><span>' + String(i + 1).padStart(2, "0") + '</span><p><strong>' + item + '</strong><small>Pred sklenitvijo se preveri, ali je kritje primerno za vaš primer.</small></p></div>'; }).join("") + '</div></div></section>' +
      '<section class="light closing-note"><div class="container"><div class="kicker">Informacije</div><h2 class="section-title">Kaj vključuje produkt?</h2><p class="section-text">Obseg kritij je odvisen od izbranega paketa, dodatnih kritij in področja uporabe zavarovanja.</p><div class="actions"><a class="btn btn-primary" href="#kontakt">Kontakt za ' + p.title + ' →</a></div></div></section>' + contactSection();
  };

  render();
})();
