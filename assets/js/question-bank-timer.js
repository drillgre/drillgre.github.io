(() => {
  "use strict";

  const dialog = document.getElementById("questionDialog");
  const body = document.getElementById("questionDialogBody");
  const title = document.getElementById("dialogQuestionTitle");
  if (!dialog || !body || !title) return;

  let currentTitle = "";
  let elapsedMs = 0;
  let startedAt = 0;
  let running = false;
  let intervalId = null;

  function elapsed() {
    return elapsedMs + (running ? performance.now() - startedAt : 0);
  }

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return [hours, minutes, seconds].map(value => String(value).padStart(2, "0")).join(":");
  }

  function renderTime() {
    const output = body.querySelector("[data-question-timer-value]");
    if (output) output.textContent = formatTime(elapsed());
  }

  function stopTimer() {
    if (running) elapsedMs += performance.now() - startedAt;
    running = false;
    if (intervalId) window.clearInterval(intervalId);
    intervalId = null;
    renderTime();
  }

  function setRunning(enabled) {
    if (enabled && !running) {
      startedAt = performance.now();
      running = true;
      intervalId = window.setInterval(renderTime, 250);
    } else if (!enabled) {
      stopTimer();
    }
    renderTime();
  }

  function mountTimer() {
    const nextTitle = title.textContent.trim();
    if (!nextTitle || nextTitle === currentTitle || !body.querySelector(".bank-options")) return;
    currentTitle = nextTitle;
    stopTimer();
    elapsedMs = 0;

    const timer = document.createElement("div");
    timer.setAttribute("data-question-timer", "");
    timer.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:11px 13px;margin:0 0 16px;border:1px solid #dbe3f0;border-radius:10px;background:#f8faff";
    timer.innerHTML =
      '<label style="display:flex;align-items:center;gap:9px;font-size:13px;font-weight:750;color:#344158;cursor:pointer">' +
        '<input type="checkbox" data-question-timer-toggle style="width:16px;height:16px;accent-color:#3154c5">' +
        'Enable question timer' +
      '</label>' +
      '<strong data-question-timer-value style="font-variant-numeric:tabular-nums;font-size:17px;color:#26344c">00:00:00</strong>';
    body.prepend(timer);

    const toggle = timer.querySelector("[data-question-timer-toggle]");
    toggle.addEventListener("change", () => setRunning(toggle.checked));

    const checkButton = body.querySelector("#checkQuestionBankAnswer");
    if (checkButton) {
      checkButton.addEventListener("click", () => {
        stopTimer();
        toggle.checked = false;
      }, { once: false });
    }
    renderTime();
  }

  const observer = new MutationObserver(mountTimer);
  observer.observe(body, { childList: true });
  dialog.addEventListener("close", () => {
    stopTimer();
    currentTitle = "";
  });
  mountTimer();
})();
