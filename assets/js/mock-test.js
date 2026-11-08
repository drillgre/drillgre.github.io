(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const ACTIVE_KEY = "drillgre_active_mock_v1";
  const DRAFT_KEY = "drillgre_mock_answers_v1";
  const $ = id => document.getElementById(id);
  let active = null;
  let currentQuestions = [];

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));

  function token() {
    return crypto.randomUUID() + "-" + crypto.randomUUID();
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
        <p class="stimulus-instruction">Use this same figure or data set to answer Questions 1–3 below.</p>
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
    const draft = {
      attempt_id: active.attempt_id,
      status: active.status,
      responses: collectResponses()
    };
    localStorage.setItem(DRAFT_KEY,JSON.stringify(draft));
  }

  function restoreDraftResponses() {
    if (!active) return;
    let draft;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch {}
    if (!draft || draft.attempt_id !== active.attempt_id || draft.status !== active.status) return;

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
            <span class="difficulty">Level ${esc(q.difficulty)}</span>
            <span class="topic">${esc(topicLabel(q))}</span>
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
  }

  function displayAttemptSection(data) {
    active = {
      attempt_id:data.attempt_id,
      session_token:active.session_token,
      status:data.status
    };
    localStorage.setItem(ACTIVE_KEY,JSON.stringify(active));
    $("introPanel").hidden = true;
    $("resultPanel").hidden = true;
    $("testPanel").hidden = false;
    $("sectionLabel").textContent = data.section_number === 1 ? "Section 1 of 2" : "Section 2 of 2";
    $("sectionTitle").textContent = data.section_number === 1 ? "Adaptive foundation" : "Adaptive challenge";
    $("sectionDescription").textContent = data.section_number === 1
      ? "12 questions · Arithmetic 3, Data Analysis 4, Algebra 3, Geometry 2. Difficulty: 2 Level 1, 3 Level 2, 4 Level 3, 3 Level 4."
      : data.route === "harder"
        ? "15 questions · Arithmetic 4, Data Analysis 5, Algebra 3, Geometry 3. Difficulty: 5 Level 3, 5 Level 4, 5 Level 5. Harder route."
        : "15 questions · Arithmetic 4, Data Analysis 5, Algebra 3, Geometry 3. Difficulty: 3 Level 1, 5 Level 2, 5 Level 3, 2 Level 4. Foundation route.";
    $("submitSection").textContent = data.section_number === 1 ? "Submit Section 1" : "Finish mock test";
    renderQuestions(data.questions || []);
    setStatus("");
  }

  async function startMock() {
    const sessionToken = token();
    $("startMock").disabled = true;
    $("startMock").textContent = "Preparing questions…";
    setStatus("Selecting 12 questions from the published question bank. Please wait.");

    const {data,error} = await db.rpc("start_gre_mock",{p_session_token:sessionToken});
    $("startMock").disabled = false;
    $("startMock").textContent = "Start adaptive mock";

    if(error) {
      setStatus(error.message,true);
      return;
    }

    localStorage.removeItem(DRAFT_KEY);
    active = {attempt_id:data.attempt_id,session_token:sessionToken,status:data.status};
    localStorage.setItem(ACTIVE_KEY,JSON.stringify(active));
    displayAttemptSection(data);
    window.scrollTo({top:0,behavior:"smooth"});
  }

  async function resumeMock() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null"); } catch {}
    if(!saved?.attempt_id || !saved?.session_token) return;

    setStatus("Resuming your saved mock attempt…");
    const {data,error}=await db.rpc("resume_gre_mock",{
      p_attempt_id:saved.attempt_id,
      p_session_token:saved.session_token
    });

    if(error) {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(DRAFT_KEY);
      setStatus("Your previous mock could not be resumed. You can start a new mock. "+error.message,true);
      return;
    }

    if(data.status==="completed") {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(DRAFT_KEY);
      setStatus("Your previous mock is already completed. Start a new mock to try another set.");
      return;
    }

    active={attempt_id:saved.attempt_id,session_token:saved.session_token,status:data.status};
    displayAttemptSection(data);
  }

  async function submitSection() {
    if(!active) return;

    const responses=collectResponses();
    const section=active.status==="section1" ? 1 : 2;
    const prompt=section===1
      ? "Submit Section 1? You have answered "+responses.length+" of 12 questions. Unanswered questions receive zero points. Section 2 cannot be changed after submission."
      : "Finish the mock test? You have answered "+responses.length+" of 15 questions in Section 2. Unanswered questions receive zero points.";

    if(!confirm(prompt)) return;

    $("submitSection").disabled=true;
    $("submitSection").textContent=section===1?"Submitting Section 1…":"Calculating score…";
    setStatus("Recording your answers…");

    const rpc=section===1 ? "submit_gre_mock_section1" : "finish_gre_mock";
    const {data,error}=await db.rpc(rpc,{
      p_attempt_id:active.attempt_id,
      p_session_token:active.session_token,
      p_responses:responses
    });

    $("submitSection").disabled=false;
    $("submitSection").textContent=section===1?"Submit Section 1":"Finish mock test";

    if(error) {
      setStatus(error.message,true);
      return;
    }

    if(section===1) {
      localStorage.removeItem(DRAFT_KEY);
      displayAttemptSection(data);
      window.scrollTo({top:0,behavior:"smooth"});
    } else {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(DRAFT_KEY);
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
          <div class="question-head"><b>Q${index+1} · Section ${item.section_number}</b><span>Level ${esc(q.difficulty)}</span><span>${esc(topicLabel(q))}</span><strong>${item.is_correct?"Correct":"Incorrect / blank"}</strong></div>
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
    $("routeResult").textContent=result.route==="harder"?"Harder second section":"Foundation second section";
    $("weightedResult").textContent=Number(result.weighted_points).toFixed(1)+" / "+Number(result.max_weighted_points).toFixed(1);
    $("accuracyResult").textContent=Number(result.weighted_accuracy).toFixed(1)+"%";
    renderReview(result.review);
  }

  $("startMock").addEventListener("click",startMock);
  $("submitSection").addEventListener("click",submitSection);
  $("newMock").addEventListener("click",()=>{
    active=null;
    currentQuestions=[];
    $("resultPanel").hidden=true;
    $("introPanel").hidden=false;
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(DRAFT_KEY);
    setStatus("");
    window.scrollTo({top:0,behavior:"smooth"});
  });

  document.addEventListener("DOMContentLoaded",resumeMock);
})();