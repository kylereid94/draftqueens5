(() => {
  const Q = new URLSearchParams(location.search);
  let league = Q.get("league");

  // Fallbacks: remember last league for this tab/session
  if (!league) league = sessionStorage.getItem("league");
  if (!league) {
    const ref = document.referrer ? new URL(document.referrer) : null;
    if (ref) league = new URLSearchParams(ref.search).get("league");
  }

  // If we found one, persist + normalize URL (keeps other params intact)
  if (league) {
    sessionStorage.setItem("league", league);

    // Normalize current URL to include league (no page reload)
    if (!Q.get("league")) {
      Q.set("league", league);
      const newUrl =
        location.pathname + "?" + Q.toString() + location.hash;
      window.history.replaceState({}, "", newUrl);
    }
  }

  // Utility to append/merge ?league= to an href
  function withLeague(href) {
    try {
      const url = new URL(href, location.origin);
      if (league) url.searchParams.set("league", league);
      return url.pathname + "?" + url.searchParams.toString() + url.hash;
    } catch {
      // relative without domain
      const [path, qs = "", hash = ""] = href.split(/[\?#]/);
      const sp = new URLSearchParams(qs);
      if (league) sp.set("league", league);
      return path + "?" + sp.toString() + (href.includes("#") ? "#" + hash : "");
    }
  }

  // Re-link any anchors that should keep the league context
  // A) Opt-in (preferred): add data-keep-league to anchors in your subnavs/buttons
  document.querySelectorAll('a[data-keep-league]').forEach(a => {
    a.href = withLeague(a.getAttribute('href') || "#");
  });

  // B) Auto-patch common league routes (helps today without editing markup)
  const leaguePages = [
    "/pages/overview.html",
    "/pages/roster.html",
    "/pages/scoreboard.html",
    "/pages/trade.html",
    "/pages/settings.html",
    "/pages/queen-details.html",
    "/pages/member-details.html",
  ];
  document.querySelectorAll("a[href]").forEach(a => {
    const href = a.getAttribute("href");
    if (!href) return;
    // Skip external or hash
    if (/^https?:\/\//i.test(href) || href.startsWith("#")) return;
    // If link targets a known league page and doesn’t already have league=...
    if (leaguePages.some(p => href.startsWith(p))) {
      const hasLeague = /\bleague=/.test(href);
      if (!hasLeague) a.href = withLeague(href);
    }
  });

  // Optional: expose getter for other scripts
  window.getCurrentLeagueId = () => league;
})();