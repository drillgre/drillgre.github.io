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
  const TYPE_LABELS = {
    multiple_choice_single:"Single answer",
    multiple_choice_multiple:"Multiple answer",
    quantitative_comparison:"Quantitative Comparison",
    numeric_entry:"Numeric entry",
    data_interpretation:"Data interpretation"
  };

  let allQuestions = [];
  let stimulusById = new Map();
  let completedIds = new Set();
  let progressById = new Map();
  let currentQuestion = null;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));

  function humanize(value) {
    return String(value || "").replaceAll("_"," ").replace(/\b\w/g, ch => ch.toUpperCase());
  }

  function safeImageUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.href);
      return ["http:","https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function parseOptions(raw) {
    if (Array.isArray(raw)) {
      return raw.map((item,index) => typeof item === "string"
        ? {label:String.fromCharCode(65+index),text:item}
        : item);
    }
    if (typeof raw === "string") {
      try { return parseOptions(JSON.parse(raw)); }
      catch { return raw.split(/\r?\n/).filter(Boolean).map((text,index)=>({label:String.fromCharCode(65+index),text})); }
    }
    return [];
  }

  function questionTypeLabel(type) {
    return TYPE_LABELS[type] || humanize(type || "Question");
  }

  function optionMarkup(question) {
    const id = String(question.id);
    const type = question.question_type;

    if (type === "quantitative_comparison") {
      const quantities = parseOptions(question.options);
      const quantityA = quantities.find(item => /quantity.?a/i.test(item.label || ""))?.text || quantities[0]?.text || "";
      const quantityB = quantities.find(item => /quantity.?b/i.test(item.label || ""))?.text || quantities[1]?.text || "";
      const choices = [
        ["A","Quantity A is greater"],
        ["B","Quantity B is greater"],
        ["C","The two quantities are equal"],
        ["D","The relationship cannot be determined"]
      ];
      return '<div class="bank-qc">' +
        '<div class="bank-qc-col"><div class="bank-qc-label">Quantity A</div><div class="bank-qc-value">' + esc(quantityA) + '</div></div>' +
        '<div class="bank-qc-col"><div class="bank-qc-label">Quantity B</div><div class="bank-qc-value">' + esc(quantityB) + '</div></div>' +
      '</div>' + choices.map(choice =>
        '<label class="bank-answer-option"><input type="radio" name="answer-' + esc(id) + '" value="' + choice[0] + '"><span><b>' + choice[0] + '.</b> ' + choice[1] + '</span></label>'
      ).join("");
    }

    if (type === "numeric_entry") {
      return '<label class="numeric-wrap">Your answer<input class="bank-numeric" type="number" step="any" inputmode="decimal" id="numeric-' + esc(id) + '" placeholder="Enter your answer"></label>';
    }

    const options = parseOptions(question.options);
    const isMultiple = type === "multiple_choice_multiple";
    if (!options.length) return '<p class="empty">No answer choices are available for this question.</p>';
    return options.map((option,index) => {
      const value = String(option.label || String.fromCharCode(65+index));
      return '<label class="bank-answer-option">' +
        '<input type="' + (isMultiple ? "checkbox" : "radio") + '" name="answer-' + esc(id) + '" value="' + esc(value) + '">' +
        '<span><b>' + esc(value) + '.</b> ' + esc(option.text ?? option.value ?? "") + '</span>' +
      '</label>';
    }).join("");
  }

  function answerLabel(correct) {
    if (correct && typeof correct === "object" && !Array.isArray(correct)) return String(correct.value ?? "");
    if (Array.isArray(correct)) return correct.join(", ");
    return String(correct ?? "");
  }

  function videoEmbed(raw) {
    if (!raw) return "";
    try {
      const url = new URL(String(raw).trim());
      let id = "";
      if (url.hostname === "youtu.be") {
        id = url.pathname.split("/").filter(Boolean)[0] || "";
      } else if (["youtube.com","www.youtube.com","m.youtube.com","youtube-nocookie.com","www.youtube-nocookie.com"].includes(url.hostname)) {
        if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
        else if (/^\/(embed|shorts)\//.test(url.pathname)) id = url.pathname.split("/")[2] || "";
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? "https://www.youtube-nocookie.com/embed/" + id : "";
    } catch {
      return "";
    }
  }

  function explanationMarkup(grade) {
    const parts = [];
    if ((grade?.explanation_type === "text" || grade?.explanation_type === "both" || !grade?.explanation_type) && grade?.explanation) {
      parts.push('<div class="bank-explanation">' + esc(grade.explanation) + '</div>');
    }
    if ((grade?.explanation_type === "video" || grade?.explanation_type === "both") && grade?.explanation_video_url) {
      const embed = videoEmbed(grade.explanation_video_url);
      if (embed) parts.push('<div class="bank-video"><iframe src="' + esc(embed) + '" title="Question explanation video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>');
    }
    return parts.join("");
  }

  function getStimulus(question) {
    return question.stimulus_id ? stimulusById.get(String(question.stimulus_id)) || null : null;
  }

  function figureMarkup(url, alt, className) {
    const src = safeImageUrl(url);
    return src
      ? '<img class="' + className + '" src="' + esc(src) + '" alt="' + esc(alt || "Question figure") + '" loading="lazy">'
      : "";
  }

  function attachImageFallback(host) {
    host.querySelectorAll("img").forEach(image => {
      image.addEventListener("error", () => {
        image.hidden = true;
        const card = image.closest(".bank-card");
        if (card) {
          card.classList.remove("has-figure");
          card.classList.add("no-figure");
        }
      }, { once:true });
    });
  }

  function stimulusMarkup(question, modal = false) {
    const stimulus = getStimulus(question);
    if (!stimulus) return "";
    const image = figureMarkup(stimulus.figure_url,stimulus.title || "Shared Data Analysis figure",modal ? "bank-modal-figure" : "bank-figure");
    const text = stimulus.stimulus_text ? '<p>' + esc(stimulus.stimulus_text) + '</p>' : "";
    // Do not show an empty stimulus box when neither its text nor figure exists.
    if (!image && !text) return "";
    return '<section class="' + (modal ? "bank-modal-stimulus" : "bank-stimulus") + '">' +
      '<div class="bank-stimulus-label">Shared Data Analysis material</div>' +
      (stimulus.title ? '<h3>' + esc(stimulus.title) + '</h3>' : "") +
      text + image +
    '</section>';
  }

  function statusBadgeMarkup(status) {
    if (status === "done") return '<span class="bank-done">Done</span>';
    if (status === "review") return '<span class="bank-review">Review</span>';
    return "";
  }

  function updateCompletedSummary() {
    const count = [...progressById.values()].filter(item => item.status === "done").length;
    completedIds = new Set([...progressById.entries()].filter(([,item]) => item.status === "done").map(([id]) => id));
    $("bankCompletedSummary").textContent = count.toLocaleString() + " completed by you";
  }

  function renderCard(question,index) {
    const id = String(question.id);
    const category = CATEGORY_LABELS[question.topic_category] || question.topic || "GRE Quant";
    const subtopic = humanize(question.subtopic);
    const excerpt = String(question.question_text || "").replace(/\s+/g," ").trim();
    const shortened = excerpt.length > 230 ? excerpt.slice(0,227).trimEnd() + "…" : excerpt;
    const progress = progressById.get(id);
    const stimulus = getStimulus(question);
    const cardFigureUrl = question.figure_url || stimulus?.figure_url;
    const hasFigure = !!safeImageUrl(cardFigureUrl);
    const cardFigure = figureMarkup(cardFigureUrl,question.question_text || "Question figure","bank-card-figure");
    return '<article class="bank-card ' + (hasFigure ? "has-figure" : "no-figure") + '" data-question-card="' + esc(id) + '">' +
      '<div class="bank-card-main">' +
        '<div class="bank-question-head">' +
          '<span class="bank-question-number">Question ' + (index+1) + '</span>' +
          '<span class="bank-tag">' + esc(category) + (subtopic ? ' · ' + esc(subtopic) : '') + '</span>' +
          '<span class="bank-tag">' + esc(questionTypeLabel(question.question_type)) + '</span>' +
          '<span class="bank-tag">Difficulty ' + esc(question.difficulty ?? "—") + '/5</span>' +
          '<span data-question-status>' + statusBadgeMarkup(progress?.status) + '</span>' +
        '</div>' +
        '<p class="bank-excerpt">' + esc(shortened || "Question text unavailable.") + '</p>' +
        '<div class="bank-card-actions">' +
          '<button class="bank-open" type="button" data-open-question="' + esc(id) + '">Open full question</button>' +
          '<span class="attempt-meta">' + (question.stimulus_id ? "Includes shared Data Analysis material" : "Practice question") + '</span>' +
        '</div>' +
      '</div>' +
      cardFigure +
    '</article>';
  }

  function renderQuestions(questions) {
    const host = $("bankQuestionList");
    if (!questions.length) {
      host.innerHTML = '<div class="bank-empty">No questions match these filters. Try another topic or clear your search.</div>';
      return;
    }

    host.innerHTML = questions.map(renderCard).join("");
    attachImageFallback(host);
    host.querySelectorAll("[data-open-question]").forEach(button => {
      button.addEventListener("click", () => {
        const question = allQuestions.find(item => String(item.id) === button.dataset.openQuestion);
        if (question) openQuestion(question);
      });
    });
  }

  function openQuestion(question) {
    currentQuestion = question;
    const id = String(question.id);
    const category = CATEGORY_LABELS[question.topic_category] || question.topic || "GRE Quant";
    const subtopic = humanize(question.subtopic);
    const progress = progressById.get(id);
    const dialog = $("questionDialog");
    const body = $("questionDialogBody");
    const figure = figureMarkup(question.figure_url,question.question_text || "Question figure","bank-modal-figure");

    body.innerHTML =
      '<div class="bank-question-head">' +
        '<span class="bank-question-number">' + esc(questionTypeLabel(question.question_type)) + '</span>' +
        '<span class="bank-tag">' + esc(category) + (subtopic ? ' · ' + esc(subtopic) : '') + '</span>' +
        '<span class="bank-tag">Difficulty ' + esc(question.difficulty ?? "—") + '/5</span>' +
        '<span data-dialog-status>' + statusBadgeMarkup(progress?.status) + '</span>' +
      '</div>' +
      stimulusMarkup(question,true) +
      '<div class="bank-modal-prompt">' + esc(question.question_text || "") + '</div>' +
      figure +
      '<div class="bank-options">' + optionMarkup(question) + '</div>' +
      '<button class="bank-check" id="checkQuestionBankAnswer" type="button">Check answer</button>' +
      '<div class="bank-feedback" id="questionBankFeedback" hidden></div>' +
      '<p class="attempt-meta" id="questionStatusHelp" style="margin-top:12px">A correct answer is marked Done. An incorrect answer is marked Review until you answer correctly.</p>';

    const displayNumber = allQuestions.findIndex(item => String(item.id) === id) + 1;
    $("dialogQuestionTitle").textContent = "Question " + (displayNumber || "details");
    attachImageFallback(body);
    $("checkQuestionBankAnswer").addEventListener("click",checkCurrentAnswer);
    if (!dialog.open) dialog.showModal();
  }

  function getResponse(question) {
    const id = String(question.id);
    if (question.question_type === "numeric_entry") {
      const response = $("numeric-" + id)?.value ?? "";
      if (String(response).trim() === "") throw new Error("Please enter a numerical answer.");
      return response;
    }
    const selected = [...$("questionDialogBody").querySelectorAll('input[name="answer-' + CSS.escape(id) + '"]:checked')]
      .map(input => input.value);
    if (!selected.length) throw new Error("Please select an answer.");
    return question.question_type === "multiple_choice_multiple" ? selected : selected[0];
  }

  function markCardStatus(id, status, grade) {
    const key = String(id);
    const previous = progressById.get(key) || {};
    progressById.set(key, {
      ...previous,
      status,
      attempts_count: Number(grade?.attempt_count ?? previous.attempts_count ?? 1),
      first_attempt_correct: grade?.first_attempt_correct ?? previous.first_attempt_correct ?? null
    });
    updateCompletedSummary();

    const markup = statusBadgeMarkup(status);
    const card = $("bankQuestionList").querySelector('[data-question-card="' + CSS.escape(key) + '"]');
    const cardStatus = card?.querySelector("[data-question-status]");
    if (cardStatus) cardStatus.innerHTML = markup;
    const dialogStatus = $("questionDialogBody").querySelector("[data-dialog-status]");
    if (dialogStatus) dialogStatus.innerHTML = markup;
    const cardMeta = card?.querySelector(".attempt-meta");
    if (cardMeta) cardMeta.textContent = status === "done" ? "Correctly answered" : "Needs another attempt";
    const help = $("questionStatusHelp");
    if (help) help.textContent = status === "done"
      ? "Correctly answered. This question is marked Done."
      : "Your answer was incorrect. This question is marked Review. Try again when you are ready.";
  }

  async function checkCurrentAnswer() {
    if (!currentQuestion) return;
    const button = $("checkQuestionBankAnswer");
    const feedback = $("questionBankFeedback");
    let response;
    try {
      response = getResponse(currentQuestion);
    } catch (error) {
      feedback.hidden = false;
      feedback.className = "bank-feedback incorrect";
      feedback.textContent = error.message;
      return;
    }

    button.disabled = true;
    button.textContent = "Checking…";
    feedback.hidden = false;
    feedback.className = "bank-feedback";
    feedback.textContent = "Checking your answer and saving progress…";

    try {
      const {data:grade,error} = await db.rpc("grade_gre_question_bank_item", {
        p_question_id:String(currentQuestion.id),
        p_response:response
      });
      if (error) throw error;
      if (grade?.error) throw new Error(grade.error);

      const status = grade.status || (grade.correct ? "done" : "review");
      markCardStatus(currentQuestion.id, status, grade);
      feedback.className = "bank-feedback " + (grade.correct ? "correct" : "incorrect");
      feedback.innerHTML = '<strong>' + (grade.correct ? "Correct!" : "Not quite.") + '</strong>' +
        '<div>Correct answer: ' + esc(answerLabel(grade.correct_answer)) + '</div>' +
        explanationMarkup(grade);
      button.textContent = grade.correct ? "Done" : "Try again";
      button.disabled = !!grade.correct;
      $("questionDialogBody").querySelectorAll("input").forEach(input => input.disabled = !!grade.correct);
    } catch (error) {
      feedback.className = "bank-feedback incorrect";
      feedback.textContent = "We could not check or save this question. " + (error.message || "Please try again.");
      button.disabled = false;
      button.textContent = "Try again";
    }
  }

  function populateFilters() {
    const categories = [...new Set(allQuestions.map(q => q.topic_category || "arithmetic"))]
      .sort((a,b) => (CATEGORY_LABELS[a] || a).localeCompare(CATEGORY_LABELS[b] || b));
    $("bankCategory").innerHTML = '<option value="">All topics</option>' + categories.map(value =>
      '<option value="' + esc(value) + '">' + esc(CATEGORY_LABELS[value] || humanize(value)) + '</option>'
    ).join("");

    const types = [...new Set(allQuestions.map(q => q.question_type).filter(Boolean))]
      .sort((a,b) => questionTypeLabel(a).localeCompare(questionTypeLabel(b)));
    $("bankType").innerHTML = '<option value="">All question types</option>' + types.map(value =>
      '<option value="' + esc(value) + '">' + esc(questionTypeLabel(value)) + '</option>'
    ).join("");
    updateSubtopicFilter();
  }

  function updateSubtopicFilter() {
    const category = $("bankCategory").value;
    const values = [...new Set(allQuestions
      .filter(q => !category || (q.topic_category || "arithmetic") === category)
      .map(q => q.subtopic || "arithmetic_other"))]
      .sort((a,b) => humanize(a).localeCompare(humanize(b)));
    const current = $("bankSubtopic").value;
    $("bankSubtopic").innerHTML = '<option value="">All subtopics</option>' + values.map(value =>
      '<option value="' + esc(value) + '">' + esc(humanize(value)) + '</option>'
    ).join("");
    if (values.includes(current)) $("bankSubtopic").value = current;
  }

  function applyFilters() {
    const search = $("bankSearch").value.trim().toLowerCase();
    const category = $("bankCategory").value;
    const subtopic = $("bankSubtopic").value;
    const type = $("bankType").value;
    const difficulty = $("bankDifficulty").value;

    const filtered = allQuestions.filter(question => {
      const topicCategory = question.topic_category || "arithmetic";
      const text = [
        question.question_text,
        question.topic,
        CATEGORY_LABELS[topicCategory] || topicCategory,
        humanize(question.subtopic),
        questionTypeLabel(question.question_type)
      ].join(" ").toLowerCase();
      return (!search || text.includes(search)) &&
        (!category || topicCategory === category) &&
        (!subtopic || (question.subtopic || "arithmetic_other") === subtopic) &&
        (!type || question.question_type === type) &&
        (!difficulty || String(question.difficulty) === difficulty);
    });

    $("bankResultCount").textContent = "Showing " + filtered.length + " of " + allQuestions.length + " practice questions";
    renderQuestions(filtered);
  }

  async function fetchAllQuestions() {
    const collected = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const {data,error} = await db.from("questions")
        .select("id,topic,topic_category,subtopic,question_type,difficulty,question_text,options,figure_url,stimulus_id,question_usage,created_at")
        .eq("published",true)
        .in("question_usage",["practice","both"])
        .order("created_at",{ascending:true})
        .range(offset,offset+pageSize-1);
      if (error) throw error;
      const page = data || [];
      collected.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return collected;
  }

  async function fetchProgress() {
    const {data,error} = await db.rpc("get_gre_question_bank_progress");
    if (error) throw error;
    const rows = Array.isArray(data?.question_statuses) ? data.question_statuses : [];
    progressById = new Map(rows.map(row => [String(row.question_id), {
      status: row.status,
      attempts_count: Number(row.attempts_count || 0),
      first_attempt_correct: row.first_attempt_correct ?? null,
      difficulty: row.difficulty ?? null
    }]));

    // Older installations return only question_ids. Treat those legacy records
    // as Review because their original answer correctness was not retained.
    if (!rows.length && Array.isArray(data?.question_ids)) {
      progressById = new Map(data.question_ids.map(id => [String(id), {
        status: "review", attempts_count: 1, first_attempt_correct: null
      }]));
    }
    updateCompletedSummary();
  }

  function renderDiagnostics(data) {
    const body = $("bankDiagnosticsBody");
    const totalAttempted = Number(data?.total_attempted || 0);
    const totalCompleted = Number(data?.total_completed || 0);
    const totalRate = data?.total_first_attempt_success_rate;
    const rateLabel = totalRate === null || totalRate === undefined
      ? "—"
      : Number(totalRate).toFixed(1) + "%";
    const rows = Array.isArray(data?.by_difficulty) ? data.by_difficulty : [];

    body.innerHTML =
      '<div class="bank-diagnostics-summary">' +
        '<div class="bank-diagnostic-stat"><span>Questions attempted</span><strong>' + totalAttempted.toLocaleString() + '</strong></div>' +
        '<div class="bank-diagnostic-stat"><span>Correctly answered</span><strong>' + totalCompleted.toLocaleString() + '</strong></div>' +
        '<div class="bank-diagnostic-stat"><span>First-attempt success</span><strong>' + rateLabel + '</strong><small>' + Number(data?.total_first_attempts_recorded || 0).toLocaleString() + ' first attempts recorded</small></div>' +
      '</div>' +
      '<h3 class="bank-diagnostics-subtitle">Performance by difficulty</h3>' +
      '<div class="bank-diagnostics-table-wrap"><table class="bank-diagnostics-table">' +
        '<thead><tr><th>Difficulty</th><th>Questions attempted</th><th>First attempts recorded</th><th>Correct first attempts</th><th>Success rate</th></tr></thead>' +
        '<tbody>' + rows.map(row => {
          const rate = row.first_attempt_success_rate;
          const rateText = rate === null || rate === undefined ? "—" : Number(rate).toFixed(1) + "%";
          return '<tr><td><strong>' + esc(row.difficulty) + '/5</strong></td>' +
            '<td>' + Number(row.questions_attempted || 0).toLocaleString() + '</td>' +
            '<td>' + Number(row.first_attempts_recorded || 0).toLocaleString() + '</td>' +
            '<td>' + Number(row.first_attempt_correct || 0).toLocaleString() + '</td>' +
            '<td><strong>' + rateText + '</strong></td></tr>';
        }).join("") + '</tbody>' +
      '</table></div>' +
      '<p class="bank-diagnostics-note">First-attempt success is calculated from recorded first submissions. Questions attempted before this diagnostics update remain in the attempted counts, but their first-answer correctness is unknown and is excluded from the success-rate calculation.</p>';
  }

  async function openDiagnostics() {
    const dialog = $("bankDiagnosticsDialog");
    const body = $("bankDiagnosticsBody");
    body.innerHTML = '<p class="bank-status">Loading your diagnostics…</p>';
    if (!dialog.open) dialog.showModal();
    try {
      const {data,error} = await db.rpc("get_gre_question_bank_diagnostics");
      if (error) throw error;
      renderDiagnostics(data || {});
    } catch (error) {
      body.innerHTML = '<div class="bank-status error">Diagnostics could not be loaded. Run <code>supabase/question-bank-diagnostics.sql</code> in your Supabase SQL Editor. ' + esc(error.message || "") + '</div>';
    }
  }

  async function fetchStimuli(questions) {
    const ids = [...new Set(questions.map(q => q.stimulus_id).filter(Boolean).map(String))];
    if (!ids.length) return;
    const {data,error} = await db.from("question_stimuli")
      .select("id,title,stimulus_text,figure_url")
      .in("id",ids);
    if (error) {
      $("bankStatus").hidden = false;
      $("bankStatus").textContent = "Questions loaded, but some shared Data Analysis material could not be retrieved. " + error.message;
      $("bankStatus").classList.add("error");
      return;
    }
    stimulusById = new Map((data || []).map(row => [String(row.id),row]));
  }

  async function fetchPublicQuestionCount() {
    const {data,error} = await db.rpc("get_public_question_bank_count");
    if (error) throw error;
    const count = Number(data);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("The public question count returned an invalid value.");
    }
    $("bankTotal").textContent = count.toLocaleString();
    return count;
  }

  async function init() {
    let publicQuestionCount = null;
    try {
      publicQuestionCount = await fetchPublicQuestionCount();
    } catch (error) {
      $("bankTotal").textContent = "—";
      console.warn("Public Question Bank count unavailable:", error);
    }

    const {data:sessionData,error:sessionError} = await db.auth.getSession();
    if (sessionError) {
      $("bankCompletedSummary").hidden = true;
      $("openBankDiagnostics").hidden = true;
      $("bankAuthGate").hidden = false;
      $("bankAuthGateMessage").textContent = "We could not verify your sign-in. Please refresh or sign in again to access the Question Bank.";
      return;
    }

    if (!sessionData?.session?.user) {
      $("bankCompletedSummary").hidden = true;
      $("openBankDiagnostics").hidden = true;
      $("bankAuthGateMessage").textContent = publicQuestionCount === null
        ? "Sign in or create a free account to browse questions, check answers, and save your progress."
        : "There are " + publicQuestionCount.toLocaleString() + " published practice questions. Sign in or create a free account to browse them, check your answers, and save your progress.";
      $("bankAuthGate").hidden = false;
      return;
    }

    $("bankCompletedSummary").hidden = false;
    $("openBankDiagnostics").hidden = false;
    $("bankWorkspace").hidden = false;
    ["bankSearch","bankCategory","bankSubtopic","bankType","bankDifficulty"].forEach(id => {
      $(id).addEventListener(id === "bankSearch" ? "input" : "change",() => {
        if (id === "bankCategory") updateSubtopicFilter();
        applyFilters();
      });
    });

    const dialog = $("questionDialog");
    const diagnosticsDialog = $("bankDiagnosticsDialog");
    $("openBankDiagnostics").addEventListener("click",openDiagnostics);
    $("closeBankDiagnostics").addEventListener("click",() => diagnosticsDialog.close());
    diagnosticsDialog.addEventListener("click",event => {
      if (event.target === diagnosticsDialog) diagnosticsDialog.close();
    });
    $("closeQuestionDialog").addEventListener("click",() => dialog.close());
    dialog.addEventListener("click",event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close",() => { currentQuestion = null; });

    try {
      // Read the learner's saved completion state before rendering the list.
      await fetchProgress();
      allQuestions = await fetchAllQuestions();
      $("bankTotal").textContent = allQuestions.length.toLocaleString();
      $("bankStatus").hidden = true;
      if (!allQuestions.length) {
        $("bankStatus").hidden = false;
        $("bankStatus").textContent = "There are no published questions currently marked for practice. Questions marked Practice or Both in the admin Question Bank will appear here after publication.";
        $("bankResultCount").textContent = "0 practice questions";
        renderQuestions([]);
        return;
      }

      await fetchStimuli(allQuestions);
      populateFilters();
      applyFilters();
    } catch (error) {
      $("bankStatus").hidden = false;
      $("bankStatus").classList.add("error");
      $("bankStatus").textContent = "The Question Bank could not be loaded. " + (error.message || "Check that supabase/question-bank-progress.sql has been run.");
      $("bankResultCount").textContent = "Unable to load questions";
    }
  }

  document.addEventListener("DOMContentLoaded",init);
})();