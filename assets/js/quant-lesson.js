(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));

  function videoEmbed(raw) {
    if (!raw) return "";
    try {
      const url = new URL(raw.trim());
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

  function markdownToHtml(markdown) {
    const lines = String(markdown || "").split(/\r?\n/);
    const safe = value => esc(value);
    return lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${safe(heading[2])}</h${level}>`;
      }
      if (/^[-*+]\s+/.test(trimmed)) return `<p>• ${safe(trimmed.replace(/^[-*+]\s+/,""))}</p>`;
      return `<p>${safe(trimmed)}</p>`;
    }).join("");
  }

  function renderLessonContent(content) {
    let html = "";
    if (content && typeof content === "object" && typeof content.html === "string") {
      html = content.html;
    } else if (content && typeof content === "object" && typeof content.markdown === "string") {
      html = markdownToHtml(content.markdown);
    } else if (typeof content === "string") {
      html = markdownToHtml(content);
    }

    $("lessonContent").innerHTML = window.DOMPurify
      ? window.DOMPurify.sanitize(html, {
          USE_PROFILES: { html: true },
          ADD_ATTR: ["data-type","data-latex","class"]
        })
      : esc(html);

    renderMath();
  }

  function renderMath() {
    if (!window.katex) return;
    $("lessonContent").querySelectorAll('[data-type="inline-math"],[data-type="block-math"]').forEach(node => {
      const latex = node.getAttribute("data-latex") || "";
      if (!latex) return;
      try {
        window.katex.render(latex, node, {
          throwOnError: false,
          displayMode: node.getAttribute("data-type") === "block-math"
        });
      } catch (error) {
        node.textContent = latex;
      }
    });
  }

  function parseOptions(raw) {
    if (Array.isArray(raw)) {
      return raw.map((item,index) => typeof item === "string"
        ? {label:String.fromCharCode(65+index),text:item}
        : item);
    }
    if (typeof raw === "string") {
      try { return parseOptions(JSON.parse(raw)); }
      catch { return raw.split("\n").filter(Boolean).map((text,index)=>({label:String.fromCharCode(65+index),text})); }
    }
    return [];
  }

  function optionMarkup(question) {
    const type = question.question_type;
    if (type === "quantitative_comparison") {
      const quantities = parseOptions(question.options);
      const quantityA = quantities.find(item => /quantity.?a/i.test(item.label || ""))?.text || quantities[0]?.text || "";
      const quantityB = quantities.find(item => /quantity.?b/i.test(item.label || ""))?.text || quantities[1]?.text || "";
      const comparison = `
        <div class="qc-comparison">
          <div class="qc-column"><div class="qc-label">Quantity A</div><div class="qc-value">${esc(quantityA)}</div></div>
          <div class="qc-column"><div class="qc-label">Quantity B</div><div class="qc-value">${esc(quantityB)}</div></div>
        </div>`;
      const choices = [
        ["A","Quantity A is greater"],
        ["B","Quantity B is greater"],
        ["C","The two quantities are equal"],
        ["D","The relationship cannot be determined"]
      ];
      return comparison + choices.map(([value,label]) => `
        <label class="answer-option">
          <input type="radio" name="answer-${esc(question.id)}" value="${value}">
          <span><b>${value}.</b> ${label}</span>
        </label>`).join("");
    }

    if (type === "numeric_entry") {
      return `<input class="numeric-answer" type="number" step="any" inputmode="decimal" id="numeric-${esc(question.id)}" placeholder="Enter your answer">`;
    }

    const options = parseOptions(question.options);
    const isMultiple = type === "multiple_choice_multiple";
    return options.map((option,index) => {
      const value = String(option.label || String.fromCharCode(65+index));
      return `
        <label class="answer-option">
          <input type="${isMultiple ? "checkbox" : "radio"}" name="answer-${esc(question.id)}" value="${esc(value)}">
          <span><b>${esc(value)}.</b> ${esc(option.text ?? "")}</span>
        </label>`;
    }).join("");
  }

  function answerLabel(correct) {
    if (correct && typeof correct === "object" && !Array.isArray(correct)) {
      return String(correct.value ?? "");
    }
    if (Array.isArray(correct)) return correct.join(", ");
    return String(correct ?? "");
  }

  function explanationMarkup(grade) {
    const type = grade?.explanation_type || "text";
    const pieces = [];

    if ((type === "text" || type === "both") && grade?.explanation) {
      pieces.push(`<div class="explanation-text">${esc(grade.explanation)}</div>`);
    }

    if ((type === "video" || type === "both") && grade?.explanation_video_url) {
      const embed = videoEmbed(grade.explanation_video_url);
      if (embed) {
        pieces.push(`<div class="question-video"><iframe src="${esc(embed)}" title="Question explanation video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`);
      }
    }

    return pieces.length
      ? `<div style="margin-top:12px"><strong>Explanation</strong>${pieces.join("")}</div>`
      : "";
  }

  function renderQuestions(questions) {
    const host = $("questionList");

    if (!questions.length) {
      host.innerHTML = '<div class="empty-state">No practice questions have been linked to this lesson yet.</div>';
      return;
    }

    // Move all members of a shared stimulus group together while preserving
    // the first position at which that group appears in the lesson.
    const ordered = [];
    const visitedStimuli = new Set();
    questions.forEach(question => {
      if (!question.stimulus_id) {
        ordered.push(question);
        return;
      }
      const key = String(question.stimulus_id);
      if (visitedStimuli.has(key)) return;
      visitedStimuli.add(key);
      ordered.push(...questions.filter(item => String(item.stimulus_id) === key));
    });

    const seenStimuli = new Set();
    host.innerHTML = ordered.map((question,index) => {
      let sharedStimulus = "";
      if (question.stimulus_id && !seenStimuli.has(String(question.stimulus_id))) {
        seenStimuli.add(String(question.stimulus_id));
        const stimulus = question.stimulus || {};
        const sharedFigure = stimulus.figure_url
          ? `<img class="question-figure" src="${esc(stimulus.figure_url)}" alt="${esc(stimulus.title || "Shared Data Analysis figure")}" loading="lazy">`
          : "";
        const sharedText = stimulus.stimulus_text
          ? `<p class="stimulus-context">${esc(stimulus.stimulus_text)}</p>`
          : "";
        sharedStimulus = `
          <section class="shared-stimulus">
            <div class="stimulus-label">Shared Data Analysis stimulus</div>
            <h3>${esc(stimulus.title || "Data set")}</h3>
            ${sharedText}
            ${sharedFigure}
            <p class="stimulus-instruction">Use this same figure or data set for the three linked questions below.</p>
          </section>`;
      }

      const figure = !question.stimulus_id && question.figure_url
        ? `<img class="question-figure" src="${esc(question.figure_url)}" alt="Question figure" loading="lazy">`
        : "";
      const questionText = esc(question.question_text || "");
      const label = question.question_type === "quantitative_comparison"
        ? "Quantitative Comparison"
        : question.question_type === "multiple_choice_multiple"
          ? "Multiple answer"
          : question.question_type === "numeric_entry"
            ? "Numeric entry"
            : question.question_type === "data_interpretation"
              ? "Data interpretation"
              : "Single answer";
      const category = ({
        arithmetic: "Arithmetic",
        data_analysis: "Data Analysis",
        algebra: "Algebra",
        geometry: "Geometry"
      })[question.topic_category] || question.topic || "GRE Quant";
      const subtopic = String(question.subtopic || "").replaceAll("_"," ");

      return `
        ${sharedStimulus}
        <article class="question-card" data-question-card="${esc(question.id)}">
          <div class="question-meta">
            <span class="question-tag">Question ${index+1}</span>
            <span>${esc(category)}${subtopic ? " · " + esc(subtopic) : ""}</span>
            <span>${label}</span>
            <span>Difficulty ${esc(question.difficulty ?? "—")}/5</span>
          </div>
          <div class="question-text">${questionText}</div>
          ${figure}
          <div class="question-answers">${optionMarkup(question)}</div>
          <button class="check-answer" type="button" data-check-answer="${esc(question.id)}">Check answer</button>
          <div class="answer-feedback" id="feedback-${esc(question.id)}" hidden></div>
        </article>`;
    }).join("");

    ordered.forEach(question => {
      const card = host.querySelector(`[data-question-card="${CSS.escape(String(question.id))}"]`);
      const button = card.querySelector("[data-check-answer]");
      button.addEventListener("click", async () => {
        let response;

        if (question.question_type === "numeric_entry") {
          response = card.querySelector("#numeric-" + CSS.escape(String(question.id)))?.value ?? "";
          if (response.trim() === "") {
            alert("Please enter a numerical answer.");
            return;
          }
        } else {
          const selected = [...card.querySelectorAll('input[name="answer-' + CSS.escape(String(question.id)) + '"]:checked')]
            .map(input => input.value);
          if (!selected.length) {
            alert("Please select an answer.");
            return;
          }
          response = question.question_type === "multiple_choice_multiple" ? selected : selected[0];
        }

        button.disabled = true;
        button.textContent = "Checking…";

        const { data:grade, error:gradeError } = await db.rpc("grade_gre_question", {
          p_question_id: String(question.id),
          p_response: response
        });

        button.disabled = false;
        button.textContent = "Check answer";

        const feedback = card.querySelector("#feedback-" + CSS.escape(String(question.id)));
        feedback.hidden = false;

        if (gradeError) {
          feedback.className = "answer-feedback incorrect";
          feedback.textContent = "We could not check this answer: " + gradeError.message +
            ". Please verify that the learner SQL setup has been run in Supabase.";
          return;
        }

        const correct = !!grade?.correct;
        feedback.className = "answer-feedback " + (correct ? "correct" : "incorrect");
        feedback.innerHTML =
          `<strong>${correct ? "Correct!" : "Not quite."}</strong>` +
          `<div>Correct answer: ${esc(answerLabel(grade?.correct_answer))}</div>` +
          explanationMarkup(grade);
      });
    });
  }

  async function loadLesson() {
    const id = new URLSearchParams(location.search).get("id");
    const status = $("pageStatus");

    if (!id) {
      status.className = "load-error";
      status.textContent = "This lesson link is incomplete. Return to Quant Academy and select a lesson.";
      return;
    }

    const {data:lesson,error} = await db
      .from("lessons")
      .select("id,title,slug,module_id,sort_order,published,content,modules(id,title,slug)")
      .eq("id",id)
      .eq("published",true)
      .single();

    if (error || !lesson) {
      status.className = "load-error";
      status.textContent = "This lesson could not be loaded. It may be unpublished, unavailable, or public read access has not been configured in Supabase. " + (error?.message || "");
      return;
    }

    const [{data:siblings,error:siblingError},{data:questions,error:questionError}] = await Promise.all([
      db.from("lessons").select("id,title,slug,sort_order").eq("module_id",lesson.module_id).eq("published",true).order("sort_order"),
      db.from("questions")
        .select("id,topic,topic_category,subtopic,stimulus_id,question_type,difficulty,question_text,options,figure_url,question_usage")
        .eq("lesson_id",lesson.id)
        .eq("published",true)
        .in("question_usage",["practice","both"])
        .order("created_at")
    ]);

    let stimulusError = null;
    let displayQuestions = questions || [];
    const stimulusIds = [...new Set(displayQuestions.map(q => q.stimulus_id).filter(Boolean))];
    if (stimulusIds.length) {
      const { data: stimulusRows, error: stimulusQueryError } = await db
        .from("question_stimuli")
        .select("id,title,stimulus_text,figure_url")
        .in("id", stimulusIds);
      stimulusError = stimulusQueryError;
      const stimulusMap = new Map((stimulusRows || []).map(row => [String(row.id), row]));
      displayQuestions = displayQuestions.map(q => ({
        ...q,
        stimulus: q.stimulus_id ? stimulusMap.get(String(q.stimulus_id)) || null : null
      }));
    }

    const moduleTitle = lesson.modules?.title || "Quantitative Reasoning";
    $("moduleBreadcrumb").textContent = moduleTitle;
    $("moduleBreadcrumb").parentElement.innerHTML =
      '<a href="../index.html">Quant Academy</a> / ' + esc(moduleTitle) + ' / ' + esc(lesson.title);

    $("lessonEyebrow").textContent = "GRE Quant · " + moduleTitle;
    $("lessonTitle").textContent = lesson.title;
    $("lessonIntro").textContent = "Study the concept, review the examples, and practise GRE-style questions.";
    $("lessonNumber").textContent = String((siblings || []).findIndex(x=>String(x.id)===String(lesson.id))+1 || 1).padStart(2,"0");
    $("sideTitle").textContent = moduleTitle;
    $("sideLessons").innerHTML = (siblings || []).map((item,index) => `
      <a class="side-link ${String(item.id)===String(lesson.id)?"active":""}" href="lesson.html?id=${encodeURIComponent(item.id)}">
        <span class="side-num">${String(index+1).padStart(2,"0")}</span>
        ${esc(item.title)}
        <span class="check">${window.DrillGREProgress?.isDone("lesson-"+item.id)?"✓":""}</span>
      </a>`).join("");

    renderLessonContent(lesson.content);

    const teachingVideoUrl = videoEmbed(lesson.content?.video_url);
    if (teachingVideoUrl) {
      $("teachingVideo").hidden = false;
      $("teachingVideoFrame").innerHTML = `<iframe src="${esc(teachingVideoUrl)}" title="${esc(lesson.title)} teaching video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
    }

    $("backToCourse").href = "../index.html";

    // Mark lesson completion using the existing browser-local LMS progress store.
    const completeButton = $("completeLesson");
    const progressKey = "lesson-" + lesson.id;
    const syncCompletion = () => {
      const done = window.DrillGREProgress?.isDone(progressKey) || false;
      completeButton.textContent = done ? "✓ Lesson completed" : "Mark lesson complete";
      completeButton.classList.toggle("primary", !done);
    };
    completeButton.onclick = () => {
      const done = window.DrillGREProgress?.isDone(progressKey) || false;
      window.DrillGREProgress?.markDone(progressKey, !done);
      syncCompletion();
      const marker = $("sideLessons").querySelector(`a[href="lesson.html?id=${encodeURIComponent(lesson.id)}"] .check`);
      if (marker) marker.textContent = !done ? "✓" : "";
    };
    syncCompletion();

    if (questionError || stimulusError) {
      const error = questionError || stimulusError;
      $("questionList").innerHTML = '<div class="empty-state">The lesson loaded, but its questions or shared Data Analysis figures could not be retrieved: ' + esc(error.message) + '</div>';
    } else {
      renderQuestions(displayQuestions);
    }

    status.hidden = true;
    $("lessonLayout").hidden = false;
  }

  document.addEventListener("DOMContentLoaded",loadLesson);
})();