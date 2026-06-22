(function () {
  "use strict";

  var header = document.querySelector("header");
  var menuButton = document.querySelector(".mobile-toggle");
  var mobileMenu = document.getElementById("mobileMenu");

  if (menuButton) {
    menuButton.setAttribute("aria-label", "Odpri glavni meni");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.addEventListener("click", function () {
      var open = mobileMenu && mobileMenu.classList.contains("show");
      menuButton.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    });
  }

  function updateHeader() {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 20);
  }

  function updateNavigation() {
    var route = (location.hash || "#home").slice(1);
    document.querySelectorAll(".desktop-menu a, .mobile-menu a").forEach(function (link) {
      link.removeAttribute("aria-current");
      if (link.getAttribute("href") === "#" + route) link.setAttribute("aria-current", "page");
    });
    if (menuButton) menuButton.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  var routeFixes = {
    "#financna-zascita": "#financna",
    "#premozenje-podjetja": "#premozenjePodjetja",
    "#vozila-podjetja": "#vozilaPodjetja",
    "#odgovornost-podjetja": "#odgovornostPodjetja",
    "#kibernetska-zascita": "#kibernetska",
    "#financne-izgube": "#poslovnaTveganja"
  };

  document.querySelectorAll("#mobileMenu a").forEach(function (link) {
    var href = link.getAttribute("href");
    if (routeFixes[href]) link.setAttribute("href", routeFixes[href]);
  });

  document.addEventListener("click", function (event) {
    var anchor = event.target.closest && event.target.closest("a[href^='#']");
    if (!anchor) return;
    document.querySelectorAll("details.dropdown").forEach(function (item) { item.open = false; });
  });

  window.addEventListener("scroll", updateHeader, { passive: true });
  window.addEventListener("hashchange", updateNavigation);
  updateHeader();
  updateNavigation();
})();
