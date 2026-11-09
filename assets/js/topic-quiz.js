(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = id => document.getElementById(id);

  const CATEGORY_LABELS = {
    arithmetic: "Arithmetic",
    data_analysis: "Data Analysis",
    algebra: "Algebra",
    geometry: "Geometry"
  };

  const SUBTOPIC_LABELS = {
    number_properties: "Number properties",
    fractions_decimals: "Fractions and decimals",
    percentages: "Percentages",
    ratios_proportions: "Ratios and proportions",
    exponents_roots: "Exponents and roots",
    absolute_values: "Absolute values",
    arithmetic_other: "Other arithmetic",
    data_interpretation: "Data interpretation",
    probability: "Probability",
    counting: "Counting, permutations and combinations",
    statistics: "Statistics",
    algebra_core: "Equations and functions",
    inequalities: "Inequalities",
    word_problems: "Word problems",
    geometry: "Geometry",
    coordinate_geometry: "Coordinate geometry"
  };

  let questionBank = [];
  let currentQuestions = [];
  let submitting = false;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));

  function setStatus(message, isError = false) {
    const el = $("quizSetupStatus");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("error", !!isError);
    el.hidden = !message;
  }

  function parseOptions(raw) {
    if (Array.isArray(raw)) {
      return raw.map((item, index) => typeof item === "string"
        ? {label:String.fromCharCode(65 + index), text:item}
        : item);
    }
    if (typeof raw === "string") {
      try { return parseOptions(JSON.parse(raw)); } catch { return []; }
    }
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([label, text]) =>
        typeof text === "object" && text !== null
          ? {label, ...text}
          : {label, text:String(text)}
      );
    }
    return [];
  }

  function categoryLabel(value) {
    return CATEGORY_LABELS[value] || String(value || "Other").replaceAll("_", " ");
  }

  function subtopicLabel(value) {
    return SUBTOPIC_LABELS[value] || String(value || "Other").replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  async function fetchQuestionBank() {
    const all = [];
    const pageSize = 1000;
    let offset = 0;

    while (true) {
      const {data, error} = await db
        .from("questions")
        .select("id,topic,topic_category,subtopic,question_type,difficulty,question_text,options,figure_url,stimulus_id,question_usage")
        .eq("published", true)
        .in("question_usage", ["practice", "both"])
        .order("created_at", {ascending:false})
        .range(offset, offset + pageSize - 1);

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
      if (!groups.has(category)) groups.set(category, new Map());
      const subs = groups.get(category);
      subs.set(subtopic, (subs.get(subtopic) || 0) + 1);
    });

    const ordered = [...groups.entries()].sort((a,b) =>
      categoryLabel(a[0]).localeCompare(categoryLabel(b[0]))
    );

    $("quizTopicGroups").innerHTML = ordered.map(([category, subs]) => {
      const subRows = [...subs.entries()].sort((a,b) =>
        subtopicLabel(a[0]).localeCompare(subtopicLabel(b[0]))
      );
      const categoryTotal = subRows.reduce((sum, item) => sum + item[1], 0);
      return '<article class="quiz-topic-group" data-topic-group="' + esc(category) + '">' +
        '<label class="quiz-category-row">' +
          '<input type="checkbox" data-category-toggle="' + esc(category) + '">' +
          '<strong>' + esc(categoryLabel(category)) + '</strong>' +
          '<span class="quiz-category-count">' + categoryTotal + ' questions</span>' +
        '</label>' +
        '<div class="quiz-subtopic-list">' +
          subRows.map(([subtopic, count]) =>
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
      input.addEventListener("change", () => {
        const category = input.dataset.categoryToggle;
        $("quizTopicGroups").querySelectorAll('[data-category="' + CSS.escape(category) + '"]').forEach(box => {
          box.checked = input.checked;
        });
        updateQuizAvailability();
      });
    });

    $("quizTopicGroups").querySelectorAll("[data-quiz-subtopic]").forEach(input => {
      input.addEventListener("change", updateQuizAvailability);
    });

    updateQuizAvailability();
  }

  function selectedSubtopicKeys() {
    return [...$("quizTopicGroups").querySelectorAll("[data-quiz-subtopic]:checked")]
      .map(input => input.dataset.category + "::" + input.dataset.quizSubtopic);
  }

  function selectedQuestionPool() {
    const selected = new Set(selectedSubtopicKeys());
    if (!selected.size) return [];
    return questionBank.filter(q =>
      selected.has((q.topic_category || "arithmetic") + "::" + (q.subtopic || "arithmetic_other"))
    );
  }

  function updateCategoryCheckboxes() {
    $("quizTopicGroups").querySelectorAll("[data-category-toggle]").forEach(parent => {
      const category = parent.dataset.categoryToggle;
      const children = [...$("quizTopicGroups").querySelectorAll('[data-category="' + CSS.escape(category) + '"]')];
      const checked = children.filter(item => item.checked).length;
      parent.checked = children.length > 0 && checked === children.length;
      parent.indeterminate = checked > 0 && checked < children.length;
    });
  }

  function updateQuizAvailability() {
    updateCategoryCheckboxes();
    const available = selectedQuestionPool().length;
    const requested = Number($("quizQuestionCount").value || 12);
    const note = $("quizAvailability");

    if (!selectedSubtopicKeys().length) {
      note.textContent = "Select one or more topics or subtopics to see how many questions are available.";
      $("startTopicQuiz").disabled = true;
    } else if (available < requested) {
      note.textContent = available + " questions available. Select more subtopics or choose a smaller quiz size.";
      $("startTopicQuiz").disabled = true;
    } else {
      note.textContent = available + " eligible questions available. " + requested + " will be selected randomly.";
      $("startTopicQuiz").disabled = false;
    }
  }

  function shuffle(items) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  async function attachStimuli(questions) {
    const ids = [...new Set(questions.map(q => q.stimulus_id).filter(Boolean).map(String))];
    if (!ids.length) return questions;

    const {data, error} = await db
      .from("question_stimuli")
      .select("id,title,stimulus_text,figure_url")
      .in("id", ids);

    if (error) {
      throw new Error("Unable to load a shared Data Interpretation stimulus. Run supabase/topic-quiz.sql in the Supabase SQL Editor. " + error.message);
    }

    const byId = new Map((data || []).map(item => [String(item.id), item]));
    return questions.map(q => {
      const stimulus = q.stimulus_id ? byId.get(String(q.stimulus_id)) : null;
      return {
        ...q,
        stimulus_title: stimulus?.title || "",
        stimulus_text: stimulus?.stimulus_text || "",
        stimulus_figure_url: stimulus?.figure_url || ""
      };
    });
  }

  function parseQuestionOptions(q) {
    return parseOptions(q.options);
  }

  function answerMarkup(q) {
    if (q.question_type === "quantitative_comparison") {
      const opts = parseQuestionOptions(q);
      const a = opts.find(x => /quantity.?a/i.test(x.label || ""))?.text || opts[0]?.text || "";
      const b = opts.find(x => /quantity.?b/i.test(x.label || ""))?.text || opts[1]?.text || "";
      return '<div class="qc-comparison">' +
        '<div class="qc-column"><div class="qc-label">Quantity A</div><div class="qc-value">' + esc(a) + '</div></div>' +
        '<div class="qc-column"><div class="qc-label">Quantity B</div><div class="qc-value">' + esc(b) + '</div></div>' +
      '</div>' +
      [
        ["A","Quantity A is greater"],
        ["B","Quantity B is greater"],
        ["C","The two quantities are equal"],
        ["D","The relationship cannot be determined"]
      ].map(([value,label]) =>
        '<label class="quiz-option"><input type="radio" name="q-' + esc(q.id) + '" value="' + value + '">' +
        '<span><b>' + value + '.</b> ' + label + '</span></label>'
      ).join("");
    }

    if (q.question_type === "numeric_entry") {
      return '<label class="quiz-numeric-wrap">Your answer' +
        '<input class="quiz-numeric-answer" id="numeric-' + esc(q.id) + '" type="number" step="any" inputmode="decimal" placeholder="Enter a number">' +
      '</label>';
    }

    const multiple = q.question_type === "multiple_choice_multiple";
    return parseQuestionOptions(q).map((opt,index) => {
      const value = String(opt.label || String.fromCharCode(65 + index));
      return '<label class="quiz-option">' +
        '<input type="' + (multiple ? "checkbox" : "radio") + '" name="q-' + esc(q.id) + '" value="' + esc(value) + '">' +
        '<span><b>' + esc(value) + '.</b> ' + esc(opt.text ?? "") + '</span>' +
      '</label>';
    }).join("");
  }

  function stimulusMarkup(q) {
    const figure = q.stimulus_figure_url
      ? '<img class="quiz-question-figure" src="' + esc(q.stimulus_figure_url) + '" alt="' + esc(q.stimulus_title || "Shared Data Analysis figure") + '" loading="lazy">'
      : "";
    const context = q.stimulus_text
      ? '<p class="quiz-stimulus-context">' + esc(q.stimulus_text) + '</p>'
      : '<p class="quiz-stimulus-context">The shared data set is linked to these questions.</p>';
    return '<section class="quiz-stimulus">' +
      '<div class="quiz-stimulus-label">Shared Data Analysis stimulus</div>' +
      '<h3>' + esc(q.stimulus_title || "Data set") + '</h3>' + context + figure +
    '</section>';
  }

  function renderQuestions() {
    const seenStimuli = new Set();
    $("quizQuestionStack").innerHTML = currentQuestions.map((q,index) => {
      let stimulus = "";
      if (q.stimulus_id && !seenStimuli.has(String(q.stimulus_id))) {
        seenStimuli.add(String(q.stimulus_id));
        stimulus = stimulusMarkup(q);
      }
      const figure = !q.stimulus_id && q.figure_url
        ? '<img class="quiz-question-figure" src="' + esc(q.figure_url) + '" alt="Question figure" loading="lazy">'
        : "";
      return stimulus +
        '<article class="quiz-question" data-qid="' + esc(q.id) + '">' +
          '<div class="quiz-question-head"><span class="quiz-question-number">Question ' + (index + 1) + ' of ' + currentQuestions.length + '</span></div>' +
          '<div class="quiz-question-prompt">' + esc(q.question_text || "") + '</div>' +
          figure +
          '<div class="quiz-answer-area">' + answerMarkup(q) + '</div>' +
        '</article>';
    }).join("");

    $("quizQuestionStack").querySelectorAll(".quiz-question").forEach(card => {
      card.querySelectorAll("input").forEach(input => {
        const update = () => {
          const answered = card.querySelectorAll("input:checked").length > 0 ||
            (card.querySelector(".quiz-numeric-answer")?.value.trim() || "") !== "";
          card.classList.toggle("answered", answered);
          updateQuizProgress();
        };
        input.addEventListener("change", update);
        input.addEventListener("input", update);
      });
    });
    updateQuizProgress();
  }

  function responseFor(q) {
    const card = $("quizQuestionStack").querySelector('[data-qid="' + CSS.escape(String(q.id)) + '"]');
    if (!card) return null;

    if (q.question_type === "numeric_entry") {
      const value = card.querySelector(".quiz-numeric-answer")?.value.trim() || "";
      return value === "" ? null : value;
    }

    const selected = [...card.querySelectorAll("input:checked")].map(input => input.value);
    if (!selected.length) return null;
    return q.question_type === "multiple_choice_multiple" ? selected : selected[0];
  }

  function updateQuizProgress() {
    const cards = [...$("quizQuestionStack").querySelectorAll(".quiz-question")];
    const answered = cards.filter(card =>
      card.querySelectorAll("input:checked").length > 0 ||
      (card.querySelector(".quiz-numeric-answer")?.value.trim() || "") !== ""
    ).length;
    $("quizAnswered").textContent = answered + " / " + currentQuestions.length;
    $("quizProgressFill").style.width = (currentQuestions.length ? answered / currentQuestions.length * 100 : 0) + "%";
  }

  function answerDisplay(response) {
    if (response === null || response === undefined) return "Not answered";
    if (Array.isArray(response)) return response.length ? response.join(", ") : "Not answered";
    return String(response);
  }

  function correctAnswerText(q, answer) {
    if (q.question_type === "numeric_entry") {
      return String(answer && typeof answer === "object" ? answer.value : answer ?? "");
    }
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

  function reviewOptionsMarkup(q) {
    const opts = parseQuestionOptions(q);
    if (q.question_type === "quantitative_comparison") {
      const a = opts.find(x => /quantity.?a/i.test(x.label || ""))?.text || opts[0]?.text || "";
      const b = opts.find(x => /quantity.?b/i.test(x.label || ""))?.text || opts[1]?.text || "";
      return '<div class="qc-comparison">' +
        '<div class="qc-column"><div class="qc-label">Quantity A</div><div class="qc-value">' + esc(a) + '</div></div>' +
        '<div class="qc-column"><div class="qc-label">Quantity B</div><div class="qc-value">' + esc(b) + '</div></div>' +
      '</div>';
    }
    if (!opts.length) return "";
    return '<ul>' + opts.map((option,index) =>
      '<li><b>' + esc(option.label || String.fromCharCode(65 + index)) + '.</b> ' + esc(option.text ?? "") + '</li>'
    ).join("") + '</ul>';
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

  function renderReview(items) {
    const seenStimuli = new Set();
    $("quizReviewList").innerHTML = items.map((item,index) => {
      const q = item.question;
      let stimulus = "";
      if (q.stimulus_id && !seenStimuli.has(String(q.stimulus_id))) {
        seenStimuli.add(String(q.stimulus_id));
        stimulus = stimulusMarkup(q);
      }
      const figure = !q.stimulus_id && q.figure_url
        ? '<img class="quiz-question-figure" src="' + esc(q.figure_url) + '" alt="Question figure">'
        : "";
      let explanation = "";
      if ((item.grade.explanation_type === "text" || item.grade.explanation_type === "both") && item.grade.explanation) {
        explanation += '<div class="quiz-review-explanation">' + esc(item.grade.explanation) + '</div>';
      }
      const embed = videoEmbed(item.grade.explanation_video_url);
      if ((item.grade.explanation_type === "video" || item.grade.explanation_type === "both") && embed) {
        explanation += '<div class="quiz-review-explanation"><iframe src="' + esc(embed) + '" title="Question ' + (index + 1) + ' explanation" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="width:100%;max-width:560px;aspect-ratio:16/9;border:0;border-radius:10px"></iframe></div>';
      }
      return stimulus +
        '<article class="quiz-review ' + (item.grade.correct ? "right" : "wrong") + '">' +
          '<div class="quiz-question-head"><b>Question ' + (index + 1) + '</b><strong>' + (item.grade.correct ? "Correct" : "Incorrect / unanswered") + '</strong></div>' +
          '<p class="quiz-question-prompt">' + esc(q.question_text || "") + '</p>' +
          figure +
          reviewOptionsMarkup(q) +
          '<div class="quiz-review-answer"><b>Your answer:</b> ' + esc(answerDisplay(item.response)) +
            '<br><b>Correct answer:</b> ' + esc(correctAnswerText(q, item.grade.correct_answer)) + '</div>' +
          explanation +
        '</article>';
    }).join("");
  }

  async function startTopicQuiz() {
    const pool = selectedQuestionPool();
    const requested = Number($("quizQuestionCount").value || 12);
    if (pool.length < requested) return;

    $("startTopicQuiz").disabled = true;
    $("startTopicQuiz").textContent = "Preparing quiz…";
    setStatus("Selecting a random set of questions…");

    try {
      currentQuestions = await attachStimuli(shuffle(pool).slice(0, requested));
      $("quizSetupPanel").hidden = true;
      $("topicQuizResults").hidden = true;
      $("topicQuizRun").hidden = false;
      $("quizRunTitle").textContent = "Quant topic quiz · " + currentQuestions.length + " questions";
      $("submitTopicQuiz").disabled = false;
      $("submitTopicQuiz").textContent = "Submit quiz";
      renderQuestions();
      setStatus("");
      $("topicQuizRun").scrollIntoView({behavior:"smooth", block:"start"});
    } catch (error) {
      setStatus(error.message || "Unable to prepare the quiz.", true);
    } finally {
      $("startTopicQuiz").disabled = selectedQuestionPool().length < Number($("quizQuestionCount").value || 12);
      $("startTopicQuiz").textContent = "Start topic quiz";
    }
  }

  async function submitTopicQuiz() {
    if (submitting || !currentQuestions.length) return;
    const answered = currentQuestions.filter(q => responseFor(q) !== null).length;
    const confirmMessage = answered < currentQuestions.length
      ? "You have answered " + answered + " of " + currentQuestions.length + " questions. Submit the quiz with the remaining questions blank?"
      : "Submit your quiz and see your results?";
    if (!window.confirm(confirmMessage)) return;

    submitting = true;
    $("submitTopicQuiz").disabled = true;
    $("submitTopicQuiz").textContent = "Checking answers…";

    try {
      const items = await Promise.all(currentQuestions.map(async question => {
        const response = responseFor(question);
        const {data, error} = await db.rpc("grade_gre_quiz_question", {
          p_question_id: String(question.id),
          p_response: response
        });
        if (error) throw new Error(error.message);
        if (!data || data.error) throw new Error(data?.error || "A question could not be graded.");
        return {question, response, grade:data};
      }));

      const correct = items.filter(item => item.grade.correct).length;
      $("quizCorrectScore").textContent = correct + " / " + items.length;
      $("quizScoreDetail").textContent = correct + " correct · " + (items.length - correct) + " incorrect or unanswered";
      renderReview(items);
      $("topicQuizRun").hidden = true;
      $("topicQuizResults").hidden = false;
      $("topicQuizResults").scrollIntoView({behavior:"smooth", block:"start"});
    } catch (error) {
      setStatus("Unable to check this quiz. " + (error.message || "Please try again."), true);
    } finally {
      submitting = false;
      $("submitTopicQuiz").disabled = false;
      $("submitTopicQuiz").textContent = "Submit quiz";
    }
  }

  function resetTopicQuiz() {
    currentQuestions = [];
    $("topicQuizResults").hidden = true;
    $("topicQuizRun").hidden = true;
    $("quizSetupPanel").hidden = false;
    setStatus("");
    updateQuizAvailability();
    $("topicQuizSection").scrollIntoView({behavior:"smooth", block:"start"});
  }

  async function init() {
    $("quizQuestionCount").addEventListener("change", updateQuizAvailability);
    $("startTopicQuiz").addEventListener("click", startTopicQuiz);
    $("submitTopicQuiz").addEventListener("click", submitTopicQuiz);
    $("newTopicQuiz").addEventListener("click", resetTopicQuiz);

    try {
      questionBank = await fetchQuestionBank();
      $("quizBankCount").textContent = questionBank.length + " practice questions";
      if (!questionBank.length) {
        setStatus("No published questions are currently available for topic quizzes. Publish questions with availability set to Practice or Both in the admin workspace.");
        return;
      }
      renderTopicGroups();
      $("quizSetupPanel").hidden = false;
      setStatus("");
    } catch (error) {
      setStatus("Unable to load the practice question bank. " + (error.message || ""), true);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();