(() => {
  "use strict";
  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = id => document.getElementById(id);
  let optedIn = false;
  let activeBoard = "quant";

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));

  function status(message, error = false) {
    $("leaderStatus").textContent = message;
    $("leaderStatus").classList.toggle("error", error);
  }

  function renderQuantRows(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      $("leaderRows").innerHTML = '<div class="leader-empty">No learners have opted in yet. Complete a mock test, topic quiz, or Question Bank question and opt in to appear here.</div>';
      return;
    }
    $("leaderRows").innerHTML = rows.map(row => `
      <div class="leader-row">
        <span class="leader-rank">#${esc(row.rank)}</span>
        <span class="leader-name">${esc(row.first_name)}</span>
        <span class="leader-score">${row.best_score === null || row.best_score === undefined ? "—" : esc(row.best_score) + '<span class="leader-sub"> / 170</span>'}</span>
        <span class="leader-attempts"><b>${esc(row.mocks_completed || 0)}</b><span class="leader-sub"> mocks</span></span>
        <span class="leader-quizzes"><b>${esc(row.quizzes_completed || 0)}</b><span class="leader-sub"> quizzes</span></span>
        <span class="leader-question-bank"><b>${esc(row.question_bank_completed || 0)}</b><span class="leader-sub"> questions</span></span>
      </div>
    `).join("");
  }

  function renderArcheryRows(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      $("leaderRows").innerHTML = '<div class="leader-empty">No Word Archery scores are available yet. Sign in, play Word Archery, and opt in to appear here.</div>';
      return;
    }
    $("leaderRows").innerHTML = rows.map(row => `
      <div class="leader-row leader-wa-row">
        <span class="leader-rank">#${esc(row.rank)}</span>
        <span><span class="leader-name">${esc(row.first_name)}</span><span class="leader-wa-detail">${esc(row.correct_attempts || 0)} correct answers</span></span>
        <span class="leader-wa-points">${Number(row.total_points || 0).toLocaleString()}<span class="leader-sub"> pts</span></span>
        <span class="leader-wa-rate">${Number(row.success_rate || 0).toFixed(1)}%<span class="leader-wa-detail"> accuracy</span></span>
        <span class="leader-wa-attempts"><b>${esc(row.attempts || 0)}</b><span class="leader-wa-detail"> attempts</span></span>
      </div>
    `).join("");
  }

  async function loadRankings() {
    const head = $("leaderBoardHead");
    if (activeBoard === "archery") {
      head.classList.add("leader-wa-head");
      head.innerHTML = "<span>Rank</span><span>Learner</span><span>Total points</span><span>Success rate</span><span>Attempts</span>";
      const { data, error } = await db.rpc("get_public_word_archery_leaderboard", { p_limit: 50 });
      if (error) {
        status("Word Archery rankings are not configured yet. Run supabase/word-archery-leaderboard.sql in Supabase. " + error.message, true);
        renderArcheryRows([]);
        return;
      }
      renderArcheryRows(data || []);
      status("Word Archery rankings are ordered by total points. Success rate, then attempts, break ties. Only learners who opt in are shown.");
      return;
    }

    head.classList.remove("leader-wa-head");
    head.innerHTML = "<span>Rank</span><span>Learner</span><span>Best score</span><span>Mocks completed</span><span>Quizzes completed</span><span>Questions completed</span>";
    const { data, error } = await db.rpc("get_public_leaderboard", { p_limit: 50 });
    if (error) {
      status("The leaderboard is not configured yet. Run supabase/quiz-progress.sql after the earlier database setup scripts in Supabase. " + error.message, true);
      renderQuantRows([]);
      return;
    }
    renderQuantRows(data || []);
    status("Opted-in learners are ranked primarily by their best mock score. Completed topic quizzes and Question Bank questions are displayed separately and used as participation tie-breakers.");
  }

  function switchBoard(board) {
    activeBoard = board === "archery" ? "archery" : "quant";
    document.querySelectorAll("[data-leader-board]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.leaderBoard === activeBoard));
    });
    loadRankings();
  }

  async function loadBoard() {
    const { data: sessionData, error: sessionError } = await db.auth.getSession();
    if (sessionError) {
      status("Could not check your sign-in status. " + sessionError.message, true);
    }

    const session = sessionData?.session;
    if (session?.user) {
      $("leaderOptIn").hidden = false;
      $("leaderSignInNote").hidden = true;
      const { data: profile, error: profileError } = await db
        .from("profiles")
        .select("role, leaderboard_opt_in")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!profileError && profile?.role === "learner") {
        optedIn = !!profile.leaderboard_opt_in;
        $("leaderOptTitle").textContent = optedIn ? "You are on the leaderboard" : "Join the leaderboard";
        $("leaderOptCopy").textContent = optedIn
          ? "Your first name and aggregated practice statistics are visible on the Quant and Word Archery leaderboards. You can remove yourself from both boards at any time."
          : "Choose whether to display your first name and aggregated practice statistics on the Quant and Word Archery leaderboards. Your email address is never shown.";
        $("leaderOptButton").textContent = optedIn ? "Remove me from leaderboard" : "Join leaderboard";
        $("leaderOptButton").classList.toggle("secondary", optedIn);
      } else {
        $("leaderOptIn").hidden = true;
        $("leaderSignInNote").textContent = profile?.role === "admin"
          ? "Admin accounts are not included in learner rankings."
          : "Your learner profile is not available yet.";
      }
    } else {
      $("leaderOptIn").hidden = true;
      $("leaderSignInNote").hidden = false;
      $("leaderSignInNote").innerHTML = ' <a href="/account.html">Sign in</a> to choose whether to appear on the leaderboard.';
    }

    await loadRankings();
  }

  document.querySelectorAll("[data-leader-board]").forEach(button => {
    button.addEventListener("click", () => switchBoard(button.dataset.leaderBoard));
  });

  $("leaderOptButton").addEventListener("click", async () => {
    const next = !optedIn;
    $("leaderOptButton").disabled = true;
    status(next ? "Adding you to the leaderboard…" : "Removing you from the leaderboard…");
    const { data, error } = await db.rpc("set_leaderboard_opt_in", { p_opt_in: next });
    $("leaderOptButton").disabled = false;
    if (error) {
      status(error.message, true);
      return;
    }
    optedIn = !!data;
    await loadBoard();
  });

  document.addEventListener("DOMContentLoaded", loadBoard);
})();
