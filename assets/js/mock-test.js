(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const ACTIVE_KEY = "drillgre_active_mock_v1";
  const DRAFT_KEY = "drillgre_mock_answers_v1";
  const VISITOR_KEY = "drillgre_guest_visitor_key_v1";
  const GUEST_USED_KEY = "drillgre_guest_mocks_used_v1";
  const TIMING_MODE_KEY = "drillgre_mock_timing_mode_v1";
  const STANDARD_SECONDS = {1:21*60, 2:26*60};
  const $ = id => document.getElementById(id);
  let active = null;
  let currentQuestions = [];
  let timerInterval = null;
  let timerSubmitting = false;
  let submissionInProgress = false;
  let trackedQuestionId = null;
  let trackedQuestionStartedAt = 0;
  let questionVisibility = new Map();
  let questionObserver = null;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));

  function token() {
    return crypto.randomUUID() + "-" + crypto.randomUUID();
  }

  function visitorKey() {
    let key = localStorage.getItem(VISITOR_KEY);
    if (!key || key.length < 32) {
      key = crypto.randomUUID() + "-" + crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, key);
    }
    return key;
  }

  function timingMode() {
    return active?.timing_mode || $("timingMode")?.value || localStorage.getItem(TIMING_MODE_KEY) || "standard";
  }
  function timingMultiplier(mode) {
    return mode === "time_and_half" ? 1.5 : mode === "double" ? 2 : 1;
  }
  function sectionAllowance(section, mode = timingMode()) {
    return mode === "untimed" ? null : Math.round(STANDARD_SECONDS[section] * timingMultiplier(mode));
  }
  function timingModeLabel(mode = timingMode()) {
    return ({standard:"Standard GRE timing",time_and_half:"50% extra time",double:"Double time",untimed:"Untimed practice"})[mode] || "Standard GRE timing";
  }
  function formatDuration(seconds) {
    const safe = Math.max(0, Math.round(Number(seconds) || 0));
    return String(Math.floor(safe / 60)).padStart(2,"0") + ":" + String(safe % 60).padStart(2,"0");
  }
  function persistActive() {
    if (active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
  }
  function flushTrackedQuestion() {
    if (!active || !trackedQuestionId || !trackedQuestionStartedAt) return;
    const elapsed = Math.max(0, (performance.now() - trackedQuestionStartedAt) / 1000);
    active.question_times = active.question_times || {};
    active.question_times[trackedQuestionId] = Number(active.question_times[trackedQuestionId] || 0) + elapsed;
    trackedQuestionStartedAt = performance.now();
    persistActive();
  }
  function stopTrackedQuestion() {
    flushTrackedQuestion();
    trackedQuestionId = null;
    trackedQuestionStartedAt = 0;
  }
  function trackQuestion(questionId) {
    const next = questionId ? String(questionId) : null;
    if (next === trackedQuestionId) return;
    stopTrackedQuestion();
    if (next && !document.hidden && active) {
      trackedQuestionId = next;
      trackedQuestionStartedAt = performance.now();
    }
  }
  function selectVisibleQuestion() {
    if (document.hidden) return trackQuestion(null);
    let bestId = null, bestRatio = 0.18;
    for (const [id, ratio] of questionVisibility.entries()) {
      if (ratio > bestRatio) { bestRatio = ratio; bestId = id; }
    }
    trackQuestion(bestId);
  }
  function setupQuestionTiming() {
    if (questionObserver) questionObserver.disconnect();
    questionObserver = null;
    questionVisibility = new Map();
    stopTrackedQuestion();
    if (!("IntersectionObserver" in window)) return;
    questionObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = entry.target.dataset.qid;
        if (id) questionVisibility.set(String(id), entry.isIntersecting ? entry.intersectionRatio : 0);
      }
      selectVisibleQuestion();
    }, {threshold:[0,0.15,0.25,0.4,0.6,0.8,1]});
    $("questionStack").querySelectorAll(".mock-question[data-qid]").forEach(card => questionObserver.observe(card));
  }
  function questionTimesPayload() {
    flushTrackedQuestion();
    return Object.entries(active?.question_times || {}).map(([question_id,seconds]) => ({
      question_id, seconds:Math.max(0,Math.round(Number(seconds)||0))
    }));
  }
  function updateTimerDisplay() {
    if (!active || !$("sectionTimer")) return;
    const mode = timingMode(), card = $("timerCard");
    card.classList.remove("low-time");
    if (mode === "untimed" || !active.deadline_ts) {
      $("timerLabel").textContent = "Time";
      $("sectionTimer").textContent = "Untimed";
      $("timerModeLabel").textContent = timingModeLabel(mode);
      return;
    }
    const remaining = Math.max(0,Math.ceil((active.deadline_ts-Date.now())/1000));
    $("timerLabel").textContent = "Time remaining";
    $("sectionTimer").textContent = formatDuration(remaining);
    $("timerModeLabel").textContent = timingModeLabel(mode);
    if (remaining <= 300) card.classList.add("low-time");
    return remaining;
  }
  function stopSectionTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }
  function startSectionTimer() {
    stopSectionTimer();
    timerSubmitting = false;
    const tick = () => {
      flushTrackedQuestion();
      const remaining = updateTimerDisplay();
      persistActive();
      if (remaining !== undefined && remaining <= 0 && !timerSubmitting) {
        timerSubmitting = true;
        stopTrackedQuestion();
        stopSectionTimer();
        setStatus("Time has expired. Submitting this section…");
        submitSection(true);
      }
    };
    tick();
    timerInterval = setInterval(tick,1000);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) trackQuestion(null);
    else selectVisibleQuestion();
  });

  async function refreshAccessNote(remaining = null) {
    const note = $("mockAccessNote");
    if (!note) return;
    const { data } = await db.auth.getSession();
    if (data.session) {
      note.innerHTML = 'You are signed in. You can create unlimited mock tests. <a href="../dashboard.html">Open your learner dashboard</a>.';
      return;
    }

    const used = Number(localStorage.getItem(GUEST_USED_KEY) || 0);
    const left = remaining === null ? Math.max(0, 2 - used) : remaining;
    if (left > 0) {
      note.innerHTML = `Guest access: ${left} of 2 free mock attempts remaining on this browser. <a href="../account.html">Sign in or create an account</a> for unlimited mocks.`;
    } else {
      note.innerHTML = 'You have used both free mock attempts on this browser. <a href="../account.html">Sign in with email and password</a> to continue with unlimited mocks.';
    }
  }

  function setStatus(text, error=false) {
    $("mockStatus").hidden = !text;
    $("mockStatus").textContent = text;
    $("mockStatus").classList.toggle("error",error);
  }

  function parseOptions(raw) {
    if (Array.isArray(raw)) return raw.map((item,index) => typeof item === "string"
      ? {label:String.fromCharCode(65+index),text:item}
      : item);
    if (typeof raw === "string") {
      try { return parseOptions(JSON.parse(raw)); } catch { return []; }
    }
    return [];
  }

  const categoryLabels = {
    arithmetic: "Arithmetic",
    data_analysis: "Data Analysis",
    algebra: "Algebra",
    geometry: "Geometry"
  };

  function topicLabel(q) {
    const broad = categoryLabels[q.topic_category] || q.topic || "Quantitative Reasoning";
    const sub = String(q.subtopic || "").replaceAll("_", " ");
    return sub ? broad + " · " + sub : broad;
  }

  function sharedStimulusMarkup(q) {
    const figure = q.stimulus_figure_url
      ? `<img class="question-figure" src="${esc(q.stimulus_figure_url)}" alt="${esc(q.stimulus_title || "Shared Data Analysis figure")}" loading="lazy">`
      : "";
    const context = q.stimulus_text
      ? `<p class="stimulus-context">${esc(q.stimulus_text)}</p>`
      : "";
    return `
      <section class="shared-stimulus">
        <div class="stimulus-label">Shared Data Analysis stimulus</div>
        <h3>${esc(q.stimulus_title || "Data set")}</h3>
        ${context}
        ${figure}
        <p class="stimulus-instruction">Use this same figure or data set for the three linked questions immediately below.</p>
      </section>`;
  }

  function questionAnswerMarkup(q) {
    if (q.question_type === "quantitative_comparison") {
      const opts = parseOptions(q.options);
      const a = opts.find(x => /quantity.?a/i.test(x.label || ""))?.text || opts[0]?.text || "";
      const b = opts.find(x => /quantity.?b/i.test(x.label || ""))?.text || opts[1]?.text || "";
      return `
        <div class="quantities">
          <div><b>Quantity A</b><p>${esc(a)}</p></div>
          <div><b>Quantity B</b><p>${esc(b)}</p></div>
        </div>
        ${[
          ["A","Quantity A is greater"],
          ["B","Quantity B is greater"],
          ["C","The two quantities are equal"],
          ["D","The relationship cannot be determined"]
        ].map(([value,label])=>`
          <label class="mock-option"><input type="radio" name="q-${esc(q.id)}" value="${value}"><span><b>${value}.</b> ${label}</span></label>
        `).join("")}`;
    }

    if (q.question_type === "numeric_entry") {
      return `<label class="numeric-wrap">Your answer<input class="numeric-answer" id="numeric-${esc(q.id)}" type="number" step="any" inputmode="decimal" placeholder="Enter a number"></label>`;
    }

    const multiple = q.question_type === "multiple_choice_multiple";
    return parseOptions(q.options).map((opt,index) => {
      const value = String(opt.label || String.fromCharCode(65+index));
      return `
        <label class="mock-option">
          <input type="${multiple ? "checkbox" : "radio"}" name="q-${esc(q.id)}" value="${esc(value)}">
          <span><b>${esc(value)}.</b> ${esc(opt.text ?? "")}</span>
        </label>`;
    }).join("");
  }

  function collectResponses() {
    return currentQuestions.map(q => {
      const card = $("questionStack").querySelector('[data-qid="' + CSS.escape(String(q.id)) + '"]');
      if (!card) return null;
      if (q.question_type === "numeric_entry") {
        const value = card.querySelector(".numeric-answer")?.value.trim() || "";
        return value === "" ? null : {question_id:String(q.id),response:value};
      }
      const selected = [...card.querySelectorAll("input:checked")].map(input=>input.value);
      if (!selected.length) return null;
      const response = q.question_type === "multiple_choice_multiple" ? selected : selected[0];
      return {question_id:String(q.id),response};
    }).filter(Boolean);
  }

  function saveDraftResponses() {
    if (!active) return;
    flushTrackedQuestion();
    active.question_times = active.question_times || {};
    persistActive();
    const draft = {
      attempt_id: active.attempt_id,
      status: active.status,
      responses: collectResponses(),
      question_times: active.question_times
    };
    localStorage.setItem(DRAFT_KEY,JSON.stringify(draft));
  }

  function restoreDraftResponses() {
    if (!active) return;
    let draft;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch {}
    if (!draft || draft.attempt_id !== active.attempt_id || draft.status !== active.status) return;

    if (draft.question_times && typeof draft.question_times === "object") {
      active.question_times = draft.question_times;
      persistActive();
    }
    (draft.responses || []).forEach(item => {
      const q = currentQuestions.find(question => String(question.id) === String(item.question_id));
      if (!q) return;
      const card = $("questionStack").querySelector('[data-qid="' + CSS.escape(String(q.id)) + '"]');
      if (!card) return;

      if (q.question_type === "numeric_entry") {
        const field = card.querySelector(".numeric-answer");
        if (field) field.value = String(item.response ?? "");
      } else {
        const values = Array.isArray(item.response) ? item.response.map(String) : [String(item.response)];
        card.querySelectorAll("input").forEach(input => {
          input.checked = values.includes(input.value);
        });
      }
      card.classList.add("answered");
    });
    updateProgress();
  }

  function updateProgress() {
    const answered = [...$("questionStack").querySelectorAll(".mock-question")]
      .filter(card => card.querySelectorAll("input:checked").length > 0 ||
        (card.querySelector(".numeric-answer")?.value.trim() || "") !== "").length;
    $("answeredCount").textContent = answered + " of " + currentQuestions.length + " answered";
    $("progressFill").style.width = (currentQuestions.length ? answered/currentQuestions.length*100 : 0) + "%";
  }

  function renderQuestions(questions) {
    currentQuestions = questions || [];
    const seenStimuli = new Set();

    $("questionStack").innerHTML = currentQuestions.map((q,index) => {
      let stimulus = "";
      if (q.stimulus_id && !seenStimuli.has(String(q.stimulus_id))) {
        seenStimuli.add(String(q.stimulus_id));
        stimulus = sharedStimulusMarkup(q);
      }

      const individualFigure = !q.stimulus_id && q.figure_url
        ? `<img class="question-figure" src="${esc(q.figure_url)}" alt="Question figure" loading="lazy">`
        : "";

      return `
        ${stimulus}
        <article class="mock-question" data-qid="${esc(q.id)}">
          <div class="question-head">
            <span class="question-number">Question ${index+1} of ${currentQuestions.length}</span>
          </div>
          <div class="question-prompt">${esc(q.question_text || "")}</div>
          ${individualFigure}
          <div class="answer-area">${questionAnswerMarkup(q)}</div>
        </article>`;
    }).join("");

    $("questionStack").querySelectorAll(".mock-question").forEach(card => {
      card.querySelectorAll("input").forEach(input => {
        const onChange = () => {
          card.classList.toggle("answered",
            card.querySelectorAll("input:checked").length > 0 ||
            (card.querySelector(".numeric-answer")?.value.trim() || "") !== "");
          updateProgress();
          saveDraftResponses();
        };
        input.addEventListener("change",onChange);
        input.addEventListener("input",onChange);
      });
    });
    restoreDraftResponses();
    updateProgress();
    setupQuestionTiming();
  }

  function displayAttemptSection(data) {
    const previous = active || {};
    const sameSection = Number(previous.section_number) === Number(data.section_number);
    const mode = previous.timing_mode || localStorage.getItem(TIMING_MODE_KEY) || "standard";
    const allowance = sectionAllowance(data.section_number, mode);
    active = {
      attempt_id:data.attempt_id,
      session_token:previous.session_token,
      visitor_key:previous.visitor_key || null,
      status:data.status,
      section_number:data.section_number,
      timing_mode:mode,
      deadline_ts:allowance === null ? null :
        (sameSection && previous.deadline_ts ? previous.deadline_ts : Date.now()+allowance*1000),
      question_times:previous.question_times || {}
    };
    localStorage.setItem(ACTIVE_KEY,JSON.stringify(active));
    $("introPanel").hidden = true;
    $("resultPanel").hidden = true;
    $("testPanel").hidden = false;
    $("sectionLabel").textContent = "Quantitative Reasoning · Section " + data.section_number;
    $("sectionTitle").textContent = "Section " + data.section_number;
    $("sectionDescription").textContent = "Work through the questions and review your answers before submitting. You may move freely within this section.";
    $("submitSection").textContent = data.section_number === 1 ? "Submit Section 1" : "Finish mock test";
    renderQuestions(data.questions || []);
    persistActive();
    startSectionTimer();
    setStatus("");
  }

  async function startMock() {
    const sessionToken = token();
    const guestKey = visitorKey();
    const mode = $("timingMode")?.value || localStorage.getItem(TIMING_MODE_KEY) || "standard";
    localStorage.setItem(TIMING_MODE_KEY,mode);
    const { data: sessionData } = await db.auth.getSession();
    const isSignedIn = !!sessionData.session;

    $("startMock").disabled = true;
    $("startMock").textContent = "Preparing questions…";
    setStatus("Selecting 12 questions from the published question bank. Please wait.");

    const {data,error} = await db.rpc("start_gre_mock",{
      p_session_token:sessionToken,
      p_visitor_key:isSignedIn ? null : guestKey
    });
    $("startMock").disabled = false;
    $("startMock").textContent = "Start adaptive mock";

    if(error) {
      if (error.message.includes("used both free mock attempts")) {
        localStorage.setItem(GUEST_USED_KEY, "2");
        await refreshAccessNote(0);
      }
      setStatus(error.message,true);
      return;
    }

    localStorage.removeItem(DRAFT_KEY);
    if (!data.is_authenticated && Number.isFinite(Number(data.guest_attempts_used))) {
      localStorage.setItem(GUEST_USED_KEY, String(data.guest_attempts_used));
    }
    active = {
      attempt_id:data.attempt_id,
      session_token:sessionToken,
      visitor_key:isSignedIn ? null : guestKey,
      status:data.status,
      section_number:1,
      timing_mode:mode,
      deadline_ts:null,
      question_times:{}
    };
    localStorage.setItem(ACTIVE_KEY,JSON.stringify(active));
    await refreshAccessNote(data.guest_attempts_remaining);
    displayAttemptSection(data);
    window.scrollTo({top:0,behavior:"smooth"});
  }

  async function resumeMock() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null"); } catch {}
    if(!saved?.attempt_id || !saved?.session_token) return;

    const { data: sessionData } = await db.auth.getSession();
    const guestKey = saved.visitor_key || (!sessionData.session ? visitorKey() : null);
    setStatus("Resuming your saved mock attempt…");
    const {data,error}=await db.rpc("resume_gre_mock",{
      p_attempt_id:saved.attempt_id,
      p_session_token:saved.session_token,
      p_visitor_key:guestKey
    });

    if(error) {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(DRAFT_KEY);
      setStatus("Your previous mock could not be resumed. You can start a new mock. "+error.message,true);
      await refreshAccessNote();
      return;
    }

    if(data.status==="completed") {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(DRAFT_KEY);
      setStatus("Your previous mock is already completed. Start a new mock to try another set.");
      return;
    }

    active={
      ...saved,
      attempt_id:saved.attempt_id,
      session_token:saved.session_token,
      visitor_key:guestKey,
      status:data.status,
      section_number:saved.section_number || data.section_number,
      timing_mode:saved.timing_mode || localStorage.getItem(TIMING_MODE_KEY) || "standard",
      question_times:saved.question_times || {}
    };
    displayAttemptSection(data);
  }

  async function submitSection(automatic = false) {
    if(!active || submissionInProgress) return;
    stopTrackedQuestion();
    const responses=collectResponses();
    const section=active.status==="section1" ? 1 : 2;
    const prompt=automatic
      ? "Time has expired. Submit this section now?"
      : "Submit this section? You will not be able to return to it after submission.";
    if(!automatic && !confirm(prompt)) {
      selectVisibleQuestion();
      return;
    }
    submissionInProgress=true;
    stopSectionTimer();
    $("submitSection").disabled=true;
    $("submitSection").textContent=section===1?"Submitting Section 1…":"Calculating score…";
    setStatus("Recording your answers…");

    const rpc=section===1 ? "submit_gre_mock_section1" : "finish_gre_mock";
    const {data,error}=await db.rpc(rpc,{
      p_attempt_id:active.attempt_id,
      p_session_token:active.session_token,
      p_responses:responses,
      p_visitor_key:active.visitor_key || null,
      p_question_times:questionTimesPayload()
    });

    $("submitSection").disabled=false;
    $("submitSection").textContent=section===1?"Submit Section 1":"Finish mock test";
    if(error) {
      submissionInProgress=false;
      setStatus(error.message,true);
      if (!automatic) startSectionTimer();
      return;
    }

    if(section===1) {
      localStorage.removeItem(DRAFT_KEY);
      displayAttemptSection(data);
      window.scrollTo({top:0,behavior:"smooth"});
    } else {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(DRAFT_KEY);
      stopSectionTimer();
      renderResult(data);
      window.scrollTo({top:0,behavior:"smooth"});
    }
  }

  function correctAnswerText(item) {
    const q=item.question;
    const answer=item.correct_answer;
    if(q.question_type==="numeric_entry") {
      return String(answer && typeof answer==="object" ? answer.value : answer ?? "");
    }
    if(Array.isArray(answer)) return answer.join(", ");
    if(q.question_type==="quantitative_comparison") {
      return ({
        A:"Quantity A is greater",
        B:"Quantity B is greater",
        C:"The two quantities are equal",
        D:"The relationship cannot be determined"
      })[String(answer)] || String(answer);
    }
    return String(answer ?? "");
  }

  function answerDisplay(item) {
    if(item.response===null || item.response===undefined) return "Not answered";
    if(Array.isArray(item.response)) return item.response.join(", ");
    return String(item.response);
  }

  function reviewOptionMarkup(question) {
    const options = parseOptions(question.options);
    if (question.question_type === "quantitative_comparison") {
      const a = options.find(x => /quantity.?a/i.test(x.label || ""))?.text || options[0]?.text || "";
      const b = options.find(x => /quantity.?b/i.test(x.label || ""))?.text || options[1]?.text || "";
      return `<div class="review-answer"><b>Quantity A:</b> ${esc(a)}<br><b>Quantity B:</b> ${esc(b)}</div>`;
    }
    if (!options.length) return "";
    return `<ul>${options.map((option,index)=>`<li><b>${esc(option.label || String.fromCharCode(65+index))}.</b> ${esc(option.text ?? "")}</li>`).join("")}</ul>`;
  }

  function renderReview(items) {
    const seenStimuli = new Set();
    $("reviewList").innerHTML=(items||[]).map((item,index)=>{
      const q=item.question||{};
      const embed=videoEmbed(item.explanation_video_url);
      let explanation="";
      if((item.explanation_type==="text"||item.explanation_type==="both")&&item.explanation) {
        explanation+=`<div class="review-explanation">${esc(item.explanation)}</div>`;
      }
      if((item.explanation_type==="video"||item.explanation_type==="both")&&embed) {
        explanation+=`<div class="review-video"><iframe src="${esc(embed)}" title="Question ${index+1} explanation" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
      }
      const stimulus = q.stimulus_id && !seenStimuli.has(String(q.stimulus_id))
        ? (seenStimuli.add(String(q.stimulus_id)), sharedStimulusMarkup(q))
        : "";
      const individualFigure = !q.stimulus_id && q.figure_url
        ? `<img class="question-figure" src="${esc(q.figure_url)}" alt="Question figure">`
        : "";
      return `
        ${stimulus}
        <article class="review-question ${item.is_correct?"right":"wrong"}">
          <div class="question-head"><b>Q${index+1} · Section ${item.section_number}</b><span class="review-time">Time on question: ${formatDuration(item.time_spent_seconds || 0)}</span><strong>${item.is_correct?"Correct":"Incorrect / blank"}</strong></div>
          <p class="question-prompt">${esc(q.question_text||"")}</p>
          ${individualFigure}
          ${reviewOptionMarkup(q)}
          <div class="review-answer"><b>Your answer:</b> ${esc(answerDisplay(item))}<br><b>Correct answer:</b> ${esc(correctAnswerText(item))}</div>
          ${explanation}
        </article>`;
    }).join("");
  }

  function videoEmbed(raw) {
    if(!raw) return "";
    try {
      const u=new URL(raw.trim()); let id="";
      if(u.hostname==="youtu.be") id=u.pathname.split("/").filter(Boolean)[0]||"";
      else if(["youtube.com","www.youtube.com","m.youtube.com","youtube-nocookie.com","www.youtube-nocookie.com"].includes(u.hostname)) {
        if(u.pathname==="/watch") id=u.searchParams.get("v")||"";
        else if(/^\/(embed|shorts)\//.test(u.pathname)) id=u.pathname.split("/")[2]||"";
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id)?"https://www.youtube-nocookie.com/embed/"+id:"";
    } catch { return ""; }
  }

  function renderResult(result) {
    $("testPanel").hidden=true;
    $("introPanel").hidden=true;
    $("resultPanel").hidden=false;
    $("scaledScore").textContent=result.scaled_score;
    $("totalCorrect").textContent=result.total_correct+" / 27";
    $("sectionOneResult").textContent=result.section1_correct+" / 12";
    $("sectionTwoResult").textContent=result.section2_correct+" / 15";
    const totalSeconds=(result.review||[]).reduce((sum,item)=>sum+Number(item.time_spent_seconds||0),0);
    $("totalTimeSpent").textContent=formatDuration(totalSeconds);
    renderReview(result.review);
  }

  $("startMock").addEventListener("click",startMock);
  $("submitSection").addEventListener("click",()=>submitSection(false));
  if ($("timingMode")) {
    $("timingMode").value=localStorage.getItem(TIMING_MODE_KEY)||"standard";
    $("timingMode").addEventListener("change",()=>localStorage.setItem(TIMING_MODE_KEY,$("timingMode").value));
  }
  $("newMock").addEventListener("click",()=>{
    stopSectionTimer();
    if (questionObserver) questionObserver.disconnect();
    active=null;
    currentQuestions=[];
    trackedQuestionId=null;
    trackedQuestionStartedAt=0;
    timerSubmitting=false;
    submissionInProgress=false;
    $("resultPanel").hidden=true;
    $("introPanel").hidden=false;
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(DRAFT_KEY);
    setStatus("");
    refreshAccessNote();
    window.scrollTo({top:0,behavior:"smooth"});
  });

  document.addEventListener("DOMContentLoaded",() => {
    refreshAccessNote();
    resumeMock();
  });
})();