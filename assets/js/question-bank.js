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

  function renderCard(question,index) {
    const id = String(question.id);
    const category = CATEGORY_LABELS[question.topic_category] || question.topic || "GRE Quant";
    const subtopic = humanize(question.subtopic);
    const excerpt = String(question.question_text || "").replace(/\s+/g," ").trim();
    const shortened = excerpt.length > 230 ? excerpt.slice(0,227).trimEnd() + "…" : excerpt;
    const isDone = completedIds.has(id);
    const stimulus = getStimulus(question);
    const cardFigureUrl = question.figure_url || stimulus?.figure_url;
    const cardFigure = figureMarkup(cardFigureUrl,question.question_text || "Question figure","bank-card-figure");
    return '<article class="bank-card" data-question-card="' + esc(id) + '">' +
      '<div class="bank-card-main">' +
        '<div class="bank-question-head">' +
          '<span class="bank-question-number">Question ' + (index+1) + '</span>' +
          '<span class="bank-tag">' + esc(category) + (subtopic ? ' · ' + esc(subtopic) : '') + '</span>' +
          '<span class="bank-tag">' + esc(questionTypeLabel(question.question_type)) + '</span>' +
          '<span class="bank-tag">Difficulty ' + esc(question.difficulty ?? "—") + '/5</span>' +
          '<span class="bank-done" data-done-badge ' + (isDone ? "" : "hidden") + '>✓ Done</span>' +
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
    const done = completedIds.has(id);
    const dialog = $("questionDialog");
    const body = $("questionDialogBody");
    const figure = figureMarkup(question.figure_url,question.question_text || "Question figure","bank-modal-figure");

    body.innerHTML =
      '<div class="bank-question-head">' +
        '<span class="bank-question-number">' + esc(questionTypeLabel(question.question_type)) + '</span>' +
        '<span class="bank-tag">' + esc(category) + (subtopic ? ' · ' + esc(subtopic) : '') + '</span>' +
        '<span class="bank-tag">Difficulty ' + esc(question.difficulty ?? "—") + '/5</span>' +
        (done ? '<span class="bank-done">✓ Previously completed</span>' : "") +
      '</div>' +
      stimulusMarkup(question,true) +
      '<div class="bank-modal-prompt">' + esc(question.question_text || "") + '</div>' +
      figure +
      '<div class="bank-options">' + optionMarkup(question) + '</div>' +
      '<button class="bank-check" id="checkQuestionBankAnswer" type="button">Check answer</button>' +
      '<div class="bank-feedback" id="questionBankFeedback" hidden></div>' +
      '<p class="attempt-meta" style="margin-top:12px">This question will be marked Done once you check your answer, whether it is correct or incorrect.</p>';

    $("dialogQuestionTitle").textContent = "Question " + id;
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

  function markCardDone(id) {
    completedIds.add(String(id));
    const card = $("bankQuestionList").querySelector('[data-question-card="' + CSS.escape(String(id)) + '"]');
    const badge = card?.querySelector("[data-done-badge]");
    if (badge) badge.hidden = false;
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

      markCardDone(currentQuestion.id);
      feedback.className = "bank-feedback " + (grade.correct ? "correct" : "incorrect");
      feedback.innerHTML = '<strong>' + (grade.correct ? "Correct!" : "Not quite.") + '</strong>' +
        '<div>Correct answer: ' + esc(answerLabel(grade.correct_answer)) + '</div>' +
        explanationMarkup(grade);
      button.textContent = "✓ Done";
      button.disabled = true;
      $("questionDialogBody").querySelectorAll("input").forEach(input => input.disabled = true);
      const card = $("bankQuestionList").querySelector('[data-question-card="' + CSS.escape(String(currentQuestion.id)) + '"]');
      if (card) {
        const status = card.querySelector(".attempt-meta");
        if (status) status.textContent = "Completed";
      }
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
    completedIds = new Set((data?.question_ids || []).map(String));
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

  async function init() {
    const {data:sessionData,error:sessionError} = await db.auth.getSession();
    if (sessionError) {
      $("bankStatus").hidden = false;
      $("bankStatus").classList.add("error");
      $("bankStatus").textContent = "Unable to verify your sign-in. " + sessionError.message;
      $("bankWorkspace").hidden = false;
      return;
    }

    if (!sessionData?.session?.user) {
      $("bankAuthGate").hidden = false;
      return;
    }

    $("bankWorkspace").hidden = false;
    ["bankSearch","bankCategory","bankSubtopic","bankType","bankDifficulty"].forEach(id => {
      $(id).addEventListener(id === "bankSearch" ? "input" : "change",() => {
        if (id === "bankCategory") updateSubtopicFilter();
        applyFilters();
      });
    });

    const dialog = $("questionDialog");
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