/* DrillGRE database-only loading indicator.
   The spinner appears only while Supabase REST, RPC, or Auth requests are pending. */
(() => {
  "use strict";

  if (window.__drillgreDatabaseLoaderInstalled) return;
  window.__drillgreDatabaseLoaderInstalled = true;

  const SUPABASE_HOST = "aayzpcfryixauwsytphd.supabase.co";
  const SHOW_DELAY_MS = 180;
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

  function createLoader() {
    if (loader && loader.isConnected) return loader;

    loader = document.createElement("div");
    loader.className = "drillgre-page-loader";
    loader.setAttribute("data-database-loader", "");
    loader.setAttribute("role", "status");
    loader.setAttribute("aria-live", "polite");
    loader.setAttribute("aria-label", "Loading data from DrillGRE");

    loader.innerHTML = `
      <div class="drillgre-loader-content">
        <div class="drillgre-loader-mark" aria-hidden="true">
          <div class="drillgre-loader-ring"></div>
          <div class="drillgre-loader-orbit"></div>
          <div class="drillgre-loader-core">D</div>
        </div>
        <div class="drillgre-loader-brand">Drill<span>GRE</span></div>
        <div class="drillgre-loader-note">Loading your data</div>
      </div>`;

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