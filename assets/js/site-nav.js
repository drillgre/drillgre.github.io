/* Shared DrillGRE navigation and learner identity */
(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";

  function initializePageLoader() {
    if (!document.body || document.querySelector(".drillgre-page-loader")) return;

    const loader = document.createElement("div");
    loader.className = "drillgre-page-loader";
    loader.setAttribute("role", "status");
    loader.setAttribute("aria-live", "polite");
    loader.setAttribute("aria-label", "Loading DrillGRE");
    loader.innerHTML = `
      <div class="drillgre-loader-content">
        <div class="drillgre-loader-mark" aria-hidden="true">
          <div class="drillgre-loader-ring"></div>
          <div class="drillgre-loader-orbit"></div>
          <div class="drillgre-loader-core">D</div>
        </div>
        <div class="drillgre-loader-brand">Drill<span>GRE</span></div>
        <div class="drillgre-loader-note">Loading your learning space</div>
      </div>`;
    document.body.prepend(loader);

    const startedAt = Date.now();
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      const minimumDisplay = 420;
      const delay = Math.max(0, minimumDisplay - (Date.now() - startedAt));
      window.setTimeout(() => {
        loader.classList.add("is-hidden");
        loader.setAttribute("aria-hidden", "true");
        window.setTimeout(() => loader.remove(), 320);
      }, delay);
    };

    if (document.readyState === "complete") dismiss();
    else window.addEventListener("load", dismiss, { once: true });

    // Do not let a slow third-party asset keep the page covered indefinitely.
    window.setTimeout(dismiss, 10000);
    window.addEventListener("pageshow", event => {
      if (event.persisted) dismiss();
    }, { once: true });
  }

  // Start the global loading indicator before navigation work begins.
  initializePageLoader();

  // Keep the canonical homepage clean: / rather than /index.html.
  if (window.location.pathname === "/index.html") {
    window.location.replace("/" + window.location.search + window.location.hash);
    return;
  }

  const toggle = document.querySelector("[data-site-nav-toggle]");
  const links = document.querySelector("[data-site-nav-links]");

  // Convert the Vocab Mountain link into the shared Verbal dropdown.
  const vocabLink = document.querySelector('.drillgre-nav-links a[href="/vocab.html"]');
  if (vocabLink && !vocabLink.closest(".drillgre-verbal-dropdown")) {
    const verbalMenu = document.createElement("details");
    verbalMenu.className = "drillgre-nav-dropdown drillgre-verbal-dropdown";
    const summary = document.createElement("summary");
    summary.textContent = "Verbal";
    const submenu = document.createElement("div");
    submenu.className = "drillgre-nav-submenu";
    const vocabItem = document.createElement("a");
    vocabItem.href = "/vocab.html";
    vocabItem.textContent = "Vocab Mountain";
    const archeryItem = document.createElement("a");
    archeryItem.href = "/word-archery.html";
    archeryItem.textContent = "Word Archery";
    const currentPath = window.location.pathname.endsWith("/")
      ? window.location.pathname.slice(0,-1)
      : window.location.pathname;
    if (currentPath === "/vocab.html") vocabItem.setAttribute("aria-current","page");
    if (currentPath === "/word-archery.html") archeryItem.setAttribute("aria-current","page");
    submenu.append(vocabItem,archeryItem);
    verbalMenu.append(summary,submenu);
    vocabLink.replaceWith(verbalMenu);
  }

  // Close both Quant and Verbal menus on page entry and after navigation.
  const navDropdowns = [...document.querySelectorAll(".drillgre-nav-dropdown")];
  const closeDropdowns = () => navDropdowns.forEach(dropdown => { dropdown.open = false; });
  const hoverCapable = window.matchMedia("(hover: hover) and (pointer: fine)");

  // Desktop: open on hover and close as soon as the pointer leaves the
  // complete dropdown area. Keyboard focus receives the same treatment.
  navDropdowns.forEach(dropdown => {
    dropdown.addEventListener("pointerenter", () => {
      if (hoverCapable.matches) dropdown.open = true;
    });
    dropdown.addEventListener("pointerleave", () => {
      if (hoverCapable.matches && !dropdown.matches(":focus-within")) {
        dropdown.open = false;
      }
    });
    dropdown.addEventListener("focusin", () => {
      if (hoverCapable.matches) dropdown.open = true;
    });
    dropdown.addEventListener("focusout", event => {
      if (hoverCapable.matches && !dropdown.contains(event.relatedTarget)) {
        dropdown.open = false;
      }
    });
  });

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
