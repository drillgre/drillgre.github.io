(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = id => document.getElementById(id);
  const setText = (id, value) => {
    const element = $(id);
    if (element) element.textContent = value;
    else console.warn("Learner dashboard element not found:", id);
  };
  const setWidth = (id, value) => {
    const element = $(id);
    if (element) element.style.width = value;
    else console.warn("Learner dashboard element not found:", id);
  };
  function showArcheryUnavailable(message) {
    setText("archeryAttempts", "—");
    setText("archeryCorrect", "—");
    setText("archeryPoints", "—");
    setText("archeryStreak", "—");
    setText("archeryAccuracy", "—");
    setText("archeryAccuracyText", "Unavailable");
    setWidth("archeryAccuracyBar", "0%");
    setText("archeryProgressNote", message);
  }

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

  function renderLessonProgress(items) {
    const host = $("completedLessonList");
    if (!items.length) {
      host.innerHTML = '<span class="attempt-meta">No lessons completed yet. Start with the <a href="/quant/index.html">Quant lessons</a>.</span>';
      return;
    }
    host.innerHTML = items.map(item =>
      '<a href="/quant/lesson.html?id=' + encodeURIComponent(item.lesson_id) + '">' +
      '✓ ' + escapeHtml(item.title || "Completed lesson") + '</a>'
    ).join("");
  }

  function renderQuizHistory(attempts) {
    if (!attempts.length) {
      $("quizHistory").innerHTML = '<div class="empty-state">No topic quizzes attempted yet. <a href="/quant/quiz.html">Create your first quiz</a>.</div>';
      return;
    }
    $("quizHistory").innerHTML = attempts.map(attempt => {
      const completed = attempt.status === "completed";
      const date = new Date(attempt.created_at).toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
      const topic = (attempt.topic_keys || []).map(key => String(key).split("::").join(" · ").replaceAll("_"," ")).join(", ");
      const score = completed
        ? '<strong class="attempt-score">' + escapeHtml(attempt.total_correct ?? 0) + ' / ' + escapeHtml(attempt.question_count) + ' correct</strong>'
        : '<strong class="attempt-status">In progress</strong>';
      const action = completed
        ? '<a target="_blank" rel="noopener" href="/quant/topic-quiz.html?attempt=' + encodeURIComponent(attempt.id) + '&token=' + encodeURIComponent(attempt.session_token) + '">Review answers →</a>'
        : '<a target="_blank" rel="noopener" href="/quant/topic-quiz.html?attempt=' + encodeURIComponent(attempt.id) + '&token=' + encodeURIComponent(attempt.session_token) + '">Resume quiz →</a>';
      return '<article class="quiz-attempt-row"><div><strong>Quant topic quiz</strong><div class="attempt-meta">' + escapeHtml(date) + '</div><div class="attempt-meta">' + escapeHtml(topic) + ' · ' + escapeHtml(attempt.question_count) + ' questions</div></div>' +
        '<div style="text-align:right;display:grid;justify-items:end;gap:5px">' + score + action + '</div></article>';
    }).join("");
  }

  async function loadVocabularyAndArchery() {
    // Vocabulary progress is handled independently by learner-vocabulary-progress.js.
    // Keep this loader focused on Word Archery so obsolete vocabulary element IDs
    // cannot interrupt the statistics display.
    const archeryResult = await db.rpc("get_word_archery_stats");

    if (archeryResult.error || !archeryResult.data) {
      const detail = archeryResult.error?.message || "The statistics function returned no data.";
      console.error("Word Archery statistics RPC failed:", archeryResult.error || archeryResult);
      showArcheryUnavailable("Word Archery statistics could not be loaded: " + detail);
      return;
    }

    let stats = archeryResult.data;
    if (typeof stats === "string") {
      try { stats = JSON.parse(stats); } catch (_) {}
    }
    if (Array.isArray(stats)) stats = stats[0];
    if (stats && stats.get_word_archery_stats) stats = stats.get_word_archery_stats;

    if (!stats || typeof stats !== "object" ||
        !("total_attempts" in stats) || !("total_points" in stats)) {
      console.error("Unexpected Word Archery stats response:", archeryResult);
      showArcheryUnavailable("Word Archery data was received in an unexpected format.");
      return;
    }

    const attempts = Number(stats.total_attempts ?? 0);
    const correct = Number(stats.correct_attempts ?? 0);
    const points = Number(stats.total_points ?? 0);
    const streak = Number(stats.streak ?? 0);
    const accuracy = Math.max(0, Math.min(100, Number(stats.success_rate ?? 0)));

    setText("archeryAttempts", attempts.toLocaleString());
    setText("archeryCorrect", correct.toLocaleString());
    setText("archeryPoints", points.toLocaleString());
    setText("archeryStreak", streak.toLocaleString());
    setText("archeryAccuracy", accuracy.toFixed(1) + "%");
    setText("archeryAccuracyText", accuracy.toFixed(1) + "%");
    setWidth("archeryAccuracyBar", accuracy + "%");
    setText("archeryProgressNote", attempts
      ? "You have answered " + attempts.toLocaleString() + " questions, with " + correct.toLocaleString() + " correct answers."
      : "Play your first round to start building your Word Archery record.");
  }


  const DEFAULT_DASHBOARD_LAYOUT = [
    "study-activity", "mistake-intelligence", "topic-performance",
    "question-type-performance", "practice-priorities", "weekly-trend",
    "practice-sources", "mock-score-progression"
  ];

  function dashboardCards() {
    return Array.from(document.querySelectorAll(".insights-grid > .insight-card[data-layout-id]"));
  }

  function applyDashboardLayout(layout) {
    const grid = document.querySelector(".insights-grid");
    if (!grid) return;
    const cards = dashboardCards();
    const byId = new Map(cards.map(card => [card.dataset.layoutId, card]));
    const ordered = [...(Array.isArray(layout) ? layout : []), ...DEFAULT_DASHBOARD_LAYOUT]
      .filter((id, index, all) => all.indexOf(id) === index && byId.has(id));
    ordered.forEach(id => grid.appendChild(byId.get(id)));
  }

  async function fetchDashboardLayout() {
    const { data, error } = await db.from("gre_dashboard_settings")
      .select("layout").eq("id", 1).maybeSingle();
    if (error) {
      console.warn("Global dashboard layout could not be loaded; using default order.", error);
      return DEFAULT_DASHBOARD_LAYOUT;
    }
    return Array.isArray(data?.layout) ? data.layout : DEFAULT_DASHBOARD_LAYOUT;
  }

  async function saveGlobalDashboardLayout(layout) {
    const { error } = await db.from("gre_dashboard_settings").upsert({
      id: 1, layout, updated_at: new Date().toISOString()
    }, { onConflict: "id" });
    if (error) throw error;
  }

  function enableDashboardLayoutEditor() {
    const panel = $("dashboardLayoutAdmin");
    const status = $("dashboardLayoutStatus");
    if (!panel) return;
    panel.hidden = false;
    let dragged = null;
    const cards = dashboardCards();
    cards.forEach(card => {
      card.draggable = true;
      card.style.cursor = "grab";
      card.addEventListener("dragstart", event => {
        dragged = card;
        card.classList.add("layout-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", card.dataset.layoutId);
      });
      card.addEventListener("dragover", event => {
        if (!dragged || dragged === card) return;
        event.preventDefault();
        card.classList.add("layout-drop-target");
      });
      card.addEventListener("dragleave", () => card.classList.remove("layout-drop-target"));
      card.addEventListener("drop", event => {
        event.preventDefault();
        card.classList.remove("layout-drop-target");
        if (!dragged || dragged === card) return;
        const rect = card.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        card.parentNode.insertBefore(dragged, after ? card.nextSibling : card);
      });
      card.addEventListener("dragend", () => {
        cards.forEach(item => item.classList.remove("layout-dragging", "layout-drop-target"));
        dragged = null;
      });
    });

    $("saveDashboardLayout")?.addEventListener("click", async () => {
      const button = $("saveDashboardLayout");
      button.disabled = true;
      status.textContent = "Saving…";
      try {
        await saveGlobalDashboardLayout(dashboardCards().map(card => card.dataset.layoutId));
        status.textContent = "Saved. All learners will see this layout.";
      } catch (error) {
        status.textContent = "Could not save: " + (error.message || "Please try again.");
      } finally {
        button.disabled = false;
      }
    });

    $("resetDashboardLayout")?.addEventListener("click", async () => {
      const button = $("resetDashboardLayout");
      button.disabled = true;
      status.textContent = "Restoring default…";
      try {
        applyDashboardLayout(DEFAULT_DASHBOARD_LAYOUT);
        await saveGlobalDashboardLayout(DEFAULT_DASHBOARD_LAYOUT);
        status.textContent = "Default layout restored for all learners.";
      } catch (error) {
        status.textContent = "Could not reset: " + (error.message || "Please try again.");
      } finally {
        button.disabled = false;
      }
    });
  }

  async function loadDashboard() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("admin_preview") === "1") {
      $("dashboardContent").hidden = false;
      $("quantAnalytics").hidden = false;
      $("analyticsStatus").hidden = true;
      $("dashboardLayoutAdmin").hidden = true;
      applyDashboardLayout(await fetchDashboardLayout());
      $("learnerName").textContent = "Preview";
      $("learnerEmail").textContent = "Administrator preview · learner data is not loaded";
      return;
    }
    const { data:sessionData, error:sessionError } = await db.auth.getSession();
    const session = sessionData?.session;
    if (sessionError || !session) {
      window.location.replace("/account.html");
      return;
    }

    const { data: accessProfile } = await db
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .maybeSingle();

    if (accessProfile?.role === "admin") {
      $("dashboardContent").hidden = false;
      $("quantAnalytics").hidden = false;
      $("analyticsStatus").hidden = true;
      applyDashboardLayout(await fetchDashboardLayout());
      enableDashboardLayoutEditor();
      setStatus("");
      return;
    }

    applyDashboardLayout(await fetchDashboardLayout());
    setStatus("Loading your learner profile, learning progress, and assessment history…");

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
      const { error: quizClaimError } = await db.rpc("claim_guest_topic_quiz_attempts", {
        p_visitor_key: visitorKey
      });
      if (quizClaimError) {
        setStatus("Your account is signed in, but guest quiz history could not be linked. Run the latest quiz progress SQL migration in Supabase. " + quizClaimError.message, true);
        return;
      }
    }

    const { data, error } = await db.rpc("get_learner_dashboard");
    if (error) {
      setStatus("Your account is signed in, but the learner dashboard could not be loaded. " + error.message + " Check that learner-accounts.sql and quiz-progress.sql have been run in Supabase.", true);
      return;
    }

    const profile = data.profile || {};
    $("learnerName").textContent = profile.name || session.user.email?.split("@")[0] || "Learner";
    $("learnerEmail").textContent = profile.email || session.user.email || "";
    $("lessonsCompleted").textContent = data.lessons_completed ?? 0;
    $("quizzesStarted").textContent = data.quizzes_started ?? 0;
    $("quizzesCompleted").textContent = data.quizzes_completed ?? 0;
    $("mocksStarted").textContent = data.mocks_started ?? 0;
    $("mocksCompleted").textContent = data.mocks_completed ?? 0;
    $("questionBankCompleted").textContent = data.question_bank_completed ?? 0;
    const lessonTotal = Number(data.lessons_total || 0);
    const lessonDone = Number(data.lessons_completed || 0);
    $("lessonProgressText").textContent = lessonDone + " of " + lessonTotal + " lessons completed";
    $("lessonProgressBar").style.width = (lessonTotal ? Math.min(100,100*lessonDone/lessonTotal) : 0) + "%";
    $("quizProgressText").textContent = (data.quizzes_completed ?? 0) + " quizzes completed";
    $("mockProgressText").textContent = (data.mocks_completed ?? 0) + " mock tests completed";
    profileRows(profile);
    renderLessonProgress(data.lesson_progress || []);
    renderQuizHistory(data.topic_quiz_attempts || []);
    renderAttempts(data.recent_attempts || []);

    $("dashboardContent").hidden = false;
    setStatus("");
    loadVocabularyAndArchery().catch(error => {
      console.error("Unable to load learner Word Archery statistics:", error);
      showArcheryUnavailable(
        "Word Archery statistics could not be displayed: " +
        (error?.message || "unexpected loading error")
      );
    });
  }

  $("signOut").addEventListener("click", async () => {
    const button = $("signOut");
    button.disabled = true;
    button.textContent = "Signing out…";
    try {
      const { error } = await db.auth.signOut({ scope: "local" });
      if (error) throw error;
      window.location.replace("/");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Sign out";
      setStatus("Sign out failed. Please try again. " + (error.message || ""), true);
    }
  });


  // Account deletion is performed server-side by a Supabase Edge Function.
  // The function verifies the caller's access token and uses the server-only
  // service-role key to delete only that authenticated user.
  $("showDeleteAccount")?.addEventListener("click", () => {
    $("deleteAccountConfirm").hidden = false;
    $("deleteAccountPhrase").focus();
  });

  $("cancelDeleteAccount")?.addEventListener("click", () => {
    $("deleteAccountConfirm").hidden = true;
    $("deleteAccountPhrase").value = "";
    $("confirmDeleteAccount").disabled = true;
    $("deleteAccountStatus").textContent = "";
  });

  $("deleteAccountPhrase")?.addEventListener("input", event => {
    $("confirmDeleteAccount").disabled = event.target.value.trim() !== "DELETE";
  });

  $("confirmDeleteAccount")?.addEventListener("click", async () => {
    const button = $("confirmDeleteAccount");
    const phrase = $("deleteAccountPhrase").value.trim();
    if (phrase !== "DELETE") return;

    const confirmed = window.confirm(
      "This permanently deletes your DrillGRE account. This cannot be undone. Continue?"
    );
    if (!confirmed) return;

    button.disabled = true;
    button.textContent = "Deleting account…";
    $("deleteAccountStatus").textContent = "Please wait while your account is deleted.";

    try {
      const { data, error } = await db.functions.invoke("delete-account", {
        body: { confirmation: phrase }
      });
      if (error) {
        let detail = error.message || "The account deletion request failed.";
        try {
          const body = await error.context?.json?.();
          if (body?.error) detail = body.error;
        } catch (_) {}
        throw new Error(detail);
      }
      if (!data?.success) throw new Error(data?.error || "The server did not confirm account deletion.");

      await db.auth.signOut({ scope: "local" });
      localStorage.removeItem("drillgre_guest_visitor_key_v1");
      window.location.replace("/?account_deleted=1");
    } catch (error) {
      $("deleteAccountStatus").textContent =
        "Account deletion failed: " + (error.message || "Please try again.");
      button.disabled = false;
      button.textContent = "Permanently delete account";
    }
  });

  document.addEventListener("DOMContentLoaded", loadDashboard);
})();