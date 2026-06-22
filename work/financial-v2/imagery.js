(function () {
  "use strict";

  var images = {
    mobility: "assets-new/mobility.jpg", home: "assets-new/home.jpg",
    health: "assets-new/health.jpg", people: "assets-new/people.jpg",
    travel: "assets-new/travel.jpg", legal: "assets-new/legal.jpg",
    business: "assets-new/business.jpg", cyber: "assets-new/cyber.jpg"
  };
  var imageMap = {
    vozila: images.mobility, dom: images.home, zdravje: images.health,
    zivljenje: images.people, nezgoda: images.health, potovanja: images.travel,
    odgovornost: images.legal, financna: images.business,
    premozenjePodjetja: images.business, vozilaPodjetja: images.mobility,
    odgovornostPodjetja: images.legal, zaposleni: images.people,
    poslovnaTveganja: images.business, kibernetska: images.cyber
  };

  Object.keys(imageMap).forEach(function (key) {
    if (allCats[key]) allCats[key].img = imageMap[key];
  });
  Object.keys(productDetails).forEach(function (key) {
    var product = productDetails[key];
    if (allCats[product.parent]) product.img = allCats[product.parent].img;
  });

  var originalAboutPage = aboutPage;
  aboutPage = function () {
    return originalAboutPage().replace(
      "https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1800&q=90",
      "assets-new/people.jpg"
    );
  };

  var originalSkodePage = skodePage;
  skodePage = function () {
    return originalSkodePage().replace(
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1800&q=90",
      "assets-new/legal.jpg"
    );
  };

  function markRoute() {
    document.body.setAttribute("data-route", (location.hash || "#home").slice(1));
  }
  window.addEventListener("hashchange", markRoute);
  markRoute();
  render();
})();
