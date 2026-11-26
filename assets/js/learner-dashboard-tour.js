(() => {
  "use strict";

  const TOUR_INTERVAL_DAYS = 30;
  const steps = [
    {
      selector: ".dash-hero",
      title: "Your learner dashboard",
      description: "This is your personal GRE preparation space. Use the quick links to continue learning, open the Question Bank or start a new mock test."
    },
    {
      selector: ".dashboard-focus-grid",
      title: "Your learning snapshot",
      description: "See your latest Quant score, vocabulary progress and other key learning indicators in one place."
    },
    {
      selector: ".quant-insights",
      title: "Understand your Quant performance",
      description: "Review topic accuracy, weekly practice trends, mock score history and the recommendations based on your recorded answers."
    },
    {
      selector: ".mistake-notebook",
      title: "Learn from mistakes",
      description: "Revisit questions you answered incorrectly, add notes, review explanations and mark concepts you have mastered."
    },
    {
      selector: "#lessonProgressText",
      title: "Track your learning progress",
      description: "Follow completed lessons, quizzes and mock tests. Scroll further down to review Word Archery, vocabulary and your assessment history."
    }
  ];

  const $ = id => document.getElementById(id);
  let currentStep = 0;
  let activeTarget = null;
  let storageKey = "";

  function markTourSeen() {
    try { localStorage.setItem(storageKey, String(Date.now())); } catch (_) {}
  }

  function clearHighlight() {
    if (activeTarget) activeTarget.classList.remove("tour-target-active");
    activeTarget = null;
  }

  function closeTour() {
    clearHighlight();
    $("dashboardTour").hidden = true;
    markTourSeen();
  }

  function showStep(index) {
    currentStep = Math.max(0, Math.min(index, steps.length - 1));
    clearHighlight();
    const step = steps[currentStep];
    const target = document.querySelector(step.selector);
    $("dashboardTourStep").textContent = "STEP " + (currentStep + 1) + " OF " + steps.length;
    $("dashboardTourTitle").textContent = step.title;
    $("dashboardTourDescription").textContent = step.description;
    $("dashboardTourProgress").style.width = ((currentStep + 1) / steps.length * 100) + "%";
    $("dashboardTourBack").disabled = currentStep === 0;
    $("dashboardTourNext").textContent = currentStep === steps.length - 1 ? "Finish" : "Next";

    if (target) {
      activeTarget = target.closest(".dash-panel,.mistake-notebook,.quant-insights,.dashboard-focus-grid,.dash-hero") || target;
      activeTarget.classList.add("tour-target-active");
      activeTarget.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function openTour() {
    if (!$("dashboardContent") || $("dashboardContent").hidden) return;
    $("dashboardTour").hidden = false;
    showStep(0);
  }

  function init() {
    const startButton = $("dashboardTourStart");
    const dialog = $("dashboardTour");
    if (!startButton || !dialog) return;

    startButton.addEventListener("click", openTour);
    $("dashboardTourNext").addEventListener("click", () => {
      if (currentStep >= steps.length - 1) closeTour();
      else showStep(currentStep + 1);
    });
    $("dashboardTourBack").addEventListener("click", () => {
      if (currentStep > 0) showStep(currentStep - 1);
    });
    $("dashboardTourSkip").addEventListener("click", closeTour);
    dialog.querySelectorAll("[data-tour-close]").forEach(el => el.addEventListener("click", closeTour));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !dialog.hidden) closeTour();
    });

    window.supabase.createClient(
      "https://aayzpcfryixauwsytphd.supabase.co",
      "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz"
    ).auth.getSession().then(({ data }) => {
      const user = data && data.session && data.session.user;
      if (!user) return;
      storageKey = "drillgre_dashboard_tour_v1_" + user.id;
      let lastSeen = 0;
      try { lastSeen = Number(localStorage.getItem(storageKey) || 0); } catch (_) {}
      const due = !lastSeen || Date.now() - lastSeen >= TOUR_INTERVAL_DAYS * 86400000;
      if (!due) return;

      const content = $("dashboardContent");
      if (!content || !content.hidden) {
        openTour();
        return;
      }
      const observer = new MutationObserver(() => {
        if (!content.hidden) {
          observer.disconnect();
          window.setTimeout(openTour, 450);
        }
      });
      observer.observe(content, { attributes: true, attributeFilter: ["hidden"] });
    }).catch(() => {});
  }

  document.addEventListener("DOMContentLoaded", init);
})();