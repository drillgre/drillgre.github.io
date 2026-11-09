(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const savedAttemptId = params.get("attempt");
  const sessionToken = params.get("token") || (crypto.randomUUID() + "-" + crypto.randomUUID());
  const STATE_KEY = "drillgre_topic_quiz_" + (savedAttemptId || sessionToken);
  const requestedCount = Math.max(10, Math.min(15, Number(params.get("count") || 12)));
  const timingMode = ["standard","time_and_half","double","untimed"].includes(params.get("timing"))
    ? params.get("timing") : "standard";

  let visitorKey = null;
  let selectedSubtopics = [];
  let questions = [];
  let state = null;
  let timerInterval = null;
  let saveTimeout = null;
  let saveQueue = Promise.resolve();
  let submitting = false;
  let timeoutTriggered = false;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));

  function parseOptions(raw) {
    if (Array.isArray(raw)) return raw.map((item,index) => typeof item === "string"
      ? {label:String.fromCharCode(65 + index),text:item} : item);
    if (typeof raw === "string") {
      try { return parseOptions(JSON.parse(raw)); } catch { return []; }
    }
    if (raw && typeof raw === "object") return Object.entries(raw).map(([label,text]) =>
      typeof text === "object" && text !== null ? {label,...text} : {label,text:String(text)}
    );
    return [];
  }

  function setStatus(message, error = false) {
    const el = $("quizStatus");
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
    el.classList.toggle("error", !!error);
  }

  function getVisitorKey() {
    let key = localStorage.getItem("drillgre_guest_visitor_key_v1");
    if (!key || key.length < 32) {
      key = crypto.randomUUID() + "-" + crypto.randomUUID();
      localStorage.setItem("drillgre_guest_visitor_key_v1", key);
    }
    return key;
  }

  function standardSeconds(count) {
    const perQuestion = count <= 12 ? 21 * 60 / 12 : 26 * 60 / 15;
    return Math.round(count * perQuestion);
  }

  function durationFor(count, mode) {
    if (mode === "untimed") return null;
    const multiplier = mode === "time_and_half" ? 1.5 : mode === "double" ? 2 : 1;
    return Math.round(standardSeconds(count) * multiplier);
  }

  function formatTime(seconds) {
    const safe = Math.max(0,Math.floor(seconds));
    return String(Math.floor(safe / 60)).padStart(2,"0") + ":" + String(safe % 60).padStart(2,"0");
  }

  function timingLabel(mode = state?.timingMode || timingMode) {
    return ({
      standard:"Standard GRE timing",
      time_and_half:"50% extra time",
      double:"Double time",
      untimed:"Untimed practice"
    })[mode] || "Standard GRE timing";
  }

  function saveState() {
    if (!state) return;
    try { sessionStorage.setItem(STATE_KEY,JSON.stringify(state)); } catch {}
  }

  function shuffle(items) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i],out[j]] = [out[j],out[i]];
    }
    return out;
  }

  async function fetchQuestionPool() {
    const pool = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const {data,error} = await db.from("questions")
        .select("id,topic,topic_category,subtopic,question_type,difficulty,question_text,options,figure_url,stimulus_id,question_usage")
        .eq("published",true)
        .in("question_usage",["practice","both"])
        .order("created_at",{ascending:false})
        .range(offset,offset + pageSize - 1);
      if (error) throw error;
      const batch = data || [];
      pool.push(...batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
    const selected = new Set(selectedSubtopics);
    return pool.filter(q => selected.has((q.topic_category || "arithmetic") + "::" + (q.subtopic || "arithmetic_other")));
  }

  async function loadStimuli(list) {
    const ids = [...new Set(list.map(q => q.stimulus_id).filter(Boolean).map(String))];
    if (!ids.length) return list;
    const {data,error} = await db.from("question_stimuli")
      .select("id,title,stimulus_text,figure_url")
      .in("id",ids);
    if (error) throw new Error("Could not load a shared Data Interpretation stimulus. " + error.message);
    const map = new Map((data || []).map(item => [String(item.id),item]));
    return list.map(q => {
      const stimulus = map.get(String(q.stimulus_id)) || {};
      return {
        ...q,
        stimulus_title:stimulus.title || "",
        stimulus_text:stimulus.stimulus_text || "",
        stimulus_figure_url:stimulus.figure_url || ""
      };
    });
  }

  function sharedStimulusMarkup(q) {
    const figure = q.stimulus_figure_url
      ? '<img class="question-figure" src="' + esc(q.stimulus_figure_url) + '" alt="' + esc(q.stimulus_title || "Shared Data Interpretation figure") + '">'
      : "";
    const context = q.stimulus_text ? '<p class="stimulus-context">' + esc(q.stimulus_text) + '</p>' : "";
    return '<section class="shared-stimulus"><div class="stimulus-label">Shared Data Interpretation stimulus</div>' +
      '<h3>' + esc(q.stimulus_title || "Data set") + '</h3>' + context + figure + '</section>';
  }

  function answerMarkup(q) {
    if (q.question_type === "quantitative_comparison") {
      const options = parseOptions(q.options);
      const a = options.find(x => /quantity.?a/i.test(x.label || ""))?.text || options[0]?.text || "";
      const b = options.find(x => /quantity.?b/i.test(x.label || ""))?.text || options[1]?.text || "";
      return '<div class="qc-comparison">' +
        '<div class="qc-column"><div class="qc-label">Quantity A</div><div class="qc-value">' + esc(a) + '</div></div>' +
        '<div class="qc-column"><div class="qc-label">Quantity B</div><div class="qc-value">' + esc(b) + '</div></div>' +
      '</div>' +
      [
        ["A","Quantity A is greater"],
        ["B","Quantity B is greater"],
        ["C","The two quantities are equal"],
        ["D","The relationship cannot be determined"]
      ].map(([value,label]) => '<label class="answer-choice"><input type="radio" name="currentAnswer" value="' + value + '">' +
        '<span><b>' + value + '.</b> ' + label + '</span></label>').join("");
    }

    if (q.question_type === "numeric_entry") {
      return '<label class="numeric-wrap">Your answer<input class="numeric-answer" id="numericAnswer" type="number" step="any" inputmode="decimal" placeholder="Enter a number"></label>';
    }

    const multiple = q.question_type === "multiple_choice_multiple";
    return parseOptions(q.options).map((option,index) => {
      const value = String(option.label || String.fromCharCode(65 + index));
      return '<label class="answer-choice"><input type="' + (multiple ? "checkbox" : "radio") + '" name="currentAnswer" value="' + esc(value) + '">' +
        '<span><b>' + esc(value) + '.</b> ' + esc(option.text ?? "") + '</span></label>';
    }).join("");
  }

  function getResponseFromScreen(q) {
    if (q.question_type === "numeric_entry") {
      const value = $("numericAnswer")?.value.trim() || "";
      return value === "" ? null : value;
    }
    const values = [...$("questionPanel").querySelectorAll('input[name="currentAnswer"]:checked')].map(input => input.value);
    if (!values.length) return null;
    return q.question_type === "multiple_choice_multiple" ? values : values[0];
  }

  function responsePayload() {
    return questions.map(q => ({
      question_id:String(q.id),
      response:state.responses[String(q.id)] === undefined ? null : state.responses[String(q.id)]
    }));
  }

  function persistProgress() {
    if (!state || state.status !== "in_progress") return Promise.resolve();
    const payload = {
      p_attempt_id:state.attemptId,
      p_session_token:state.sessionToken,
      p_visitor_key:visitorKey,
      p_responses:responsePayload(),
      p_flagged_question_ids:state.flagged,
      p_current_position:state.currentIndex
    };
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      const {error} = await db.rpc("save_gre_topic_quiz_progress",payload);
      if (error) throw error;
      saveState();
      return true;
    });
    return saveQueue;
  }

  function scheduleSave() {
    saveState();
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      persistProgress().catch(error => setStatus("Your latest change could not be saved. " + error.message,true));
    },350);
  }

  function storeCurrentResponse() {
    if (!state || !questions.length) return;
    const q = questions[state.currentIndex];
    if (!q) return;
    state.responses[String(q.id)] = getResponseFromScreen(q);
    scheduleSave();
    renderNavigation();
    updateAnsweredSummary();
  }

  function restoreResponse(q) {
    const response = state.responses[String(q.id)];
    if (response === null || response === undefined) return;
    if (q.question_type === "numeric_entry") {
      const input = $("numericAnswer");
      if (input) input.value = String(response);
      return;
    }
    const values = Array.isArray(response) ? response : [response];
    $("questionPanel").querySelectorAll('input[name="currentAnswer"]').forEach(input => {
      input.checked = values.includes(input.value);
    });
  }

  function responseIsAnswered(q) {
    const response = state.responses[String(q.id)];
    if (Array.isArray(response)) return response.length > 0;
    return response !== null && response !== undefined && String(response).trim() !== "";
  }

  function updateAnsweredSummary() {
    const answered = questions.filter(responseIsAnswered).length;
    $("answeredSummary").textContent = answered + " of " + questions.length + " answered";
  }

  function renderNavigation() {
    $("questionNav").innerHTML = questions.map((q,index) => {
      const classes = [
        index === state.currentIndex ? "current" : "",
        responseIsAnswered(q) ? "answered" : "",
        state.flagged.includes(String(q.id)) ? "flagged" : ""
      ].filter(Boolean).join(" ");
      return '<button type="button" class="' + classes + '" data-nav-question="' + index + '" aria-label="Go to question ' + (index+1) + '">' + (index+1) + '</button>';
    }).join("");
    $("questionNav").querySelectorAll("[data-nav-question]").forEach(button => {
      button.addEventListener("click",() => goToQuestion(Number(button.dataset.navQuestion)));
    });
  }

  function renderCurrentQuestion() {
    const q = questions[state.currentIndex];
    if (!q) return;
    const index = state.currentIndex;
    const figure = !q.stimulus_id && q.figure_url
      ? '<img class="question-figure" src="' + esc(q.figure_url) + '" alt="Question figure" loading="lazy">'
      : "";
    const stimulus = q.stimulus_id ? sharedStimulusMarkup(q) : "";
    const flagged = state.flagged.includes(String(q.id));
    $("questionPanel").innerHTML =
      '<div class="question-panel-head">' +
        '<span class="question-count-label">Question ' + (index+1) + ' of ' + questions.length + '</span>' +
        '<button id="flagQuestion" type="button" class="flag-button ' + (flagged ? "active" : "") + '">' + (flagged ? "Marked for Review" : "Mark for Review") + '</button>' +
      '</div>' +
      '<div class="question-body">' + stimulus +
        '<div class="question-prompt">' + esc(q.question_text || "") + '</div>' +
        figure +
        '<div class="answer-area">' + answerMarkup(q) + '</div>' +
      '</div>';

    $("questionPanel").querySelectorAll('input[name="currentAnswer"],#numericAnswer').forEach(input => {
      input.addEventListener("input",storeCurrentResponse);
      input.addEventListener("change",storeCurrentResponse);
    });
    restoreResponse(q);
    $("flagQuestion").addEventListener("click",() => {
      const id = String(q.id);
      state.flagged = state.flagged.includes(id)
        ? state.flagged.filter(value => value !== id)
        : [...state.flagged,id];
      scheduleSave();
      renderCurrentQuestion();
      renderNavigation();
    });
    $("previousQuestion").disabled = index === 0;
    $("nextQuestion").disabled = index === questions.length - 1;
    renderNavigation();
    updateAnsweredSummary();
    saveState();
  }

  function goToQuestion(index) {
    storeCurrentResponse();
    state.currentIndex = Math.max(0,Math.min(questions.length-1,index));
    scheduleSave();
    $("reviewPanel").hidden = true;
    $("resultPanel").hidden = true;
    $("testPanel").hidden = false;
    renderCurrentQuestion();
    setStatus("");
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function renderReviewSummary() {
    const unanswered = questions.filter(q => !responseIsAnswered(q)).length;
    const flagged = questions.filter(q => state.flagged.includes(String(q.id))).length;
    $("reviewSummary").innerHTML =
      '<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:#344158;margin:14px 0">' +
        '<span><b>' + (questions.length-unanswered) + '</b> answered</span>' +
        '<span><b>' + unanswered + '</b> unanswered</span>' +
        '<span><b>' + flagged + '</b> marked for review</span>' +
      '</div>' +
      '<table class="review-table"><thead><tr><th>Question</th><th>Status</th><th>Review mark</th><th></th></tr></thead><tbody>' +
      questions.map((q,index) => '<tr><td>Question ' + (index+1) + '</td>' +
        '<td>' + (responseIsAnswered(q) ? "Answered" : "Not answered") + '</td>' +
        '<td>' + (state.flagged.includes(String(q.id)) ? "Marked" : "—") + '</td>' +
        '<td><button type="button" data-return-question="' + index + '">Review</button></td></tr>').join("") +
      '</tbody></table>';
    $("reviewSummary").querySelectorAll("[data-return-question]").forEach(button => {
      button.addEventListener("click",() => goToQuestion(Number(button.dataset.returnQuestion)));
    });
  }

  function correctAnswerText(q,answer) {
    if (q.question_type === "numeric_entry") return String(answer && typeof answer === "object" ? answer.value : answer ?? "");
    if (Array.isArray(answer)) return answer.join(", ");
    if (q.question_type === "quantitative_comparison") {
      return ({
        A:"Quantity A is greater",
        B:"Quantity B is greater",
        C:"The two quantities are equal",
        D:"The relationship cannot be determined"
      })[String(answer)] || String(answer ?? "");
    }
    return String(answer ?? "");
  }

  function answerDisplay(answer) {
    if (answer === null || answer === undefined || answer === "") return "Not answered";
    return Array.isArray(answer) ? (answer.length ? answer.join(", ") : "Not answered") : String(answer);
  }

  function reviewOptionsMarkup(q) {
    const options = parseOptions(q.options);
    if (q.question_type === "quantitative_comparison") {
      const a = options.find(x => /quantity.?a/i.test(x.label || ""))?.text || options[0]?.text || "";
      const b = options.find(x => /quantity.?b/i.test(x.label || ""))?.text || options[1]?.text || "";
      return '<div class="qc-comparison"><div class="qc-column"><div class="qc-label">Quantity A</div><div class="qc-value">' + esc(a) + '</div></div>' +
        '<div class="qc-column"><div class="qc-label">Quantity B</div><div class="qc-value">' + esc(b) + '</div></div></div>';
    }
    return options.length ? '<ul>' + options.map((option,index) =>
      '<li><b>' + esc(option.label || String.fromCharCode(65+index)) + '.</b> ' + esc(option.text ?? "") + '</li>'
    ).join("") + '</ul>' : "";
  }

  function videoEmbed(raw) {
    if (!raw) return "";
    try {
      const url = new URL(raw.trim());
      let id = "";
      if (url.hostname === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
      else if (["youtube.com","www.youtube.com","m.youtube.com","youtube-nocookie.com","www.youtube-nocookie.com"].includes(url.hostname)) {
        if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
        else if (/^\/(embed|shorts)\//.test(url.pathname)) id = url.pathname.split("/")[2] || "";
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? "https://www.youtube-nocookie.com/embed/" + id : "";
    } catch { return ""; }
  }

  function renderResults(review,secondsUsed) {
    const questionMap = new Map(questions.map(question => [String(question.id),question]));
    const items = review.map(item => {
      const savedQuestion = item.question || {};
      const loadedQuestion = questionMap.get(String(savedQuestion.id)) || {};
      return {
        question:{...loadedQuestion,...savedQuestion},
        response:item.response,
        grade:{
          correct:!!item.is_correct,
          correct_answer:item.correct_answer,
          explanation:item.explanation,
          explanation_type:item.explanation_type || "text",
          explanation_video_url:item.explanation_video_url
        }
      };
    });
    const correct = items.filter(item => item.grade.correct).length;
    $("testPanel").hidden = true;
    $("reviewPanel").hidden = true;
    $("resultPanel").hidden = false;
    $("resultScore").innerHTML = correct + ' <span>/ ' + items.length + '</span>';
    $("resultSubtitle").textContent = "Topic quiz completed · " + timingLabel() + " · " + formatTime(secondsUsed) + " elapsed";
    $("resultDetail").textContent = correct + " correct · " + (items.length-correct) + " incorrect or unanswered";

    const seenStimuli = new Set();
    $("resultReview").innerHTML = items.map((item,index) => {
      const q = item.question;
      let stimulus = "";
      if (q.stimulus_id && !seenStimuli.has(String(q.stimulus_id))) {
        seenStimuli.add(String(q.stimulus_id));
        stimulus = sharedStimulusMarkup(q);
      }
      const figure = !q.stimulus_id && q.figure_url
        ? '<img class="question-figure" src="' + esc(q.figure_url) + '" alt="Question figure">'
        : "";
      let explanation = "";
      if ((item.grade.explanation_type === "text" || item.grade.explanation_type === "both") && item.grade.explanation) {
        explanation += '<div class="review-explanation">' + esc(item.grade.explanation) + '</div>';
      }
      const embed = videoEmbed(item.grade.explanation_video_url);
      if ((item.grade.explanation_type === "video" || item.grade.explanation_type === "both") && embed) {
        explanation += '<div class="review-explanation"><iframe src="' + esc(embed) + '" title="Question ' + (index+1) + ' explanation" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="width:100%;max-width:560px;aspect-ratio:16/9;border:0;border-radius:9px"></iframe></div>';
      }
      return '<article class="result-question ' + (item.grade.correct ? "right" : "wrong") + '">' +
        '<h3>Question ' + (index+1) + ' · ' + (item.grade.correct ? "Correct" : "Incorrect / unanswered") + '</h3>' +
        stimulus +
        '<div class="question-prompt">' + esc(q.question_text || "") + '</div>' +
        figure + reviewOptionsMarkup(q) +
        '<div class="review-answer"><b>Your answer:</b> ' + esc(answerDisplay(item.response)) +
          '<br><b>Correct answer:</b> ' + esc(correctAnswerText(q,item.grade.correct_answer)) + '</div>' +
        explanation +
      '</article>';
    }).join("");
    state.status = "completed";
    saveState();
  }

  function renderTimer() {
    if (!state || state.deadlineAt === null) {
      $("quizTimer").textContent = "Untimed";
      $("timerCard").classList.remove("low-time");
      return;
    }
    const remaining = Math.max(0,Math.ceil((state.deadlineAt-Date.now())/1000));
    $("quizTimer").textContent = formatTime(remaining);
    $("timerCard").classList.toggle("low-time",remaining <= 300);
    if (remaining <= 0 && !timeoutTriggered && !submitting) {
      timeoutTriggered = true;
      submitQuiz(true);
    }
  }

  async function submitQuiz(automatic = false) {
    if (submitting || !questions.length) return;
    if (!automatic) {
      const unanswered = questions.filter(q => !responseIsAnswered(q)).length;
      const message = unanswered
        ? "You have " + unanswered + " unanswered question(s). Submit the quiz anyway?"
        : "Submit your quiz now?";
      if (!window.confirm(message)) return;
    }

    if (timerInterval) clearInterval(timerInterval);
    if (saveTimeout) clearTimeout(saveTimeout);
    submitting = true;
    $("finalSubmit").disabled = true;
    $("reviewQuiz").disabled = true;
    $("finalSubmit").textContent = "Submitting…";
    setStatus("Checking your answers…");
    storeCurrentResponse();

    try {
      const {data,error} = await db.rpc("finish_gre_topic_quiz",{
        p_attempt_id:state.attemptId,
        p_session_token:state.sessionToken,
        p_visitor_key:visitorKey,
        p_responses:responsePayload(),
        p_flagged_question_ids:state.flagged,
        p_current_position:state.currentIndex
      });
      if (error) throw error;
      if (!data || data.status !== "completed") throw new Error(data?.error || "The quiz could not be completed.");

      const secondsUsed = Math.max(0,Math.round((Date.now()-state.startedAt)/1000));
      renderResults(data.review || [],secondsUsed);
      setStatus("");
      window.scrollTo({top:0,behavior:"smooth"});
    } catch (error) {
      submitting = false;
      timeoutTriggered = false;
      $("finalSubmit").disabled = false;
      $("reviewQuiz").disabled = false;
      $("finalSubmit").textContent = "Retry submission";
      setStatus("Could not submit the quiz. " + (error.message || "Check the Supabase quiz progress migration and try again."),true);
      if (state.deadlineAt === null || state.deadlineAt > Date.now()) {
        timerInterval = setInterval(renderTimer,1000);
      } else {
        $("testPanel").hidden = true;
        $("reviewPanel").hidden = false;
        renderReviewSummary();
      }
    }
  }

  function showReview() {
    storeCurrentResponse();
    renderReviewSummary();
    $("testPanel").hidden = true;
    $("reviewPanel").hidden = false;
    window.scrollTo({top:0,behavior:"smooth"});
    persistProgress().catch(error => setStatus("Progress could not be saved. " + error.message,true));
  }

  function startTimer() {
    renderTimer();
    if (state.deadlineAt !== null) timerInterval = setInterval(renderTimer,1000);
  }

  async function beginQuiz(questionList,attemptData) {
    questions = questionList;
    state = {
      attemptId:attemptData.attempt_id,
      sessionToken:attemptData.session_token || sessionToken,
      status:attemptData.status || "in_progress",
      questionIds:questions.map(q => String(q.id)),
      timingMode:attemptData.timing_mode || timingMode,
      durationSeconds:attemptData.duration_seconds ?? durationFor(questions.length,attemptData.timing_mode || timingMode),
      startedAt:new Date(attemptData.started_at || Date.now()).getTime(),
      deadlineAt:attemptData.deadline_at ? new Date(attemptData.deadline_at).getTime() : null,
      currentIndex:Math.max(0,Math.min(questions.length-1,Number(attemptData.current_position || 0))),
      responses:attemptData.responses || {},
      flagged:(attemptData.flagged_question_ids || []).map(String)
    };
    saveState();

    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("attempt",state.attemptId);
    url.searchParams.set("token",state.sessionToken);
    window.history.replaceState({}, "", url.toString());

    $("loadingPanel").hidden = true;
    $("testPanel").hidden = false;
    $("quizSubtitle").textContent = "Topic practice · " + questions.length + " questions · " + timingLabel();
    renderCurrentQuestion();

    $("previousQuestion").addEventListener("click",() => goToQuestion(state.currentIndex-1));
    $("nextQuestion").addEventListener("click",() => goToQuestion(state.currentIndex+1));
    $("reviewQuiz").addEventListener("click",showReview);
    $("returnToQuiz").addEventListener("click",() => {
      $("reviewPanel").hidden = true;
      $("testPanel").hidden = false;
      renderCurrentQuestion();
    });
    $("finalSubmit").addEventListener("click",() => submitQuiz(false));

    document.addEventListener("visibilitychange",() => {
      if (document.visibilityState === "hidden") persistProgress().catch(() => {});
    });
    window.addEventListener("pagehide",() => persistProgress().catch(() => {}));
    startTimer();
  }

  async function startNewAttempt() {
    try { selectedSubtopics = JSON.parse(params.get("subtopics") || "[]"); }
    catch { selectedSubtopics = []; }
    if (!Array.isArray(selectedSubtopics) || !selectedSubtopics.length) {
      throw new Error("No topics were selected. Close this tab and start a new quiz from Quant → Quiz.");
    }
    const pool = await fetchQuestionPool();
    if (pool.length < requestedCount) {
      throw new Error("Only " + pool.length + " eligible questions are available for your selections. Return to Quant → Quiz and select more subtopics or a smaller quiz.");
    }
    const selected = shuffle(pool).slice(0,requestedCount);
    const duration = durationFor(requestedCount,timingMode);
    const {data,error} = await db.rpc("start_gre_topic_quiz",{
      p_session_token:sessionToken,
      p_visitor_key:visitorKey,
      p_question_ids:selected.map(q => String(q.id)),
      p_topic_keys:selectedSubtopics,
      p_timing_mode:timingMode,
      p_duration_seconds:duration
    });
    if (error) throw error;
    if (!data || !data.attempt_id) throw new Error(data?.error || "A quiz attempt could not be started.");
    const questionList = await loadStimuli(data.questions || []);
    await beginQuiz(questionList,{...data,duration_seconds:duration});
  }

  async function resumeAttempt() {
    if (!sessionToken) throw new Error("The quiz resume link is missing its session token. Return to Quant → Quiz and use Resume quiz.");
    const {data,error} = await db.rpc("get_gre_topic_quiz_attempt",{
      p_attempt_id:savedAttemptId,
      p_session_token:sessionToken,
      p_visitor_key:visitorKey
    });
    if (error) throw error;
    if (!data) throw new Error("This quiz is no longer available.");
    const questionList = await loadStimuli(data.questions || []);
    if (data.status === "completed") {
      questions = questionList;
      state = {
        attemptId:data.attempt_id,
        sessionToken:data.session_token || sessionToken,
        status:"completed",
        questionIds:questions.map(q=>String(q.id)),
        timingMode:data.timing_mode || "standard",
        durationSeconds:data.duration_seconds,
        startedAt:new Date(data.started_at || Date.now()).getTime(),
        deadlineAt:data.deadline_at ? new Date(data.deadline_at).getTime() : null,
        currentIndex:0,
        responses:data.responses || {},
        flagged:(data.flagged_question_ids || []).map(String)
      };
      $("loadingPanel").hidden = true;
      renderResults(data.review || [],Math.max(0,Math.round((Date.now()-state.startedAt)/1000)));
      return;
    }
    if (data.status !== "in_progress") throw new Error("This quiz is no longer available to resume.");
    await beginQuiz(questionList,data);
  }

  async function init() {
    visitorKey = getVisitorKey();
    try {
      const {data:sessionData} = await db.auth.getSession();
      if (sessionData?.session?.user) {
        const {error:claimError} = await db.rpc("claim_guest_topic_quiz_attempts",{p_visitor_key:visitorKey});
        if (claimError) throw claimError;
      }
      db.auth.onAuthStateChange(event => {
        if (event === "SIGNED_IN") {
          setTimeout(() => {
            db.rpc("claim_guest_topic_quiz_attempts",{p_visitor_key:visitorKey})
              .catch(() => {});
          },0);
        }
      });
      if (savedAttemptId) {
        await resumeAttempt();
      } else {
        await startNewAttempt();
      }
    } catch (error) {
      $("loadingPanel").textContent = error.message || "Unable to load your topic quiz.";
      $("loadingPanel").classList.add("error");
    }
  }

  document.addEventListener("DOMContentLoaded",init);
})();