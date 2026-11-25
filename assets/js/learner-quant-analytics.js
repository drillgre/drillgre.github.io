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
    const host=$("practiceSources");
    if(!rows.length){host.innerHTML=empty("Your practice source mix will appear here.");return;}
    const max=Math.max(1,...rows.map(x=>Number(x.answered||0)));
    host.innerHTML=rows.map(row=>{const count=Number(row.answered||0),width=Math.max(0,Math.min(100,count/max*100));return '<article class="source-row"><span class="source-name">'+safe(row.source)+'</span><span class="source-count">'+number(count)+' answers</span><div class="source-meter"><span style="width:'+width+'%"></span></div><span class="source-accuracy">'+percent(row.accuracy)+' accuracy</span></article>'}).join("");
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

  function renderCompass(scores) {
    const host=$("quantScoreCompass"); if(!host)return;
    host.id="scoreGauge";host.className="score-gauge";
    host.innerHTML='<svg viewBox="0 0 320 190" aria-label="Quant score gauge"><path class="gauge-track" d="M35 155 A125 125 0 0 1 285 155"/><path class="gauge-band band-red" data-band="130–137" data-label="Foundation" d="M35 155 A125 125 0 0 1 54.1 82.5"/><path class="gauge-band band-orange" data-band="138–145" data-label="Developing" d="M54.1 82.5 A125 125 0 0 1 105.9 36.1"/><path class="gauge-band band-yellow" data-band="146–153" data-label="Progressing" d="M105.9 36.1 A125 125 0 0 1 178.7 31.9"/><path class="gauge-band band-lime" data-band="154–161" data-label="Strong" d="M178.7 31.9 A125 125 0 0 1 245.9 82.5"/><path class="gauge-band band-green" data-band="162–170" data-label="Advanced" d="M245.9 82.5 A125 125 0 0 1 285 155"/><g id="gaugeNeedle" class="gauge-needle"><path d="M160 155 L154 151 L160 51 L166 151 Z"/><circle cx="160" cy="155" r="9"/></g><text x="31" y="178">130</text><text x="289" y="178" text-anchor="end">170</text></svg><div class="gauge-score"><strong id="quantCompassScore">—</strong><span>/ 170</span></div><div id="gaugeTooltip" class="gauge-tooltip">Explore score bands</div><div class="gauge-caption"><strong id="quantCompassLabel">Build your baseline</strong><span id="quantCompassDetail">Complete a mock to see your score indicator</span></div>';
    const css=document.createElement("style");css.textContent='.dash-shell{width:min(1600px,calc(100% - 56px));max-width:1600px}.dashboard-focus-grid{grid-template-columns:1fr 1fr;gap:18px}.gauge-layout{display:block}.score-gauge{position:relative;max-width:480px;margin:10px auto}.score-gauge svg{width:100%;display:block}.gauge-track{fill:none;stroke:#edf0f5;stroke-width:22}.gauge-band{fill:none;stroke-width:21;cursor:pointer;transition:.18s}.band-red{stroke:#e84c4c}.band-orange{stroke:#f28a24}.band-yellow{stroke:#f2c94c}.band-lime{stroke:#a7c943}.band-green{stroke:#20a66a}.gauge-band:hover{stroke-width:28;filter:drop-shadow(0 3px 3px #ccd3e0)}.score-gauge.has-hover .gauge-band:not(.is-active){opacity:.4}.gauge-needle{transform-origin:160px 155px;transition:transform .5s}.gauge-needle path,.gauge-needle circle{fill:#172b61}.gauge-needle circle{stroke:white;stroke-width:3}.gauge-score{position:absolute;top:72%;left:50%;transform:translate(-50%,-50%);display:flex;align-items:baseline}.gauge-score strong{font-size:40px;color:#172b61}.gauge-score span{font-size:12px}.gauge-tooltip{position:absolute;top:0;left:50%;transform:translateX(-50%);background:#172b61;color:white;padding:6px 10px;border-radius:8px;font-size:10px;opacity:0}.has-hover .gauge-tooltip{opacity:1}.gauge-caption{text-align:center;display:grid;gap:4px}.gauge-caption strong{font-size:15px}.gauge-caption span{font-size:11px;color:#69758b}.source-row{display:grid;grid-template-columns:1fr auto;gap:8px;padding:12px 0;border-bottom:1px solid #edf0f5}.source-row .source-name{font-size:12px;font-weight:750}.source-row .source-count{font-size:11px;color:#315efb}.source-row .source-meter,.source-row .source-accuracy{grid-column:1/-1}.source-row .source-meter{height:6px;background:#edf0f6;border-radius:8px;overflow:hidden}.source-row .source-meter span{display:block;height:100%;background:#5276d8}.source-row .source-accuracy{font-size:10px;color:#69758b}@media(max-width:900px){.dashboard-focus-grid{grid-template-columns:1fr}.dash-shell{width:calc(100% - 30px)}}';document.head.appendChild(css);
    const bands=[...host.querySelectorAll(".gauge-band")],tip=$("gaugeTooltip");
    bands.forEach(x=>{x.addEventListener("mouseenter",()=>{host.classList.add("has-hover");bands.forEach(y=>y.classList.toggle("is-active",x===y));tip.textContent=x.dataset.band+" · "+x.dataset.label;$("quantCompassLabel").textContent=x.dataset.label+" range";$("quantCompassDetail").textContent="GRE Quant score band "+x.dataset.band});x.addEventListener("mouseleave",()=>{host.classList.remove("has-hover");x.classList.remove("is-active")})});
    const latest=(scores||[]).slice().sort((x,y)=>new Date(y.date||0)-new Date(x.date||0))[0];if(!latest||latest.score==null)return;
    const score=Number(latest.score),ratio=Math.max(0,Math.min(1,(score-130)/40));$("gaugeNeedle").setAttribute("transform","rotate("+(-90+ratio*180)+" 160 155)");$("quantCompassScore").textContent=Math.round(score);
    $("quantCompassLabel").textContent=score>=165?"Excellent momentum":score>=160?"Strong progress":score>=150?"Building proficiency":"Keep strengthening the basics";$("quantCompassDetail").textContent="Latest completed mock · "+(latest.date?new Date(latest.date).toLocaleDateString():"Latest mock");
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
    renderCompass(data.mock_scores || []);
    $("quantAnalytics").hidden = false;
    status.hidden = true;
  }

  document.addEventListener("DOMContentLoaded", load);
})();
