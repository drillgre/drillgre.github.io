/* DrillGRE LMS progress with browser fallback and account sync */
(() => {
  "use strict";
  const KEY = "drillgre-quant-progress-v1";
  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { state = {}; }

  const write = () => {
    try { localStorage.setItem(KEY,JSON.stringify(state)); } catch {}
  };
  const emit = (id,value) => document.dispatchEvent(new CustomEvent("drillgre:progress",{detail:{id,value}}));

  const db = window.supabase?.createClient
    ? window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY)
    : null;

  async function syncFromAccount() {
    if (!db) return;
    try {
      const {data:sessionData} = await db.auth.getSession();
      if (!sessionData?.session?.user) return;
      const {data,error} = await db.rpc("get_gre_lesson_progress");
      if (error) return; // The migration may not yet have been run.
      const remote = {};
      (Array.isArray(data) ? data : []).forEach(row => {
        if (row.lesson_id) remote["lesson-" + row.lesson_id] = true;
      });
      // Carry locally completed guest lessons into the learner's account once signed in.
      const localOnly = Object.keys(state).filter(key =>
        key.startsWith("lesson-") && state[key] && !remote[key]
      );
      for (const key of localOnly) {
        const lessonId = key.slice("lesson-".length);
        if (/^[0-9a-f-]{36}$/i.test(lessonId)) {
          const {error:syncError} = await db.rpc("set_gre_lesson_progress",{
            p_lesson_id:lessonId,p_completed:true
          });
          if (!syncError) remote[key] = true;
        }
      }
      state = {...state,...remote};
      write();
      document.querySelectorAll("[data-progress-id]").forEach(el => {
        const id = el.dataset.progressId;
        el.classList.toggle("completed",!!state[id]);
        const check = el.querySelector(".check");
        if (check) check.textContent = state[id] ? "✓" : "";
      });
      document.dispatchEvent(new Event("drillgre:progress"));
    } catch (_) {
      // Local progress remains available when the network or account is unavailable.
    }
  }

  async function saveToAccount(id,value) {
    if (!db || !String(id).startsWith("lesson-")) return;
    const lessonId = String(id).slice("lesson-".length);
    if (!/^[0-9a-f-]{36}$/i.test(lessonId)) return;
    try {
      const {data:sessionData} = await db.auth.getSession();
      if (!sessionData?.session?.user) return;
      await db.rpc("set_gre_lesson_progress",{
        p_lesson_id:lessonId,
        p_completed:!!value
      });
    } catch (_) {
      // Keep the local copy; a later account sync can reconcile it.
    }
  }

  window.DrillGREProgress = {
    isDone:id => !!state[id],
    markDone:(id,value=true) => {
      state[id] = !!value;
      write();
      emit(id,!!value);
      saveToAccount(id,!!value);
    },
    reset:() => {
      state = {};
      write();
      document.dispatchEvent(new Event("drillgre:progress"));
    },
    count:() => Object.values(state).filter(Boolean).length,
    syncFromAccount
  };

  document.addEventListener("DOMContentLoaded",() => {
    document.querySelectorAll("[data-progress-id]").forEach(el => {
      const id = el.dataset.progressId;
      if (window.DrillGREProgress.isDone(id)) {
        el.classList.add("completed");
        const check = el.querySelector(".check");
        if (check) check.textContent = "✓";
      }
    });

    document.querySelectorAll("[data-mark-complete]").forEach(btn => {
      const id = btn.dataset.markComplete;
      const sync = () => {
        const done = window.DrillGREProgress.isDone(id);
        btn.textContent = done ? "✓ Lesson completed" : "Mark lesson complete";
        btn.classList.toggle("primary",!done);
      };
      sync();
      btn.addEventListener("click",() => {
        window.DrillGREProgress.markDone(id,!window.DrillGREProgress.isDone(id));
        sync();
      });
    });

    document.querySelectorAll("[data-course-progress]").forEach(el => {
      const ids = (el.dataset.courseProgress || "").split(",").filter(Boolean);
      const update = () => {
        const n = ids.filter(id => window.DrillGREProgress.isDone(id)).length;
        el.textContent = n + " of " + ids.length + " lessons completed";
        const bar = document.querySelector(el.dataset.barTarget);
        if (bar) bar.style.width = (ids.length ? 100*n/ids.length : 0) + "%";
      };
      update();
      document.addEventListener("drillgre:progress",update);
    });

    syncFromAccount();
  });
})();