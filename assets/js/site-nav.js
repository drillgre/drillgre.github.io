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
  // Render one shared footer across the entire platform.
  const existingFooter = document.querySelector("footer");
  const sharedFooter = document.createElement("footer");
  sharedFooter.className = "drillgre-site-footer";
  sharedFooter.innerHTML = `
    <div class="drillgre-footer-shell">
      <div class="drillgre-footer-main">
        <div class="drillgre-footer-brand">
          <a class="drillgre-footer-logo" href="/" aria-label="DrillGRE home"><span class="drillgre-footer-mark">D</span><span>Drill<span>GRE</span></span></a>
          <p>Learn with intention. Practise with purpose. Make every question count.</p>
        </div>
        <div class="drillgre-footer-column">
          <h3>Explore</h3>
          <a href="/quant/index.html">Quant Lessons</a>
          <a href="/quant/question-bank.html">Question Bank</a>
          <a href="/quant/quiz.html">Topic Quizzes</a>
          <a href="/quant/mock.html">Mock Tests</a>
        </div>
        <div class="drillgre-footer-column">
          <h3>More</h3>
          <a href="/vocab.html">Vocab Mountain</a>
          <a href="/leaderboard.html">Leaderboard</a>
          <a href="/contact.html">Contact Us</a>
          <a href="/faq.html">FAQs</a>
          <a href="/privacy.html">Privacy Policy</a>
          <a href="/account.html">Learner Account</a>
        </div>
      </div>
      <div class="drillgre-footer-bottom">
        <span>© ${new Date().getFullYear()} DrillGRE. All rights reserved.</span>
        <span>Focused GRE preparation. Meaningful practice.</span>
      </div>
    </div>`;
  if (existingFooter) existingFooter.replaceWith(sharedFooter);
  else document.body.appendChild(sharedFooter);

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
    const header = document.querySelector(".drillgre-site-header");
    const shell = document.querySelector(".drillgre-nav-shell");
    const actions = document.querySelector(".drillgre-nav-actions");
    const mobileNav = window.matchMedia("(max-width: 820px)");

    function applyNavigationLayout() {
      const mobile = mobileNav.matches;
      if (mobile) {
        header.style.position = "relative";
        shell.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) 44px;grid-template-areas:'brand toggle' 'actions actions' 'links links';gap:0 12px;width:calc(100% - 32px);min-height:0;padding:12px 0;margin:0 auto";
        const brand = shell.querySelector(".drillgre-brand");
        brand.style.gridArea = "brand";
        toggle.style.cssText = "grid-area:toggle;display:grid;place-items:center;width:42px;height:42px;border:1px solid #dce3f0;border-radius:10px;background:#fff;color:#101a35;font-size:21px;cursor:pointer";
        actions.style.cssText = "grid-area:actions;display:flex;justify-content:flex-start;flex-wrap:wrap;margin:10px 0 0;gap:9px";
        links.style.cssText = "grid-area:links;display:none;width:100%;box-sizing:border-box;padding:10px 0 4px;margin:10px 0 0;border-top:1px solid #e7ebf3;flex-direction:column;align-items:stretch;gap:0;background:transparent";
        links.querySelectorAll(":scope > a, :scope > details").forEach(item => {
          item.style.display = "block";
          item.style.width = "100%";
          item.style.padding = "10px 5px";
        });
        links.querySelectorAll("details > summary").forEach(item => {
          item.style.display = "flex";
          item.style.justifyContent = "space-between";
          item.style.padding = "8px 0";
        });
        toggle.hidden = false;
        toggle.style.display = "grid";
      } else {
        header.style.removeProperty("position");
        shell.removeAttribute("style");
        actions.removeAttribute("style");
        links.removeAttribute("style");
        shell.querySelector(".drillgre-brand").removeAttribute("style");
        toggle.removeAttribute("style");
        toggle.hidden = true;
        links.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open navigation");
        toggle.textContent = "☰";
      }
    }

    function closeMobileMenu() {
      if (!mobileNav.matches) return;
      links.style.display = "none";
      links.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation");
      toggle.textContent = "☰";
    }

    applyNavigationLayout();
    if (mobileNav.addEventListener) mobileNav.addEventListener("change", applyNavigationLayout);
    else window.addEventListener("resize", applyNavigationLayout);

    toggle.addEventListener("click", () => {
      const isOpen = toggle.getAttribute("aria-expanded") !== "true";
      links.style.display = isOpen ? "flex" : "none";
      links.classList.toggle("is-open", isOpen);
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
      toggle.textContent = isOpen ? "×" : "☰";
    });
    links.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", () => {
        closeDropdowns();
        closeMobileMenu();
      });
    });
  }


  // Load the site-wide guided tour on every public platform page.
  if (!document.querySelector('script[data-site-tour]')) {
    const tourScript = document.createElement("script");
    tourScript.src = "/assets/js/site-tour.js?v=20261126-1";
    tourScript.defer = true;
    tourScript.dataset.siteTour = "true";
    document.head.appendChild(tourScript);
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
