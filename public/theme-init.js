// Theme bootstrap: runs synchronously in <head> before first paint to avoid a
// flash of the wrong theme. Kept as a separate file (not inline) so the CSP
// can stay `script-src 'self'` in both dev and production.
(function () {
  var t = localStorage.getItem("lang-agent-theme") || "system";
  var dark =
    t === "dark" ||
    (t === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
  var a = localStorage.getItem("lang-agent-accent") || "gray";
  document.documentElement.setAttribute("data-accent", a);
})();
