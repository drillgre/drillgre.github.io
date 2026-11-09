(() => {
  "use strict";
  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = id => document.getElementById(id);
  let optedIn = false;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));

  function status(message, error = false) {
    $("leaderStatus").textContent = message;
    $("leaderStatus").classList.toggle("error", error);
  }

  function renderRows(rows) {
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
          ? "Your first name, best mock score, mock count, completed quiz count, and completed Question Bank count are visible. You can remove yourself at any time."
          : "Choose whether to display your first name, best mock score, and completed assessment and Question Bank counts publicly. Your email address is never shown.";
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

    const { data, error } = await db.rpc("get_public_leaderboard", { p_limit: 50 });
    if (error) {
      status("The leaderboard is not configured yet. Run supabase/quiz-progress.sql after the earlier database setup scripts in Supabase. " + error.message, true);
      renderRows([]);
      return;
    }
    renderRows(data || []);
    status("Opted-in learners are ranked primarily by their best mock score. Completed topic quizzes and Question Bank questions are displayed separately and used as participation tie-breakers.");
  }

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
