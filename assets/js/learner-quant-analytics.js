(() => {
  "use strict";

  const db = window.supabase.createClient(
    "https://aayzpcfryixauwsytphd.supabase.co",
    "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz"
  );
  const $ = id => document.getElementById(id);
  const labels = {
    arithmetic: "Arithmetic",
    data_analysis: "Data Analysis",
    algebra: "Algebra",
    geometry: "Geometry",
    number_properties: "Number properties",
    fractions_decimals: "Fractions and decimals",
    percentages: "Percentages",
    ratios_proportions: "Ratios and proportions",
    exponents_roots: "Exponents and roots",
    absolute_values: "Absolute values",
    arithmetic_other: "Other arithmetic",
    data_interpretation: "Data interpretation",
    probability: "Probability",
    counting: "Counting",
    statistics: "Statistics",
    algebra_core: "Core algebra",
    inequalities: "Inequalities",
    word_problems: "Word problems",
    coordinate_geometry: "Coordinate geometry",
    unclassified: "Unclassified"
  };
  const label = key => labels[key] || String(key || "Other").replaceAll("_", " ");
  const number = value => Number(value || 0).toLocaleString();
  const percent = value => value == null ? "—" : Number(value).toFixed(1) + "%";
  const safe = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));
  const empty = message => '<p class="account-muted">' + safe(message) + '</p>';

  function renderTopics(topics) {
    const host = $("topicPerformance");
    if (!topics.length) {
      host.innerHTML = empty("Complete a Question Bank question, topic quiz or mock test to begin building your topic profile.");
      return;
    }
    host.innerHTML = topics.map(topic => {
      const accuracy = Number(topic.accuracy || 0);
      const subtopics = (topic.subtopics || []).map(sub => (
        '<div class="subtopic-item"><span>' + safe(label(sub.subtopic)) + ' · ' + number(sub.answered) + '</span><strong>' + percent(sub.accuracy) + '</strong></div>'
      )).join("");
      return '<article class="topic-row"><div class="topic-row-head"><strong>' + safe(label(topic.topic)) + '</strong><span>' + percent(topic.accuracy) + ' · ' + number(topic.answered) + ' answers</span></div><div class="topic-meter"><span style="width:' + Math.max(0,Math.min(100,accuracy)) + '%"></span></div><div class="subtopic-list">' + subtopics + '</div></article>';
    }).join("");
  }

  function renderRecommendations(topics) {
    const host = $("practiceRecommendations");
    const eligible = topics.filter(t => Number(t.answered) >= 5);
    const weak = eligible.filter(t => Number(t.accuracy) < 65).sort((a,b) => a.accuracy-b.accuracy);
    const strong = eligible.filter(t => Number(t.accuracy) >= 85).sort((a,b) => b.accuracy-a.accuracy);
    const items = [];
    weak.slice(0,2).forEach(t => items.push({
      title: "Prioritise " + label(t.topic),
      body: "Your current accuracy is " + percent(t.accuracy) + " across " + number(t.answered) + " recorded answers. Review the concepts, then complete a focused practice set.",
      href: "/quant/quiz.html",
      action: "Build a focused quiz"
    }));
    if (!weak.length && eligible.length) {
      const mid = eligible.filter(t => Number(t.accuracy) < 85).sort((a,b) => a.accuracy-b.accuracy)[0];
      if (mid) items.push({
        title: "Strengthen " + label(mid.topic),
        body: "You are at " + percent(mid.accuracy) + ". A short targeted session can help make this performance more consistent.",
        href: "/quant/quiz.html", action: "Practise this topic"
      });
    }
    if (strong.length) items.push({
      title: "Maintain " + label(strong[0].topic),
      body: "You are performing well at " + percent(strong[0].accuracy) + ". Revisit this area periodically to retain accuracy.",
      href: "/quant/question-bank.html", action: "Continue Question Bank practice"
    });
    if (!eligible.length) {
      host.innerHTML = '<div class="recommendation"><strong>Build your first performance baseline</strong><p>Topic recommendations appear after at least five answers are recorded in a topic. Start with a short quiz or practise in the Question Bank.</p><a href="/quant/quiz.html">Create a topic quiz →</a></div>';
      return;
    }
    host.innerHTML = items.map(item => '<article class="recommendation"><strong>' + safe(item.title) + '</strong><p>' + safe(item.body) + '</p><a href="' + item.href + '">' + safe(item.action) + ' →</a></article>').join("");
  }

  function renderTrend(rows) {
    const host = $("weeklyTrend");
    if (!rows.length) {
      host.innerHTML = empty("Weekly trends will appear after you complete practice activities.");
      return;
    }
    host.innerHTML = rows.map(row => {
      const date = new Date(row.week_start + "T00:00:00");
      const week = date.toLocaleDateString(undefined,{month:"short",day:"numeric"});
      const accuracy = Number(row.accuracy || 0);
      return '<div class="trend-row"><span>' + safe(week) + '</span><div class="trend-meter"><span style="width:' + Math.max(0,Math.min(100,accuracy)) + '%"></span></div><strong>' + percent(row.accuracy) + '</strong><small style="grid-column:2/-1;color:var(--muted)">' + number(row.answered) + ' answers</small></div>';
    }).join("");
  }

  function renderSources(rows) {
    const host = $("practiceSources");
    if (!rows.length) {
      host.innerHTML = empty("Your practice source mix will appear here.");
      return;
    }
    host.innerHTML = rows.map(row => '<div class="source-row"><span>' + safe(row.source) + '</span><strong>' + number(row.answered) + ' answers</strong><small>' + percent(row.accuracy) + ' accuracy</small></div>').join("");
  }

  function renderMockScores(scores) {
    const host = $("mockScoreProgression");
    const ordered = [...scores].reverse();
    if (!ordered.length) {
      host.innerHTML = empty("Complete an adaptive mock to start tracking your DrillGRE mock score progression.");
      return;
    }
    host.innerHTML = ordered.map(item => {
      const date = item.date ? new Date(item.date).toLocaleDateString(undefined,{month:"short",day:"numeric"}) : "Mock";
      const score = Number(item.score || 0);
      const width = Math.max(0,Math.min(100,(score - 130) / 40 * 100));
      return '<div class="mock-score-row"><span>' + safe(date) + '</span><div class="topic-meter"><span style="width:' + width + '%"></span></div><strong>' + number(score) + '</strong></div>';
    }).join("");
  }

  async function load() {
    const status = $("analyticsStatus");
    if (!status) return;
    const { data: sessionData } = await db.auth.getSession();
    if (!sessionData?.session) return;
    const { data, error } = await db.rpc("get_learner_quant_analytics");
    if (error) {
      status.classList.add("error");
      status.textContent = "Quant analytics are not available yet. Apply supabase/learner-dashboard-analytics.sql in the Supabase SQL Editor, then refresh this page. " + error.message;
      return;
    }
    const topics = data.topics || [];
    $("qaAnswered").textContent = number(data.answered);
    $("qaAccuracy").textContent = percent(data.accuracy);
    $("qaFirstAccuracy").textContent = percent(data.question_bank_first_accuracy);
    $("qaFirstCount").textContent = number(data.question_bank_first_attempts) + " Question Bank first attempts";
    $("qaTopics").textContent = number(topics.length);
    renderTopics(topics);
    renderRecommendations(topics);
    renderTrend(data.weekly || []);
    renderSources(data.sources || []);
    renderMockScores(data.mock_scores || []);
    $("quantAnalytics").hidden = false;
    status.hidden = true;
  }

  document.addEventListener("DOMContentLoaded", load);
})();
