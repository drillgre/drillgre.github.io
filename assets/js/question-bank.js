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
      return '<input class="bank-numeric" type="number" step="any" inputmode="decimal" id="numeric-' + esc(id) + '" placeholder="Enter your answer">';
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

  function orderedQuestions(questions) {
    const ordered = [];
    const visited = new Set();
    questions.forEach(question => {
      if (!question.stimulus_id) {
        ordered.push(question);
        return;
      }
      const key = String(question.stimulus_id);
      if (visited.has(key)) return;
      visited.add(key);
      ordered.push(...questions.filter(item => String(item.stimulus_id) === key));
    });
    return ordered;
  }

  function renderQuestions(questions) {
    const host = $("bankQuestionList");
    const ordered = orderedQuestions(questions);
    if (!ordered.length) {
      host.innerHTML = '<div class="bank-empty">No questions match these filters. Try another topic or clear your search.</div>';
      return;
    }

    const renderedStimuli = new Set();
    host.innerHTML = ordered.map((question,index) => {
      const id = String(question.id);
      let stimulusMarkup = "";
      if (question.stimulus_id && !renderedStimuli.has(String(question.stimulus_id))) {
        renderedStimuli.add(String(question.stimulus_id));
        const stimulus = stimulusById.get(String(question.stimulus_id)) || {};
        const image = safeImageUrl(stimulus.figure_url);
        stimulusMarkup = '<section class="bank-stimulus">' +
          '<div class="bank-stimulus-label">Shared Data Analysis material</div>' +
          '<h3>' + esc(stimulus.title || "Shared data or figure") + '</h3>' +
          (stimulus.stimulus_text ? '<p class="bank-stimulus-text">' + esc(stimulus.stimulus_text) + '</p>' : '') +
          (image ? '<img class="bank-figure" src="' + esc(image) + '" alt="' + esc(stimulus.title || "Shared Data Analysis figure") + '" loading="lazy">' : '') +
        '</section>';
      }
      const figureUrl = !question.stimulus_id ? safeImageUrl(question.figure_url) : "";
      const category = CATEGORY_LABELS[question.topic_category] || question.topic || "GRE Quant";
      const subtopic = humanize(question.subtopic);
      return stimulusMarkup +
        '<article class="bank-question" data-question-card="' + esc(id) + '">' +
          '<div class="bank-question-head">' +
            '<span class="bank-question-number">Question ' + (index+1) + '</span>' +
            '<span class="bank-tag">' + esc(category) + (subtopic ? ' · ' + esc(subtopic) : '') + '</span>' +
            '<span class="bank-tag">' + esc(questionTypeLabel(question.question_type)) + '</span>' +
            '<span class="bank-tag">Difficulty ' + esc(question.difficulty ?? "—") + '/5</span>' +
          '</div>' +
          '<div class="bank-prompt">' + esc(question.question_text || "") + '</div>' +
          (figureUrl ? '<img class="bank-figure" src="' + esc(figureUrl) + '" alt="Question figure" loading="lazy">' : '') +
          '<div class="bank-options">' + optionMarkup(question) + '</div>' +
          '<button class="bank-check" type="button" data-check-answer="' + esc(id) + '">Check answer</button>' +
          '<div class="bank-feedback" id="feedback-' + esc(id) + '" hidden></div>' +
        '</article>';
    }).join("");

    ordered.forEach(question => {
      const id = String(question.id);
      const card = host.querySelector('[data-question-card="' + CSS.escape(id) + '"]');
      const button = card?.querySelector("[data-check-answer]");
      if (!button) return;
      button.addEventListener("click", async () => {
        let response;
        if (question.question_type === "numeric_entry") {
          response = card.querySelector("#numeric-" + CSS.escape(id))?.value ?? "";
          if (String(response).trim() === "") {
            alert("Please enter a numerical answer.");
            return;
          }
        } else {
          const selected = [...card.querySelectorAll('input[name="answer-' + CSS.escape(id) + '"]:checked')].map(input => input.value);
          if (!selected.length) {
            alert("Please select an answer.");
            return;
          }
          response = question.question_type === "multiple_choice_multiple" ? selected : selected[0];
        }

        button.disabled = true;
        button.textContent = "Checking…";
        const feedback = card.querySelector("#feedback-" + CSS.escape(id));
        feedback.hidden = false;
        try {
          const {data:grade,error} = await db.rpc("grade_gre_quiz_question", {
            p_question_id:id,
            p_response:response
          });
          if (error) throw error;
          if (grade?.error) throw new Error(grade.error);
          const correct = !!grade?.correct;
          feedback.className = "bank-feedback " + (correct ? "correct" : "incorrect");
          feedback.innerHTML = '<strong>' + (correct ? "Correct!" : "Not quite.") + '</strong>' +
            '<div>Correct answer: ' + esc(answerLabel(grade?.correct_answer)) + '</div>' +
            explanationMarkup(grade);
          button.textContent = "Answer checked";
          button.disabled = true;
          card.querySelectorAll("input").forEach(input => input.disabled = true);
        } catch (error) {
          feedback.className = "bank-feedback incorrect";
          feedback.textContent = "We could not check this answer. " + (error.message || "Please try again.");
          button.disabled = false;
          button.textContent = "Check answer";
        }
      });
    });
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

  async function fetchStimuli(questions) {
    const ids = [...new Set(questions.map(q => q.stimulus_id).filter(Boolean).map(String))];
    if (!ids.length) return;
    const {data,error} = await db.from("question_stimuli")
      .select("id,title,stimulus_text,figure_url")
      .in("id",ids);
    if (error) {
      $("bankStatus").hidden = false;
      $("bankStatus").textContent = "Questions loaded, but some shared Data Analysis figures could not be retrieved. " + error.message;
      $("bankStatus").classList.add("error");
      return;
    }
    stimulusById = new Map((data || []).map(row => [String(row.id),row]));
  }

  async function init() {
    ["bankSearch","bankCategory","bankSubtopic","bankType","bankDifficulty"].forEach(id => {
      $(id).addEventListener(id === "bankSearch" ? "input" : "change",() => {
        if (id === "bankCategory") updateSubtopicFilter();
        applyFilters();
      });
    });

    try {
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
      $("bankStatus").textContent = "The question bank could not be loaded. " + (error.message || "Check the Supabase learner read policies.");
      $("bankResultCount").textContent = "Unable to load questions";
    }
  }

  document.addEventListener("DOMContentLoaded",init);
})();