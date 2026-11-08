(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = id => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[ch]));
  }

  function setStatus(message, error = false) {
    const el = $("dashboardStatus");
    el.hidden = !message;
    el.textContent = message;
    el.classList.toggle("error", error);
  }

  function pretty(value) {
    if (!value) return "Not provided";
    return String(value).replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  function profileRows(profile) {
    const fields = [
      ["Education", pretty(profile.education)],
      ["Age range", profile.age_range || "Not provided"],
      ["Country", profile.country || "Not provided"],
      ["Academic background", pretty(profile.academic_background)],
      ["Further study", pretty(profile.further_study)],
      ["Field of study", pretty(profile.further_study_field)]
    ];
    $("profileDetails").innerHTML = fields.map(([label,value]) => `
      <div class="profile-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
    `).join("");
  }

  function renderAttempts(attempts) {
    if (!attempts.length) {
      $("mockHistory").innerHTML = '<div class="empty-state">You have not started a mock test yet. Create your first adaptive mock to begin your history.</div>';
      return;
    }

    $("mockHistory").innerHTML = attempts.map(attempt => {
      const date = new Date(attempt.created_at).toLocaleString(undefined, {
        year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"
      });
      const completed = attempt.status === "completed";
      const score = completed ? `<div class="attempt-score">${escapeHtml(attempt.scaled_score ?? "—")} / 170</div>` : '<div class="attempt-status">In progress</div>';
      const route = attempt.route === "harder" ? "Harder route" : attempt.route === "easier" ? "Foundation route" : "Adaptive route pending";
      const correct = completed ? `${escapeHtml(attempt.total_correct ?? 0)} / 27 correct` : "Not yet completed";
      return `
        <article class="attempt-row">
          <div><strong>Quant Mock Test</strong><div class="attempt-meta">${escapeHtml(date)} · ${escapeHtml(route)}</div></div>
          ${score}
          <div class="attempt-meta">${correct}</div>
          <div class="attempt-meta" style="text-align:right">${completed ? "Completed" : "Started"}</div>
        </article>`;
    }).join("");
  }

  async function loadDashboard() {
    const { data:sessionData, error:sessionError } = await db.auth.getSession();
    const session = sessionData?.session;
    if (sessionError || !session) {
      window.location.replace("account.html");
      return;
    }

    setStatus("Loading your learner profile and mock history…");

    // Attach guest attempts from this browser to the newly signed-in learner.
    // The visitor key is only a browser-scoped claim token; it is not the auth credential.
    const visitorKey = localStorage.getItem("drillgre_guest_visitor_key_v1");
    if (visitorKey) {
      const { error: claimError } = await db.rpc("claim_guest_mock_attempts", {
        p_visitor_key: visitorKey
      });
      if (claimError) {
        setStatus("Your account is signed in, but guest mock history could not be linked. " + claimError.message, true);
        return;
      }
    }

    const { data, error } = await db.rpc("get_learner_dashboard");
    if (error) {
      setStatus("Your account is signed in, but the learner dashboard could not be loaded. " + error.message + " Check that learner-accounts.sql has been run in Supabase.", true);
      return;
    }

    const profile = data.profile || {};
    $("learnerName").textContent = profile.name || session.user.email?.split("@")[0] || "Learner";
    $("learnerEmail").textContent = profile.email || session.user.email || "";
    $("mocksStarted").textContent = data.mocks_started ?? 0;
    $("mocksCompleted").textContent = data.mocks_completed ?? 0;
    profileRows(profile);
    renderAttempts(data.recent_attempts || []);

    $("dashboardContent").hidden = false;
    setStatus("");
  }

  $("signOut").addEventListener("click", async () => {
    const { error } = await db.auth.signOut();
    if (error) {
      setStatus(error.message, true);
      return;
    }
    window.location.replace("account.html");
  });

  document.addEventListener("DOMContentLoaded", loadDashboard);
})();