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
        top: 50%;
        left: 50%;
        width: 54px;
        height: 54px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: rgba(18,31,57,.88);
        box-shadow: 0 8px 28px rgba(10,20,42,.2), 0 0 0 7px rgba(255,255,255,.2);
        opacity: 1;
        visibility: visible;
        transform: translate(-50%,-50%) scale(1);
        transition: opacity .2s ease, transform .2s ease, visibility .2s ease;
        pointer-events: none;
      }
      .drillgre-page-loader.is-hidden {
        opacity: 0;
        visibility: hidden;
        transform: translate(-50%,-50%) scale(.88);
      }
      .drillgre-loader-ring {
        width: 29px;
        height: 29px;
        border: 3px solid rgba(229,243,107,.22);
        border-top-color: #e5f36b;
        border-right-color: #e5f36b;
        border-radius: 50%;
        filter: drop-shadow(0 0 4px rgba(229,243,107,.25));
        animation: drillgre-database-spin .78s cubic-bezier(.55,.1,.35,.9) infinite;
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
    loader.setAttribute("aria-label", "Loading");

    loader.innerHTML = `<div class="drillgre-loader-ring" aria-hidden="true"></div>`;

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