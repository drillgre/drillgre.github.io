/* Shared DrillGRE navigation and learner identity */
(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";

  // Keep the canonical homepage clean: / rather than /index.html.
  if (window.location.pathname === "/index.html") {
    window.location.replace("/" + window.location.search + window.location.hash);
    return;
  }

  const toggle = document.querySelector("[data-site-nav-toggle]");
  const links = document.querySelector("[data-site-nav-links]");

  // Native <details> state can be restored when users return through browser
  // history. Keep the Quant menu closed on page entry and after navigation.
  const navDropdowns = [...document.querySelectorAll(".drillgre-nav-dropdown")];
  const closeDropdowns = () => navDropdowns.forEach(dropdown => { dropdown.open = false; });
  closeDropdowns();
  window.addEventListener("pageshow", closeDropdowns);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeDropdowns();
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".drillgre-nav-dropdown")) closeDropdowns();
  });

  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const isOpen = links.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
      toggle.textContent = isOpen ? "×" : "☰";
    });
    links.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", () => {
        closeDropdowns();
        links.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open navigation");
        toggle.textContent = "☰";
      });
    });
  }

  const accountLink = document.querySelector("[data-site-auth-link]");
  if (!accountLink) return;

  function firstNameFrom(value, fallback) {
    const name = String(value || "").trim();
    if (name) return name.split(/\s+/)[0];
    const email = String(fallback || "");
    return email.includes("@") ? email.split("@")[0] : "Learner";
  }

  function displaySignedOut() {
    accountLink.textContent = "Login / Sign up";
    accountLink.href = "/account.html";
    accountLink.removeAttribute("data-signed-in");
    accountLink.setAttribute("aria-label", "Login or sign up");
  }

  function displaySignedIn(name, isAdmin = false) {
    accountLink.textContent = name;
    accountLink.href = isAdmin ? "/admin.html" : "/dashboard.html";
    accountLink.dataset.signedIn = "true";
    accountLink.setAttribute("aria-label", isAdmin ? name + "'s admin workspace" : name + "'s learner dashboard");
    accountLink.title = isAdmin ? "Open admin workspace" : "Open learner dashboard";
  }

  function startAuth() {
    if (!window.supabase?.createClient) {
      displaySignedOut();
      return;
    }

    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    async function updateAccountLink(session) {
      if (!session?.user) {
        displaySignedOut();
        return;
      }

      const user = session.user;
      let name = user.user_metadata?.name || user.user_metadata?.full_name || "";
      let isAdmin = false;
      try {
        const { data } = await db
          .from("profiles")
          .select("name, role")
          .eq("id", user.id)
          .maybeSingle();
        if (data?.name) name = data.name;
        isAdmin = data?.role === "admin";
      } catch (_) {
        // Metadata or email provides a useful fallback if the profile query
        // is unavailable on a page or before the profile migration is run.
      }
      displaySignedIn(firstNameFrom(name, user.email), isAdmin);
    }

    db.auth.getSession()
      .then(({ data, error }) => {
        if (error) displaySignedOut();
        else updateAccountLink(data?.session);
      })
      .catch(displaySignedOut);

    db.auth.onAuthStateChange((_event, session) => {
      // Defer the profile lookup until Supabase has completed its auth callback.
      Promise.resolve().then(() => updateAccountLink(session));
    });
  }

  if (window.supabase?.createClient) {
    startAuth();
  } else {
    const loader = document.createElement("script");
    loader.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    loader.onload = startAuth;
    loader.onerror = displaySignedOut;
    document.head.appendChild(loader);
  }
})();
