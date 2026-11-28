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
  const jsonText = value => {
    if (value == null) return "Not available in the saved record";
    if (typeof value === "string") return value;
    try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
  };
  const dateText = value => value ? new Date(value).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}) : "Date unavailable";

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

  function render() {
    const host = $("mistakeNotebookList");
    const rows = filteredMistakes();
    const openCount = mistakes.filter(x => x.status !== "mastered").length;
    $("mistakeTotal").textContent = openCount.toLocaleString();
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
      const options = q.options ? '<div class="mistake-answer"><strong>Options</strong>\n' + safe(jsonText(q.options)) + '</div>' : "";
      const answer = '<div class="mistake-answer"><strong>Correct answer</strong>\n' + safe(jsonText(q.correct_answer)) + '</div>';
      const explanation = q.explanation ? '<div class="mistake-answer"><strong>Explanation</strong>\n' + safe(q.explanation) + '</div>' : "";
      const status = item.status === "mastered" ? "mastered" : "review";
      const action = status === "mastered" ? "Move back to review" : "Mark as mastered";
      return '<article class="mistake-card" data-question-id="' + safe(item.question_id) + '">' +
        '<div class="mistake-card-top"><div class="mistake-meta">' + safe(topic) + ' · ' + safe(subtopic) + ' · ' + safe(item.source) + ' · ' + safe(dateText(item.occurred_at)) + '</div><span class="mistake-status ' + status + '">' + (status === "mastered" ? "Mastered" : "To review") + '</span></div>' +
        (item.stimulus ? '<div class="mistake-stimulus">' + safe(item.stimulus) + '</div>' : '') +
        '<div class="mistake-question">' + safe(q.question_text || "Question text is unavailable in this saved record.") + '</div>' +
        '<details class="mistake-details"><summary>Reveal correct answer and explanation</summary>' + options + answer + explanation + '</details>' +
        '<label class="mistake-note-label" for="mistake-reason-' + safe(item.question_id) + '">Why did you miss this question?</label>' +
        '<select class="mistake-reason" id="mistake-reason-' + safe(item.question_id) + '">' +
          '<option value="">Select a reason</option>' +
          [['conceptual_misunderstanding','Conceptual misunderstanding'],['calculation_error','Calculation error'],['misread_question','Misreading the question'],['time_management','Time management'],['incorrect_strategy','Incorrect strategy'],['careless_error','Careless error'],['other','Other']].map(([value,label]) => '<option value="' + value + '"' + (item.reason === value ? ' selected' : '') + '>' + label + '</option>').join('') +
        '</select>' +
        '<label class="mistake-note-label" for="mistake-note-' + safe(item.question_id) + '">My notes</label>' +
        '<textarea class="mistake-note" id="mistake-note-' + safe(item.question_id) + '" placeholder="What went wrong? Which concept or method should you remember?">' + safe(item.note || "") + '</textarea>' +
        '<div class="mistake-actions"><button type="button" class="mistake-save" data-action="save">Save note</button><button type="button" class="mistake-resolve ' + (status === "mastered" ? "reopen" : "") + '" data-action="toggle">' + action + '</button></div>' +
        '</article>';
    }).join("");
  }

  async function saveMistake(questionId, patch) {
    const card = [...document.querySelectorAll(".mistake-card")].find(el => el.dataset.questionId === questionId);
    const current = mistakes.find(item => item.question_id === questionId);
    if (!current) return;
    const payload = {
      learner_id: (await db.auth.getSession()).data.session.user.id,
      question_id: questionId,
      note: patch.note ?? current.note ?? "",
      reason: patch.reason ?? current.reason ?? null,
      status: patch.status ?? current.status ?? "review",
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from("gre_learner_mistake_notes").upsert(payload,{onConflict:"learner_id,question_id"});
    if (error) throw error;
    current.note = payload.note;
    current.reason = payload.reason;
    current.status = payload.status;
    current.updated_at = payload.updated_at;
    render();
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
    $("mistakeNotebookList")?.addEventListener("click",async event => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const card = button.closest(".mistake-card");
      const questionId = card?.dataset.questionId;
      const item = mistakes.find(x=>x.question_id===questionId);
      if (!item) return;
      button.disabled = true;
      const oldText = button.textContent;
      button.textContent = "Saving…";
      try {
        if (button.dataset.action === "save") {
          const note = card.querySelector(".mistake-note").value;
          const reason = card.querySelector(".mistake-reason").value || null;
          await saveMistake(questionId,{note,reason});
          const status = $("mistakeNotebookStatus");
          status.hidden = false;
          status.classList.remove("error");
          status.textContent = "Your note has been saved.";
          window.setTimeout(()=>{status.hidden=true;},2200);
        } else {
          await saveMistake(questionId,{status:item.status==="mastered"?"review":"mastered"});
        }
      } catch(error) {
        button.disabled = false;
        button.textContent = oldText;
        const status = $("mistakeNotebookStatus");
        status.hidden = false;
        status.classList.add("error");
        status.textContent = "Could not save your change. " + (error.message || "");
      }
    });
    load();
  });
})();
