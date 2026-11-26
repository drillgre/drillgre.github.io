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

  function renderDifficulty(rows) {
    const host = $("difficultyAccuracy");
    if (!host) return;
    if (!rows?.length) { host.innerHTML = empty("No difficulty-tagged answers have been recorded yet."); return; }
    host.innerHTML = rows.map(row => {
      const accuracy = Number(row.accuracy || 0);
      return '<div class="difficulty-row"><span>Level ' + safe(row.difficulty) + '</span><div class="topic-meter"><span style="width:' + Math.max(0,Math.min(100,accuracy)) + '%"></span></div><strong>' + percent(row.accuracy) + '</strong><small>' + number(row.answered) + ' answers · ' + number(row.wrong) + ' incorrect</small></div>';
    }).join("");
  }

  function renderMastery(topics) {
    const host = $("topicMasteryMap");
    if (!host) return;
    if (!topics?.length) { host.innerHTML = empty("Complete practice to build your topic mastery map."); return; }
    host.innerHTML = topics.map(topic => {
      const accuracy = Number(topic.accuracy || 0);
      const status = Number(topic.answered) < 5 ? "Building evidence" : accuracy >= 85 ? "Strong" : accuracy >= 70 ? "Developing" : "Needs attention";
      return '<article class="mastery-tile"><strong>' + safe(label(topic.topic)) + '</strong><span>' + percent(topic.accuracy) + '</span><small>' + number(topic.answered) + ' answers · ' + status + '</small><div class="topic-meter"><span style="width:' + Math.max(0,Math.min(100,accuracy)) + '%"></span></div></article>';
    }).join("");
  }

  function renderTargetScore(scores, userId) {
    const input = $("targetQuantScore"), host = $("targetScoreProgress");
    if (!input || !host) return;
    const key = "drillgre_target_quant_score_" + userId;
    input.value = Math.max(130, Math.min(170, Number(localStorage.getItem(key) || 165)));
    const latest = [...(scores || [])].filter(x => x?.score != null).sort((a,b) => new Date(b.date || 0)-new Date(a.date || 0))[0];
    const render = () => {
      const target = Math.max(130,Math.min(170,Number(input.value || 165)));
      if (!latest) { host.innerHTML = empty("Complete your first mock to measure progress towards your target."); return; }
      const current = Number(latest.score), progress = target <= 130 ? 100 : Math.max(0,Math.min(100,(current-130)/(target-130)*100));
      host.innerHTML = '<div class="target-meta"><span>Latest mock: <strong>' + number(current) + '</strong></span><span>Target: <strong>' + number(target) + '</strong></span></div><div class="target-progress"><span style="width:' + progress + '%"></span></div><div class="target-meta"><span>' + (current >= target ? "Target achieved" : (target-current) + " points to target") + '</span><span>' + progress.toFixed(0) + '% of target range</span></div>';
    };
    $("saveTargetQuantScore").onclick = () => {
      const value = Math.round(Number(input.value));
      if (!Number.isFinite(value) || value < 130 || value > 170) { input.setCustomValidity("Enter a score from 130 to 170."); input.reportValidity(); return; }
      input.setCustomValidity(""); localStorage.setItem(key,String(value)); render();
    };
    render();
  }

  function renderSpeedAccuracy(rows, summary) {
    const host = $("speedAccuracy");
    if (!host) return;
    const timed = Number(summary?.timed_answers || 0);
    if (!timed) {
      host.innerHTML = '<p class="account-muted">No timed question data is available yet. Complete a timed adaptive mock after the dashboard analytics update has been applied. Your mock review already records time spent on each question.</p>';
      return;
    }
    const avg = Number(summary.avg_seconds || 0);
    const accuracy = summary.accuracy == null ? "—" : percent(summary.accuracy);
    const groups = [
      ["Fast and correct",summary.fast_correct,"Good pace and accuracy"],
      ["Fast but incorrect",summary.fast_incorrect,"Prioritise careful reading and checking"],
      ["Slow but correct",summary.slow_correct,"Look for more efficient solution methods"],
      ["Slow and incorrect",summary.slow_incorrect,"Review the underlying concept and approach"]
    ];
    const total = groups.reduce((sum,item)=>sum+Number(item[1]||0),0) || 1;
    const cards = groups.map(item => '<div class="speed-quadrant"><strong>' + number(item[1]) + '</strong><span>' + item[0] + '</span><small>' + item[2] + '</small><div class="topic-meter"><span style="width:' + (Number(item[1]||0)/total*100).toFixed(1) + '%"></span></div></div>').join("");
    const byDifficulty = (rows || []).map(row => '<div class="difficulty-row"><span>Level ' + safe(row.difficulty) + '</span><div class="topic-meter"><span style="width:' + Math.max(0,Math.min(100,Number(row.accuracy||0))) + '%"></span></div><strong>' + percent(row.accuracy) + '</strong><small>' + Number(row.avg_seconds).toFixed(1) + ' sec average · ' + number(row.answered) + ' questions</small></div>').join("");
    host.innerHTML = '<div class="speed-summary"><div><strong>' + avg.toFixed(1) + 's</strong><span>Average time per question</span></div><div><strong>' + accuracy + '</strong><span>Accuracy on timed questions</span></div></div><p class="speed-benchmark">Reference pace: about 105 seconds per question, based on standard GRE Quant section timing. Fast means at or below this pace.</p><div class="speed-quadrants">' + cards + '</div><p class="speed-benchmark">Performance by question difficulty</p>' + (byDifficulty || '<p class="account-muted">Not enough difficulty-tagged timed questions yet.</p>');
  }

  function renderNextAction(topics, difficultyRows) {
    const host = $("nextBestAction");
    if (!host) return;
    const eligible = (topics || []).filter(t=>Number(t.answered)>=5).sort((a,b)=>Number(a.accuracy)-Number(b.accuracy));
    const weak = eligible[0], hardWeak = (difficultyRows || []).filter(x=>Number(x.answered)>=3).sort((a,b)=>Number(a.accuracy)-Number(b.accuracy))[0];
    if (!weak) { host.innerHTML = '<div class="next-action"><strong>Build your baseline</strong><p>Complete a short Quant quiz or Question Bank set. Recommendations become more reliable after at least five answers in a topic.</p><a href="/quant/quiz.html">Create a topic quiz →</a></div>'; return; }
    const difficultyText = hardWeak ? ' Your weakest difficulty band is Level ' + hardWeak.difficulty + ' (' + percent(hardWeak.accuracy) + ' accuracy).' : '';
    host.innerHTML = '<div class="next-action"><strong>Focus on ' + safe(label(weak.topic)) + '</strong><p>Current accuracy is ' + percent(weak.accuracy) + ' across ' + number(weak.answered) + ' answers.' + safe(difficultyText) + ' Review one lesson, then complete a focused practice set.</p><a href="/quant/quiz.html">Practise this topic →</a></div>';
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
    host.innerHTML = '<svg viewBox="0 0 320 190" role="img" aria-label="GRE Quant score from 130 to 170"><path class="gauge-track" d="M35 155 A125 125 0 0 1 285 155"/><path class="gauge-progress" id="gaugeProgress" pathLength="1000" d="M35 155 A125 125 0 0 1 285 155"/><text x="31" y="178">130</text><text x="289" y="178" text-anchor="end">170</text></svg><div class="gauge-score"><strong id="quantCompassScore">No mock yet</strong><span id="quantCompassMaximum"></span></div><div class="gauge-percentile" id="quantCompassPercentile">ETS percentile rank</div><div class="gauge-caption"><strong id="quantCompassLabel">Your score will appear here</strong><span id="quantCompassDetail">Complete a DrillGRE Quant mock to establish your baseline.</span></div><p class="gauge-source">Percentile ranks: ETS 2026–27 reference group, July 2022 to June 2025.</p>';
    const css = document.createElement("style");
    css.textContent = '.score-gauge{position:relative;width:100%;max-width:410px;margin:8px auto 0}.score-gauge svg{width:100%;height:auto;display:block;overflow:visible}.gauge-track{fill:none;stroke:#edf0f5;stroke-width:22}.gauge-progress{fill:none;stroke:#4169ff;stroke-width:22;stroke-linecap:butt;pathLength:1000;stroke-dasharray:0 1000;transition:stroke-dasharray .5s ease}.gauge-score{position:absolute;top:72%;left:50%;transform:translate(-50%,-50%);display:flex;align-items:baseline;justify-content:center;gap:4px;min-width:130px;white-space:nowrap}.gauge-score strong{font-size:30px;line-height:1;color:#172b61}.gauge-score span{font-size:12px;color:#69758b}.score-gauge.no-score .gauge-score strong{font-size:16px;color:#69758b}.gauge-percentile{text-align:center;color:#244fc1;font-size:17px;font-weight:850;margin-top:-1px}.score-gauge.no-score .gauge-percentile{font-size:12px;color:#69758b;font-weight:600}.gauge-caption{text-align:center;display:grid;gap:4px;margin-top:5px}.gauge-caption strong{font-size:14px}.gauge-caption span{font-size:11px;color:#69758b}.gauge-source{text-align:center;font-size:10px;color:#8a94a6;margin:10px 0 0}.source-row{display:grid;grid-template-columns:1fr auto;gap:8px;padding:12px 0;border-bottom:1px solid #edf0f5}.source-row .source-name{font-size:12px;font-weight:750}.source-row .source-count{font-size:11px;color:#315efb}.source-row .source-meter,.source-row .source-accuracy{grid-column:1/-1}.source-row .source-meter{height:6px;background:#edf0f6;border-radius:8px;overflow:hidden}.source-row .source-meter span{display:block;height:100%;background:#5276d8}.source-row .source-accuracy{font-size:10px;color:#69758b}@media(max-width:900px){.dashboard-focus-grid{grid-template-columns:1fr}}';
    document.head.appendChild(css);

    const latest = (scores || [])
      .filter(item => item && item.score != null && Number.isFinite(Number(item.score)))
      .slice()
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0];

    // ETS 2026–27 Quantitative Reasoning percentile ranks.
    // Values are the percentage of test takers scoring lower than the stated score.
    const etsPercentiles = {
      170:89,169:85,168:80,167:75,166:72,165:67,164:63,163:60,162:57,
      161:53,160:50,159:47,158:45,157:42,156:39,155:37,154:34,153:31,
      152:29,151:26,150:23,149:21,148:19,147:16,146:14,145:12,144:10,
      143:9,142:7,141:6,140:5,139:4,138:3,137:2,136:2,135:1,134:1,
      133:1,132:null,131:null,130:null
    };

    const progress = $("gaugeProgress");
    if (latest) {
      const score = Math.max(130, Math.min(170, Math.round(Number(latest.score))));
      const ratio = (score - 130) / 40;
      progress.style.strokeDasharray = (ratio * 1000) + " 1000";
      $("quantCompassScore").textContent = score;
      $("quantCompassMaximum").textContent = "/ 170";
      const percentile = etsPercentiles[score];
      $("quantCompassPercentile").textContent = percentile == null
        ? "ETS percentile rank not reported"
        : percentile + (percentile === 1 ? "st" : percentile === 2 ? "nd" : percentile === 3 ? "rd" : "th") + " percentile";
      $("quantCompassLabel").textContent = percentile == null
        ? "Estimated Quant score"
        : "Higher than " + percentile + "% of GRE test takers";
      $("quantCompassDetail").textContent = "Latest completed DrillGRE mock · " + (latest.date ? new Date(latest.date).toLocaleDateString() : "Date unavailable");
    } else {
      host.classList.add("no-score");
      $("quantCompassPercentile").textContent = "ETS percentile rank will appear here";
      $("quantCompassLabel").textContent = "No completed mock yet";
      $("quantCompassDetail").textContent = "Complete a DrillGRE Quant mock to see your estimated score and ETS percentile reference.";
    }
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
    renderDifficulty(data.difficulty_accuracy || []);
    renderMastery(topics);
    renderTargetScore(data.mock_scores || [], sessionData.session.user.id);
    renderSpeedAccuracy(data.speed_accuracy || [], data.speed_summary || {});
    renderNextAction(topics, data.difficulty_accuracy || []);
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
