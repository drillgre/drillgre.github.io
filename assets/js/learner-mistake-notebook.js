(() => {
  "use strict";

  const db = window.supabase.createClient(
    "https://aayzpcfryixauwsytphd.supabase.co",
    "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz"
  );
  const $ = id => document.getElementById(id);
  let mistakes = [];
  let activeFilter = "all";

  const safe = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));
  const pretty = value => String(value || "Unclassified").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
  const parseChoices = value => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch (_) { return value.split(/\\r?\\n/).filter(Boolean).map((text,index)=>({label:String.fromCharCode(65+index),text})); } }
    return [];
  };
  const jsonText = value => {
    if (value == null) return "Not available in the saved record";
    if (typeof value === "string") return value;
    try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
  };
  const dateText = value => value ? new Date(value).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}) : "Date unavailable";
  const REASONS = [
    ["conceptual_misunderstanding","Conceptual misunderstanding"],
    ["calculation_error","Calculation error"],
    ["misread_question","Misreading the question"],
    ["time_management","Time management"],
    ["incorrect_strategy","Incorrect strategy"],
    ["careless_error","Careless error"],
    ["other","Other"]
  ];
  const reasonLabel = value => REASONS.find(([key])=>key===value)?.[1] || "Not classified";

  function filteredMistakes() {
    const query = ($("mistakeSearch")?.value || "").trim().toLowerCase();
    return mistakes.filter(item => {
      const statusMatch = activeFilter === "all" || item.status === activeFilter;
      const q = item.question || {};
      const searchable = [
        q.topic,q.topic_category,q.subtopic,q.question_text,item.source,item.note
      ].join(" ").toLowerCase();
      return statusMatch && (!query || searchable.includes(query));
    });
  }

  function renderDiagnostics() {
    const host = $("mistakeDiagnostics");
    const topics = new Map();
    mistakes.forEach(item => {
      const q = item.question || {};
      const topic = pretty(q.topic_category || q.topic || "Unclassified");
      if (!topics.has(topic)) topics.set(topic,{total:0,reasons:{}});
      const row = topics.get(topic);
      const reason = item.reason || "unclassified";
      row.total++;
      row.reasons[reason] = (row.reasons[reason] || 0) + 1;
    });
    const columns = [...REASONS,["unclassified","Not classified"]];
    host.innerHTML = !mistakes.length
      ? '<div class="mistake-empty">Diagnostics will appear after you record missed questions.</div>'
      : '<div class="mistake-diagnostic-wrap"><table class="mistake-diagnostic-table"><thead><tr><th>Topic</th><th>Total</th>' +
        columns.map(([,label])=>'<th>'+safe(label)+'</th>').join('') +
        '</tr></thead><tbody>' +
        [...topics.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([topic,row]) =>
          '<tr><th>'+safe(topic)+'</th><td><strong>'+row.total+'</strong></td>' +
          columns.map(([key]) => {
            const count = row.reasons[key] || 0;
            const pct = row.total ? (count/row.total*100) : 0;
            return '<td>'+(count ? count+' <span>('+pct.toFixed(1)+'%)</span>' : '0 <span>(0%)</span>')+'</td>';
          }).join('')+'</tr>'
        ).join('')+'</tbody></table></div>';
  }

  function render() {
    const host = $("mistakeNotebookList");
    const rows = filteredMistakes();
    const openCount = mistakes.filter(x => x.status !== "mastered").length;
    $("mistakeTotal").textContent = openCount.toLocaleString();
    renderDiagnostics();
    host.hidden = false;
    if (!rows.length) {
      host.innerHTML = '<div class="mistake-empty">' +
        (mistakes.length ? "No mistakes match this filter. Try another view or search term." : "No recorded incorrect answers yet. When you miss a question in the Question Bank, a quiz or a mock, it will appear here.") +
        '</div>';
      return;
    }
    host.innerHTML = rows.map(item => {
      const q = item.question || {};
      const topic = pretty(q.topic_category || q.topic);
      const subtopic = pretty(q.subtopic);
      const status = item.status === "mastered" ? "mastered" : "review";
      const action = status === "mastered" ? "Move back to review" : "Mark as mastered";
      return '<article class="mistake-card" data-question-id="' + safe(item.question_id) + '">' +
        '<div class="mistake-card-top"><div class="mistake-meta">' + safe(topic) + ' · ' + safe(subtopic) + ' · ' + safe(item.source) + ' · ' + safe(dateText(item.occurred_at)) + '</div><span class="mistake-status ' + status + '">' + (status === "mastered" ? "Mastered" : "To review") + '</span></div>' +
        '<button type="button" class="mistake-question-link" data-action="open-question">' + safe(q.question_text || "Question text is unavailable in this saved record.") + '</button>' +
        '<div class="mistake-reason-line"><label for="mistake-reason-' + safe(item.question_id) + '">Reason</label>' +
        '<select class="mistake-reason" id="mistake-reason-' + safe(item.question_id) + '">' +
          '<option value="">Select a reason</option>' +
          REASONS.map(([value,label]) => '<option value="' + value + '"' + (item.reason === value ? ' selected' : '') + '>' + label + '</option>').join('') +
        '</select><span class="mistake-reason-status" aria-live="polite"></span></div>' +
        '<div class="mistake-actions"><button type="button" class="mistake-resolve ' + (status === "mastered" ? "reopen" : "") + '" data-action="toggle">' + action + '</button></div>' +
        '</article>';
    }).join("");
  }

  async function saveMistake(questionId, patch) {
    const current = mistakes.find(item => item.question_id === questionId);
    if (!current) return;
    const session = (await db.auth.getSession()).data.session;
    if (!session?.user) throw new Error("Sign in to save your mistake reason.");
    const payload = {
      learner_id: session.user.id,
      question_id: questionId,
      note: current.note || "",
      reason: patch.reason !== undefined ? patch.reason : current.reason,
      status: patch.status ?? current.status ?? "review",
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from("gre_learner_mistake_notes").upsert(payload,{onConflict:"learner_id,question_id"});
    if (error) throw error;
    current.note = "";
    current.reason = payload.reason;
    current.status = payload.status;
    current.updated_at = payload.updated_at;
  }

  function openQuestion(item) {
    const q = item.question || {};
    const body = $("mistakeQuestionDialogBody");
    const figure = q.figure_url || item.stimulus_figure_url || "";
    const choices = parseChoices(q.options);
    const options = choices.length ? '<section class="mistake-dialog-options"><h3>Answer options</h3><div>'+choices.map((choice,index)=>'<div class="mistake-dialog-option"><strong>'+safe(choice.label || String.fromCharCode(65+index))+'</strong><span>'+safe(choice.text ?? choice.value ?? choice)+'</span></div>').join("")+'</div></section>' : "";
    const stimulus = item.stimulus ? '<section><h3>Data / stimulus</h3><p>'+safe(item.stimulus)+'</p></section>' : "";
    body.innerHTML = '<div class="mistake-dialog-meta">'+safe(pretty(q.topic_category || q.topic))+' · '+safe(pretty(q.subtopic))+'</div>' +
      stimulus + (figure ? '<img class="mistake-dialog-figure" src="'+safe(figure)+'" alt="Question figure">' : '') +
      '<div class="mistake-dialog-question">'+safe(q.question_text || "Question text unavailable.")+'</div>' +
      options +
      '<section><h3>Correct answer</h3><div class="mistake-dialog-answer">'+safe(jsonText(q.correct_answer))+'</div></section>' +
      (q.explanation ? '<section><h3>Explanation</h3><p>'+safe(q.explanation)+'</p></section>' : '');
    $("mistakeQuestionDialog").showModal();
    if (window.DrillGREMath?.render) {
      window.DrillGREMath.render(body);
    } else if (window.renderMathInElement) {
      window.renderMathInElement(body,{delimiters:[{left:"\\(",right:"\\)",display:false},{left:"\\[",right:"\\]",display:true},{left:"$",right:"$",display:true}],throwOnError:false,strict:"ignore"});
    }
  }

  async function load() {
    const status = $("mistakeNotebookStatus");
    if (!status) return;
    const { data: sessionData } = await db.auth.getSession();
    if (!sessionData?.session) return;
    const { data, error } = await db.rpc("get_learner_mistake_notebook");
    if (error) {
      status.classList.add("error");
      status.textContent = "The Mistake Notebook is not available yet. Apply supabase/learner-mistake-notebook.sql in the Supabase SQL Editor, then refresh. " + error.message;
      return;
    }
    mistakes = Array.isArray(data) ? data : [];
    status.hidden = true;
    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("mistakeSearch")?.addEventListener("input",render);
    document.querySelectorAll("[data-mistake-filter]").forEach(button => {
      button.addEventListener("click",() => {
        activeFilter = button.dataset.mistakeFilter;
        document.querySelectorAll("[data-mistake-filter]").forEach(el=>el.classList.toggle("active",el===button));
        render();
      });
    });
    $("mistakeNotebookList")?.addEventListener("change",async event => {
      const select = event.target.closest(".mistake-reason");
      if (!select) return;
      const card = select.closest(".mistake-card");
      const questionId = card?.dataset.questionId;
      const item = mistakes.find(x=>x.question_id===questionId);
      if (!item) return;
      const status = card.querySelector(".mistake-reason-status");
      status.textContent = "Saving…";
      select.disabled = true;
      try {
        await saveMistake(questionId,{reason:select.value || null});
        status.textContent = "Saved";
      } catch(error) {
        status.textContent = error.message || "Could not save";
        select.value = item.reason || "";
      } finally { select.disabled = false; }
    });
    $("mistakeNotebookList")?.addEventListener("click",async event => {
      const questionButton = event.target.closest('button[data-action="open-question"]');
      if (questionButton) {
        const card = questionButton.closest(".mistake-card");
        const item = mistakes.find(x=>x.question_id===card?.dataset.questionId);
        if (item) openQuestion(item);
        return;
      }
      const button = event.target.closest('button[data-action="toggle"]');
      if (!button || button.disabled) return;
      const card = button.closest(".mistake-card");
      const questionId = card?.dataset.questionId;
      const item = mistakes.find(x=>x.question_id===questionId);
      if (!item) return;

      const previousStatus = item.status === "mastered" ? "mastered" : "review";
      const nextStatus = previousStatus === "mastered" ? "review" : "mastered";
      item.status = nextStatus;
      render();

      const updatedCard = $("mistakeNotebookList").querySelector('[data-question-id="' + CSS.escape(questionId) + '"]');
      const updatedButton = updatedCard?.querySelector('button[data-action="toggle"]');
      if (updatedButton) {
        updatedButton.disabled = true;
        updatedButton.textContent = "Saving…";
        updatedButton.title = "Your change is being saved";
      }

      try {
        await saveMistake(questionId,{status:nextStatus});
        const savedCard = $("mistakeNotebookList").querySelector('[data-question-id="' + CSS.escape(questionId) + '"]');
        const savedButton = savedCard?.querySelector('button[data-action="toggle"]');
        if (savedButton) {
          savedButton.disabled = false;
          savedButton.textContent = nextStatus === "mastered" ? "Move back to review" : "Mark as mastered";
          savedButton.title = "Saved";
        }
      } catch(error) {
        item.status = previousStatus;
        render();
        const status = $("mistakeNotebookStatus");
        status.hidden = false;
        status.classList.add("error");
        status.textContent = "Could not save your change. " + (error.message || "Please try again.");
      }
    });
    $("closeMistakeQuestionDialog")?.addEventListener("click",()=>$("mistakeQuestionDialog").close());
    $("mistakeQuestionDialog")?.addEventListener("click",event=>{
      if(event.target===$("mistakeQuestionDialog")) $("mistakeQuestionDialog").close();
    });
    load();
  });
})();
