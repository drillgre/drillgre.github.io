(() => {
  "use strict";

  const TOUR_GAP = 30 * 24 * 60 * 60 * 1000;
  const steps = [
    {path:"/",selector:"#home",title:"Welcome to DrillGRE",description:"Start here to understand the practice-led GRE platform, find the learning areas and see how DrillGRE helps you prepare."},
    {path:"/quant/index.html",selector:".hero",title:"Quant Academy",description:"Follow the structured Quant learning path. Browse lessons by topic and track your course progress."},
    {path:"/quant/lesson.html",selector:"#lessonLayout",title:"Learn a Quant topic",description:"Open a lesson to study explanations, worked examples and practice questions. Use the course outline to move between lessons."},
    {path:"/quant/question-bank.html",selector:".bank-hero",title:"Question Bank",description:"Browse GRE-style Quant questions. Filter by topic, subtopic, question format and difficulty, then submit answers and review explanations."},
    {path:"/quant/quiz.html",selector:".quiz-hero",title:"Topic Quizzes",description:"Build a focused quiz by selecting topics, question count and timing. Review your results and revisit areas that need practice."},
    {path:"/quant/mock.html",selector:"#introPanel",title:"Adaptive Mock Tests",description:"Take a GRE-style Quant mock under timed or untimed conditions. Review your score and answers when you finish."},
    {path:"/vocab.html",selector:".intro",title:"Vocab Mountain",description:"Build vocabulary through cumulative word review. Use the filters and word tiles to practise meanings, synonyms and examples."},
    {path:"/word-archery.html",selector:".hero",title:"Word Archery",description:"Practise vocabulary in a game format. Answer word challenges, build a streak and review your performance."},
    {path:"/leaderboard.html",selector:".leader-hero",title:"Leaderboard",description:"Explore voluntary learner rankings for Quant mock performance and Word Archery. Participation is controlled by learner opt-in."},
    {path:"/dashboard.html",selector:".dash-hero",title:"Your Learner Dashboard",description:"Return here to review your learning progress, Quant analytics, quiz and mock history, vocabulary activity and Mistake Notebook."}
  ];

  const keyFor = userId => "drillgre_site_tour_seen_v1_" + userId;
  const progressKey = "drillgre_site_tour_progress_v1";
  let userId = null;
  let overlay = null;
  let activeTarget = null;
  let stepIndex = 0;

  const normalPath = path => path.replace(/\/$/, "") || "/";
  const currentIndex = () => steps.findIndex(step => normalPath(step.path) === normalPath(location.pathname));

  function ensureUI() {
    if (document.getElementById("drillgreSiteTour")) return;
    const actions = document.querySelector(".drillgre-nav-actions");
    if (actions && !document.getElementById("drillgreTakeTour")) {
      const button = document.createElement("button");
      button.id = "drillgreTakeTour";
      button.type = "button";
      button.className = "drillgre-tour-trigger";
      button.textContent = "Take a tour";
      button.addEventListener("click", startTour);
      actions.insertBefore(button, actions.firstChild);
    }
    overlay = document.createElement("div");
    overlay.id = "drillgreSiteTour";
    overlay.className = "drillgre-tour-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="drillgre-tour-backdrop"></div>
      <section class="drillgre-tour-card" role="dialog" aria-modal="true" aria-labelledby="drillgreTourTitle">
        <div class="drillgre-tour-head"><span>EXPLORE DRILLGRE</span><button type="button" id="drillgreTourClose" aria-label="Close tour">×</button></div>
        <div class="drillgre-tour-progress"><span id="drillgreTourProgress"></span></div>
        <div class="drillgre-tour-count" id="drillgreTourCount"></div>
        <h2 id="drillgreTourTitle"></h2><p id="drillgreTourDescription"></p>
        <div class="drillgre-tour-actions"><button type="button" id="drillgreTourSkip">Skip tour</button><div><button type="button" id="drillgreTourBack">Back</button><button type="button" id="drillgreTourNext">Next</button></div></div>
      </section>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#drillgreTourNext").addEventListener("click", next);
    overlay.querySelector("#drillgreTourBack").addEventListener("click", previous);
    overlay.querySelector("#drillgreTourSkip").addEventListener("click", finish);
    overlay.querySelector("#drillgreTourClose").addEventListener("click", finish);
    overlay.querySelector(".drillgre-tour-backdrop").addEventListener("click", finish);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && overlay && !overlay.hidden) finish();
    });
    addStyles();
  }

  function addStyles() {
    if (document.getElementById("drillgreTourStyles")) return;
    const style = document.createElement("style");
    style.id = "drillgreTourStyles";
    style.textContent = `
      .drillgre-tour-trigger{border:1px solid #dce3f0;background:transparent;color:#34415b;border-radius:8px;padding:9px 12px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;transition:background .18s,color .18s,border-color .18s}
      .drillgre-tour-trigger:hover{background:#eef2ff;border-color:#b8c8f8;color:#315cff}
      .drillgre-tour-overlay[hidden]{display:none}
      .drillgre-tour-overlay{position:fixed;inset:0;z-index:100000}
      .drillgre-tour-backdrop{position:absolute;inset:0;background:rgba(12,22,45,.62)}
      .drillgre-tour-card{position:fixed;right:26px;bottom:24px;width:min(430px,calc(100vw - 32px));box-sizing:border-box;background:#f8f8f4;color:#17213a;border:1px solid #e2e6ef;padding:22px;box-shadow:0 18px 60px rgba(10,20,45,.28);z-index:100002}
      .drillgre-tour-head{display:flex;justify-content:space-between;align-items:center;color:#4169ff;font-size:10px;font-weight:850;letter-spacing:1.4px}
      .drillgre-tour-head button{border:0;background:transparent;color:#536078;font-size:25px;cursor:pointer}
      .drillgre-tour-progress{height:4px;background:#e6e9ef;margin:13px 0 12px}
      .drillgre-tour-progress span{display:block;height:100%;width:0;background:#4169ff;transition:width .2s}
      .drillgre-tour-count{font-size:10px;color:#6b7890;font-weight:800;letter-spacing:1px}
      .drillgre-tour-card h2{font-size:21px;line-height:1.2;margin:8px 0}
      .drillgre-tour-card p{font-size:13px;line-height:1.65;color:#59657b;margin:0 0 18px}
      .drillgre-tour-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .drillgre-tour-actions button{padding:9px 12px;border:1px solid #dce2ed;background:transparent;color:#34415b;font-size:12px;font-weight:700;cursor:pointer}
      .drillgre-tour-actions #drillgreTourNext{background:#4169ff;border-color:#4169ff;color:#fff;margin-left:7px}
      .drillgre-tour-actions button:hover{filter:brightness(.96)}
      .drillgre-tour-actions button:disabled{opacity:.35;cursor:not-allowed}
      .drillgre-tour-highlight{position:relative!important;z-index:100001!important;outline:4px solid #4169ff!important;outline-offset:4px!important;box-shadow:0 0 0 8px rgba(255,255,255,.95)!important}
      @media(max-width:600px){.drillgre-tour-card{right:12px;bottom:12px;width:calc(100vw - 24px);padding:18px}}
    `;
    document.head.appendChild(style);
  }

  function markSeen() {
    if (!userId) return;
    try { localStorage.setItem(keyFor(userId), String(Date.now())); } catch (_) {}
  }

  function clearHighlight() {
    if (activeTarget) activeTarget.classList.remove("drillgre-tour-highlight");
    activeTarget = null;
  }

  function finish() {
    clearHighlight();
    if (overlay) overlay.hidden = true;
    try { localStorage.removeItem(progressKey); } catch (_) {}
    markSeen();
  }

  function showStep() {
    ensureUI();
    const step = steps[stepIndex];
    if (normalPath(location.pathname) !== normalPath(step.path)) {
      location.href = step.path;
      return;
    }
    clearHighlight();
    const target = document.querySelector(step.selector) || document.querySelector("main") || document.body;
    activeTarget = target;
    target.classList.add("drillgre-tour-highlight");
    target.scrollIntoView({behavior:"smooth",block:"center"});
    overlay.hidden = false;
    overlay.querySelector("#drillgreTourCount").textContent = "SECTION " + (stepIndex+1) + " OF " + steps.length;
    overlay.querySelector("#drillgreTourTitle").textContent = step.title;
    overlay.querySelector("#drillgreTourDescription").textContent = step.description;
    overlay.querySelector("#drillgreTourProgress").style.width = ((stepIndex+1)/steps.length*100) + "%";
    overlay.querySelector("#drillgreTourBack").disabled = stepIndex === 0;
    overlay.querySelector("#drillgreTourNext").textContent = stepIndex === steps.length-1 ? "Finish tour" : "Next";
  }

  function persistAndGo(index) {
    stepIndex = index;
    try { localStorage.setItem(progressKey, JSON.stringify({userId,stepIndex})); } catch (_) {}
    showStep();
  }

  function next() {
    if (stepIndex >= steps.length-1) finish();
    else persistAndGo(stepIndex+1);
  }

  function previous() {
    if (stepIndex > 0) persistAndGo(stepIndex-1);
  }

  function startTour() {
    if (!userId) {
      location.href = "/account.html?tour=1";
      return;
    }
    stepIndex = 0;
    try { localStorage.setItem(progressKey, JSON.stringify({userId,stepIndex})); } catch (_) {}
    showStep();
  }

  function onAuth(user) {
    userId = user && user.id || null;
    ensureUI();
    if (!userId) return;
    let lastSeen = 0;
    let saved = null;
    try {
      lastSeen = Number(localStorage.getItem(keyFor(userId)) || 0);
      saved = JSON.parse(localStorage.getItem(progressKey) || "null");
    } catch (_) {}
    if (saved && saved.userId === userId && Number.isInteger(saved.stepIndex)) {
      stepIndex = Math.max(0,Math.min(saved.stepIndex,steps.length-1));
      showStep();
      return;
    }
    if (!lastSeen || Date.now()-lastSeen >= TOUR_GAP) {
      stepIndex = 0;
      try { localStorage.setItem(progressKey,JSON.stringify({userId,stepIndex})); } catch (_) {}
      showStep();
    }
  }

  function init() {
    ensureUI();
    if (!window.supabase || !window.supabase.createClient) return;
    const db = window.supabase.createClient("https://aayzpcfryixauwsytphd.supabase.co","sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz");
    db.auth.getSession().then(({data}) => onAuth(data && data.session && data.session.user));
    db.auth.onAuthStateChange((_event,session) => {
      if (session && session.user) onAuth(session.user);
      else userId = null;
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();