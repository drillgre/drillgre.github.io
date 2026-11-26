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
    const subtopicWeak = eligible.flatMap(t => (t.subtopics || [])
      .filter(s => Number(s.answered) >= 5 && Number(s.accuracy) < 70)
      .map(s => ({...s, topic:t.topic})))
      .sort((x,y)=>Number(x.accuracy)-Number(y.accuracy));
    subtopicWeak.slice(0,1).forEach(s => items.push({
      title: "Target " + label(s.subtopic),
      body: label(s.topic) + " subtopic accuracy is " + percent(s.accuracy) + " across " + number(s.answered) + " answers. Revisit the method and practise this specific skill.",
      href: "/quant/quiz.html",
      action: "Practise Quant topics"
    }));
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

  function renderMistakeIntelligence(data) {
    const host = $("mistakeIntelligence");
    if (!host) return;
    const summary = data?.summary || {};
    const areas = data?.areas || [];
    const wrong = Number(summary.wrong_answers || 0);
    const repeat = Number(summary.repeat_misses || 0);
    const weak = areas.slice(0,5);
    const stats = '<div class="mistake-summary">' +
      '<div class="mistake-stat"><strong>' + number(wrong) + '</strong><span>Incorrect answers</span></div>' +
      '<div class="mistake-stat"><strong>' + number(repeat) + '</strong><span>Repeat misses (minimum)</span></div>' +
      '<div class="mistake-stat"><strong>' + number(areas.length) + '</strong><span>Areas assessed</span></div></div>';
    if (!wrong) {
      host.innerHTML = stats + '<p class="mistake-empty">No incorrect answers are recorded yet. As you complete Question Bank practice, topic quizzes and mocks, recurring weak areas will appear here.</p>';
      return;
    }
    const max = Math.max(1, ...weak.map(x => Number(x.wrong_answers || 0)));
    host.innerHTML = stats + weak.map(area => {
      const misses = Number(area.wrong_answers || 0);
      const width = Math.max(0, Math.min(100, misses / max * 100));
      const difficulty = area.difficulty == null ? "All difficulty levels" : "Difficulty " + area.difficulty;
      return '<article class="mistake-row"><strong>' + safe(label(area.topic)) + ' · ' + safe(label(area.subtopic)) + '</strong><strong>' + number(misses) + ' misses</strong><small>' + safe(difficulty) + ' · ' + number(area.questions_missed) + ' questions · ' + percent(area.accuracy) + ' accuracy</small><div class="mistake-meter"><span style="width:' + width + '%"></span></div></article>';
    }).join("");
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

  function renderStudyHeatmap(rows) {
    const host = $("studyActivityHeatmap");
    if (!host) return;
    const byDate = new Map((rows || []).map(row => [row.activity_date, Number(row.answered || 0)]));
    const end = new Date(); end.setHours(0,0,0,0);
    const start = new Date(end); start.setDate(start.getDate()-363); start.setDate(start.getDate()-start.getDay());
    const cells=[];
    for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
      const key=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
      const count=byDate.get(key)||0,level=count===0?0:count<5?1:count<15?2:count<30?3:4;
      cells.push('<span class="study-heatmap-cell" data-level="'+level+'" title="'+key+': '+count+' answers"></span>');
    }
    host.innerHTML=cells.join("");
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
    const host = $("quantScoreCompass");
    if (!host) return;
    host.id = "scoreGauge";
    host.className = "score-gauge";
    host.innerHTML = '<svg viewBox="0 0 320 190" role="img" aria-label="GRE Quant score range from 130 to 170"><path class="gauge-track" pathLength="1000" d="M35 155 A125 125 0 0 1 285 155"/><path class="gauge-band band-red" pathLength="1000" stroke-dasharray="186 814" stroke-dashoffset="0" data-band="130–137" data-label="Foundation" d="M35 155 A125 125 0 0 1 285 155"/><path class="gauge-band band-orange" pathLength="1000" stroke-dasharray="186 814" stroke-dashoffset="-200" data-band="138–145" data-label="Developing" d="M35 155 A125 125 0 0 1 285 155"/><path class="gauge-band band-yellow" pathLength="1000" stroke-dasharray="186 814" stroke-dashoffset="-400" data-band="146–153" data-label="Progressing" d="M35 155 A125 125 0 0 1 285 155"/><path class="gauge-band band-lime" pathLength="1000" stroke-dasharray="186 814" stroke-dashoffset="-600" data-band="154–161" data-label="Strong" d="M35 155 A125 125 0 0 1 285 155"/><path class="gauge-band band-green" pathLength="1000" stroke-dasharray="186 814" stroke-dashoffset="-800" data-band="162–170" data-label="Advanced" d="M35 155 A125 125 0 0 1 285 155"/><g id="gaugeNeedle" class="gauge-needle"><path d="M160 155 L154 151 L160 51 L166 151 Z"/><circle cx="160" cy="155" r="9"/></g><text x="31" y="178">130</text><text x="289" y="178" text-anchor="end">170</text></svg><div class="gauge-score"><strong id="quantCompassScore">No mock yet</strong><span id="quantCompassMaximum"></span></div><div id="gaugeTooltip" class="gauge-tooltip" role="status">Score band</div><div class="gauge-caption"><strong id="quantCompassLabel">Your score will appear here</strong><span id="quantCompassDetail">Complete a DrillGRE Quant mock to establish your baseline.</span></div>';
    const css = document.createElement("style");
    css.textContent = '.dash-shell{width:min(1600px,calc(100% - 56px));max-width:1600px}.dashboard-focus-grid{grid-template-columns:1fr 1fr;gap:18px}.score-gauge{position:relative;width:100%;max-width:410px;margin:8px auto 0}.score-gauge svg{width:100%;height:auto;display:block;overflow:visible}.gauge-track{fill:none;stroke:#edf0f5;stroke-width:22}.gauge-band{fill:none;stroke-width:21;stroke-linecap:butt;cursor:pointer;transition:stroke-width .18s,opacity .18s,filter .18s}.band-red{stroke:#e84c4c}.band-orange{stroke:#f28a24}.band-yellow{stroke:#f2c94c}.band-lime{stroke:#a7c943}.band-green{stroke:#20a66a}.gauge-band:hover{stroke-width:25;filter:drop-shadow(0 2px 2px #ccd3e0)}.score-gauge.has-hover .gauge-band:not(.is-active){opacity:.48}.gauge-needle{transform-origin:160px 155px;transition:transform .5s ease}.gauge-needle path,.gauge-needle circle{fill:#172b61}.gauge-needle circle{stroke:white;stroke-width:3}.score-gauge.no-score .gauge-needle{display:none}.gauge-score{position:absolute;top:72%;left:50%;transform:translate(-50%,-50%);display:flex;align-items:baseline;justify-content:center;gap:4px;min-width:130px;white-space:nowrap}.gauge-score strong{font-size:30px;line-height:1;color:#172b61}.gauge-score span{font-size:12px;color:#69758b}.score-gauge.no-score .gauge-score strong{font-size:16px;color:#69758b}.gauge-tooltip{position:absolute;top:2px;left:50%;transform:translateX(-50%);background:#172b61;color:white;padding:6px 10px;border-radius:8px;font-size:10px;opacity:0;pointer-events:none;white-space:nowrap;transition:opacity .15s}.score-gauge.has-hover .gauge-tooltip{opacity:1}.gauge-caption{text-align:center;display:grid;gap:4px;margin-top:-2px}.gauge-caption strong{font-size:14px}.gauge-caption span{font-size:11px;color:#69758b}.source-row{display:grid;grid-template-columns:1fr auto;gap:8px;padding:12px 0;border-bottom:1px solid #edf0f5}.source-row .source-name{font-size:12px;font-weight:750}.source-row .source-count{font-size:11px;color:#315efb}.source-row .source-meter,.source-row .source-accuracy{grid-column:1/-1}.source-row .source-meter{height:6px;background:#edf0f6;border-radius:8px;overflow:hidden}.source-row .source-meter span{display:block;height:100%;background:#5276d8}.source-row .source-accuracy{font-size:10px;color:#69758b}@media(max-width:900px){.dashboard-focus-grid{grid-template-columns:1fr}.dash-shell{width:calc(100% - 30px)}}';
    document.head.appendChild(css);

    const bands = [...host.querySelectorAll(".gauge-band")];
    const tip = $("gaugeTooltip");
    const latest = (scores || [])
      .filter(item => item && item.score != null && Number.isFinite(Number(item.score)))
      .slice()
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0];

    if (latest) {
      const score = Math.max(130, Math.min(170, Number(latest.score)));
      const ratio = (score - 130) / 40;
      $("gaugeNeedle").setAttribute("transform", "rotate(" + (-90 + ratio * 180) + " 160 155)");
      $("quantCompassScore").textContent = Math.round(score);
      $("quantCompassMaximum").textContent = "/ 170";
      $("quantCompassLabel").textContent = score >= 165 ? "Excellent momentum" : score >= 160 ? "Strong progress" : score >= 150 ? "Building proficiency" : "Keep strengthening the basics";
      $("quantCompassDetail").textContent = "Latest completed mock · " + (latest.date ? new Date(latest.date).toLocaleDateString() : "Date unavailable");
    } else {
      host.classList.add("no-score");
      $("quantCompassLabel").textContent = "No completed mock yet";
      $("quantCompassDetail").textContent = "Complete a DrillGRE Quant mock to see your estimated score here.";
    }

    bands.forEach(band => {
      band.addEventListener("mouseenter", () => {
        host.classList.add("has-hover");
        bands.forEach(item => item.classList.toggle("is-active", item === band));
        tip.textContent = band.dataset.band + " · " + band.dataset.label;
      });
      band.addEventListener("mouseleave", () => {
        host.classList.remove("has-hover");
        bands.forEach(item => item.classList.remove("is-active"));
      });
    });
  }

  async function load() {
    renderCompass([]);
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
    renderMistakeIntelligence(data.mistake_intelligence || {});
    renderRecommendations(topics);
    renderTrend(data.weekly || []);
    renderSources(data.sources || []);
    renderMockScores(data.mock_scores || []);
    renderStudyHeatmap(data.daily_activity || []);
    renderCompass(data.mock_scores || []);
    $("quantAnalytics").hidden = false;
    status.hidden = true;
  }

  document.addEventListener("DOMContentLoaded", load);
})();
