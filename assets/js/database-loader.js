/* DrillGRE database-only loading indicator.
   The spinner appears only while Supabase REST, RPC, or Auth requests are pending. */
(() => {
  "use strict";

  if (window.__drillgreDatabaseLoaderInstalled) return;
  window.__drillgreDatabaseLoaderInstalled = true;

  const SUPABASE_HOST = "aayzpcfryixauwsytphd.supabase.co";
  const SHOW_DELAY_MS = 1000;
  const MIN_VISIBLE_MS = 360;
  const originalFetch = window.fetch;

  let pendingRequests = 0;
  let showTimer = null;
  let hideTimer = null;
  let loader = null;
  let shownAt = 0;

  function isDatabaseRequest(input) {
    const rawUrl = typeof input === "string"
      ? input
      : (input instanceof URL
        ? input.href
        : (input && typeof input.url === "string" ? input.url : ""));
    if (!rawUrl) return false;

    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.hostname !== SUPABASE_HOST) return false;
      return url.pathname.startsWith("/rest/v1/")
        || url.pathname.startsWith("/auth/v1/")
        || url.pathname.startsWith("/graphql/v1/");
    } catch (_) {
      return false;
    }
  }

  function injectLoaderStyles() {
    if (document.getElementById("drillgre-database-loader-styles")) return;
    const style = document.createElement("style");
    style.id = "drillgre-database-loader-styles";
    style.textContent = `
      .drillgre-page-loader {
        position: fixed;
        z-index: 99999;
        top: max(16px, env(safe-area-inset-top));
        left: 50%;
        transform: translateX(-50%) translateY(0);
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 11px 17px;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 999px;
        background: rgba(18,31,57,.96);
        color: #fff;
        box-shadow: 0 10px 32px rgba(10,20,42,.22);
        font: 650 13px/1.2 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
        letter-spacing: .01em;
        opacity: 1;
        visibility: visible;
        transition: opacity .22s ease, transform .22s ease, visibility .22s ease;
        pointer-events: none;
        white-space: nowrap;
      }
      .drillgre-page-loader.is-hidden {
        opacity: 0;
        visibility: hidden;
        transform: translateX(-50%) translateY(-8px);
      }
      .drillgre-loader-ring {
        width: 17px;
        height: 17px;
        flex: 0 0 17px;
        border: 2px solid rgba(229,243,107,.28);
        border-top-color: #e5f36b;
        border-right-color: #e5f36b;
        border-radius: 50%;
        animation: drillgre-database-spin .72s linear infinite;
      }
      @keyframes drillgre-database-spin { to { transform: rotate(360deg); } }
      @media(prefers-reduced-motion:reduce) {
        .drillgre-loader-ring { animation-duration: 1.8s; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function createLoader() {
    if (loader && loader.isConnected) return loader;
    injectLoaderStyles();

    loader = document.createElement("div");
    loader.className = "drillgre-page-loader";
    loader.setAttribute("data-database-loader", "");
    loader.setAttribute("role", "status");
    loader.setAttribute("aria-live", "polite");
    loader.setAttribute("aria-label", "Connecting to database");

    loader.innerHTML = `
      <div class="drillgre-loader-ring" aria-hidden="true"></div>
      <span>Connecting to database...</span>`;

    (document.body || document.documentElement).appendChild(loader);
    return loader;
  }

  function showLoader() {
    if (pendingRequests === 0) return;
    const element = createLoader();
    element.classList.remove("is-hidden");
    element.removeAttribute("aria-hidden");
    shownAt = Date.now();
  }

  function beginRequest() {
    pendingRequests += 1;

    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }

    if (pendingRequests === 1) {
      if (loader && !loader.classList.contains("is-hidden")) return;
      if (showTimer !== null) window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => {
        showTimer = null;
        showLoader();
      }, SHOW_DELAY_MS);
    }
  }

  function endRequest() {
    pendingRequests = Math.max(0, pendingRequests - 1);
    if (pendingRequests !== 0) return;

    if (showTimer !== null) {
      window.clearTimeout(showTimer);
      showTimer = null;
    }

    if (!loader || loader.classList.contains("is-hidden")) return;

    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt));
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      if (pendingRequests !== 0 || !loader) return;

      loader.classList.add("is-hidden");
      loader.setAttribute("aria-hidden", "true");
      const oldLoader = loader;
      window.setTimeout(() => {
        if (pendingRequests === 0 && loader === oldLoader) {
          oldLoader.remove();
          loader = null;
        }
      }, 320);
    }, remaining);
  }

  if (typeof originalFetch === "function") {
    window.fetch = function(input, init) {
      if (!isDatabaseRequest(input)) {
        return originalFetch.apply(this, arguments);
      }

      beginRequest();
      try {
        return Promise.resolve(originalFetch.apply(this, arguments)).finally(endRequest);
      } catch (error) {
        endRequest();
        throw error;
      }
    };
  }
})();