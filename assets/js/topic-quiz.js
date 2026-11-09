(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = id => document.getElementById(id);

  const CATEGORY_LABELS = {
    arithmetic:"Arithmetic",
    data_analysis:"Data Analysis",
    algebra:"Algebra",
    geometry:"Geometry"
  };
  const SUBTOPIC_LABELS = {
    number_properties:"Number properties",
    fractions_decimals:"Fractions and decimals",
    percentages:"Percentages",
    ratios_proportions:"Ratios and proportions",
    exponents_roots:"Exponents and roots",
    absolute_values:"Absolute values",
    arithmetic_other:"Other arithmetic",
    data_interpretation:"Data interpretation",
    probability:"Probability",
    counting:"Counting, permutations and combinations",
    statistics:"Statistics",
    algebra_core:"Equations and functions",
    inequalities:"Inequalities",
    word_problems:"Word problems",
    geometry:"Geometry",
    coordinate_geometry:"Coordinate geometry"
  };

  let questionBank = [];
  let isAuthenticated = false;
  let guestQuizzesRemaining = 2;
  let historyReady = false;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));

  function setStatus(message, isError = false) {
    const el = $("quizSetupStatus");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("error",!!isError);
    el.hidden = !message;
  }

  function getVisitorKey() {
    let key = localStorage.getItem("drillgre_guest_visitor_key_v1");
    if (!key || key.length < 32) {
      key = crypto.randomUUID() + "-" + crypto.randomUUID();
      localStorage.setItem("drillgre_guest_visitor_key_v1",key);
    }
    return key;
  }

  function categoryLabel(value) {
    return CATEGORY_LABELS[value] || String(value || "Other").replaceAll("_"," ");
  }

  function subtopicLabel(value) {
    return SUBTOPIC_LABELS[value] || String(value || "Other").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
  }

  async function fetchQuestionBank() {
    const all = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const {data,error} = await db.from("questions")
        .select("id,topic,topic_category,subtopic,question_type,difficulty,question_text,options,figure_url,stimulus_id,question_usage")
        .eq("published",true)
        .in("question_usage",["practice","both"])
        .order("created_at",{ascending:false})
        .range(offset,offset + pageSize - 1);
      if (error) throw error;
      const page = data || [];
      all.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  }

  function renderTopicGroups() {
    const groups = new Map();
    questionBank.forEach(q => {
      const category = q.topic_category || "arithmetic";
      const subtopic = q.subtopic || "arithmetic_other";
      if (!groups.has(category)) groups.set(category,new Map());
      const subtopics = groups.get(category);
      subtopics.set(subtopic,(subtopics.get(subtopic)||0)+1);
    });

    const ordered = [...groups.entries()].sort((a,b)=>categoryLabel(a[0]).localeCompare(categoryLabel(b[0])));
    $("quizTopicGroups").innerHTML = ordered.map(([category,subtopics]) => {
      const rows = [...subtopics.entries()].sort((a,b)=>subtopicLabel(a[0]).localeCompare(subtopicLabel(b[0])));
      const total = rows.reduce((sum,row)=>sum+row[1],0);
      return '<article class="quiz-topic-group" data-topic-group="' + esc(category) + '">' +
        '<label class="quiz-category-row">' +
          '<input type="checkbox" data-category-toggle="' + esc(category) + '">' +
          '<strong>' + esc(categoryLabel(category)) + '</strong>' +
          '<span class="quiz-category-count">' + total + ' questions</span>' +
        '</label>' +
        '<div class="quiz-subtopic-list">' +
          rows.map(([subtopic,count]) =>
            '<label class="quiz-subtopic-row">' +
              '<input type="checkbox" data-quiz-subtopic="' + esc(subtopic) + '" data-category="' + esc(category) + '">' +
              '<span>' + esc(subtopicLabel(subtopic)) + '</span>' +
              '<span>' + count + '</span>' +
            '</label>'
          ).join("") +
        '</div>' +
      '</article>';
    }).join("");

    $("quizTopicGroups").querySelectorAll("[data-category-toggle]").forEach(input => {
      input.addEventListener("change",() => {
        const category = input.dataset.categoryToggle;
        $("quizTopicGroups").querySelectorAll('[data-category="' + CSS.escape(category) + '"]')
          .forEach(child=>child.checked=input.checked);
        updateQuizAvailability();
      });
    });
    $("quizTopicGroups").querySelectorAll("[data-quiz-subtopic]").forEach(input =>
      input.addEventListener("change",updateQuizAvailability)
    );
    updateQuizAvailability();
  }

  function selectedSubtopicKeys() {
    return [...$("quizTopicGroups").querySelectorAll("[data-quiz-subtopic]:checked")]
      .map(input=>input.dataset.category + "::" + input.dataset.quizSubtopic);
  }

  function selectedQuestionPool() {
    const selected = new Set(selectedSubtopicKeys());
    return questionBank.filter(q =>
      selected.has((q.topic_category || "arithmetic") + "::" + (q.subtopic || "arithmetic_other"))
    );
  }

  function updateCategoryCheckboxes() {
    $("quizTopicGroups").querySelectorAll("[data-category-toggle]").forEach(parent => {
      const category = parent.dataset.categoryToggle;
      const children = [...$("quizTopicGroups").querySelectorAll('[data-category="' + CSS.escape(category) + '"]')];
      const checked = children.filter(child=>child.checked).length;
      parent.checked = children.length > 0 && checked === children.length;
      parent.indeterminate = checked > 0 && checked < children.length;
    });
  }

  function updateQuizAvailability() {
    updateCategoryCheckboxes();
    const selected = selectedSubtopicKeys();
    const available = selectedQuestionPool().length;
    const requested = Number($("quizQuestionCount").value || 12);
    const button = $("startTopicQuiz");
    const note = $("quizAvailability");

    if (!selected.length) {
      note.textContent = "Select one or more topics or subtopics to see how many questions are available.";
      button.disabled = true;
    } else if (available < requested) {
      note.textContent = available + " questions available. Select more subtopics or choose a smaller quiz size.";
      button.disabled = true;
    } else if (!historyReady) {
      note.textContent = "Checking your quiz allowance. The quiz option will be available when the allowance is confirmed.";
      button.disabled = true;
    } else if (!isAuthenticated && guestQuizzesRemaining <= 0) {
      note.textContent = "You have used both free guest quiz attempts. Sign in for unlimited quizzes.";
      button.disabled = true;
    } else {
      note.textContent = available + " eligible questions available. " + requested + " will be selected randomly.";
      button.disabled = false;
    }
  }

  function topicSummary(keys) {
    return (keys || []).map(key => {
      const parts = String(key).split("::");
      return categoryLabel(parts[0]) + " · " + subtopicLabel(parts[1]);
    }).join(", ");
  }

  function renderQuizHistory(attempts) {
    const host = $("quizHistoryList");
    if (!attempts.length) {
      host.innerHTML = '<div class="quiz-empty">No quiz attempts yet. Choose your topics above to create your first quiz.</div>';
      return;
    }

    host.innerHTML = attempts.map(attempt => {
      const date = new Date(attempt.created_at).toLocaleString(undefined,{
        year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"
      });
      const completed = attempt.status === "completed";
      const score = completed
        ? '<div class="quiz-history-score">' + esc(attempt.total_correct ?? 0) + ' / ' + esc(attempt.question_count) + ' correct</div>'
        : '<div class="quiz-history-score" style="color:#b7791f">In progress</div>';
      const action = !completed ? "Resume quiz" : "Review answers";
      const url = "topic-quiz.html?attempt=" + encodeURIComponent(attempt.id) +
        "&token=" + encodeURIComponent(attempt.session_token);
      return '<article class="quiz-history-row">' +
        '<div><div class="quiz-history-title">' + (completed ? "Completed topic quiz" : "Unfinished topic quiz") + '</div>' +
        '<div class="quiz-history-meta">' + esc(date) + ' · ' + esc(attempt.question_count) + ' questions · ' +
        esc(topicSummary(attempt.topic_keys)) + '</div></div>' +
        '<div style="display:grid;justify-items:end;gap:8px">' + score +
          '<a class="quiz-history-action" target="_blank" rel="noopener" href="' + url + '">' + action + '</a>' +
        '</div>' +
      '</article>';
    }).join("");
  }

  async function loadQuizHistory() {
    const status = $("quizHistoryStatus");
    historyReady = false;
    updateQuizAvailability();
    try {
      const key = getVisitorKey();
      const {data:sessionData,error:sessionError} = await db.auth.getSession();
      if (sessionError) throw sessionError;
      isAuthenticated = !!sessionData?.session?.user;

      if (isAuthenticated) {
        const {error:claimError} = await db.rpc("claim_guest_topic_quiz_attempts",{p_visitor_key:key});
        if (claimError) throw claimError;
      }

      const {data,error} = await db.rpc("get_gre_topic_quiz_history",{p_visitor_key:key});
      if (error) throw error;

      if (isAuthenticated) {
        $("quizQuotaNote").textContent = "You are signed in. Unlimited topic quiz attempts are available, and your quiz history is saved to your learner profile.";
      } else {
        guestQuizzesRemaining = Number(data?.guest_quizzes_remaining ?? 2);
        const used = Number(data?.guest_quizzes_used ?? 0);
        $("quizQuotaNote").textContent = guestQuizzesRemaining + " of 2 free guest quiz attempts remaining. " +
          (guestQuizzesRemaining === 0
            ? "Sign in for unlimited quizzes."
            : "Sign in at any time to unlock unlimited quizzes and keep your history with your account.");
      }

      renderQuizHistory(data?.attempts || []);
      historyReady = true;
      if (status) {
        status.hidden = true;
        status.textContent = "";
        status.classList.remove("error");
      }
      updateQuizAvailability();
    } catch (error) {
      if (status) {
        status.hidden = false;
        status.classList.add("error");
        status.textContent = "Quiz history and guest limits require the latest quiz progress migration in Supabase. " + (error.message || "");
      }
      $("quizQuotaNote").textContent = "Unable to verify your quiz allowance. Please try again after the Supabase quiz progress migration is applied.";
      historyReady = false;
      updateQuizAvailability();
    }
  }

  function startTopicQuiz() {
    const pool = selectedQuestionPool();
    const requested = Number($("quizQuestionCount").value || 12);
    if (pool.length < requested || !historyReady) return;
    if (!isAuthenticated && guestQuizzesRemaining <= 0) {
      updateQuizAvailability();
      return;
    }

    const token = crypto.randomUUID() + "-" + crypto.randomUUID();
    const query = new URLSearchParams({
      subtopics:JSON.stringify(selectedSubtopicKeys()),
      count:String(requested),
      timing:$("quizTimingMode").value || "standard",
      token
    });
    const quizWindow = window.open("topic-quiz.html?" + query.toString(),"_blank");
    if (!quizWindow) {
      setStatus("Your browser blocked the new quiz tab. Allow pop-ups for drillgre.github.io and try again.",true);
      return;
    }
    try { quizWindow.opener = null; } catch {}
    setStatus("Your quiz has opened in a new tab. The attempt is recorded when the test loads. Unfinished quizzes are saved in Your quizzes below.");
    window.setTimeout(loadQuizHistory,1800);
  }

  async function init() {
    $("quizQuestionCount").addEventListener("change",updateQuizAvailability);
    $("quizTimingMode").addEventListener("change",updateQuizAvailability);
    $("startTopicQuiz").addEventListener("click",startTopicQuiz);
    try {
      questionBank = await fetchQuestionBank();
      $("quizBankCount").textContent = questionBank.length + " practice questions";
      if (!questionBank.length) {
        setStatus("No published questions are currently available for topic quizzes. Publish questions with availability set to Practice or Both in the admin workspace.");
        $("quizSetupPanel").hidden = false;
        return;
      }
      renderTopicGroups();
      $("quizSetupPanel").hidden = false;
      setStatus("");
      await loadQuizHistory();
      window.addEventListener("focus",loadQuizHistory);
      db.auth.onAuthStateChange(event => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT") loadQuizHistory();
      });
    } catch (error) {
      setStatus("Unable to load the practice question bank. " + (error.message || ""),true);
    }
  }

  document.addEventListener("DOMContentLoaded",init);
})();