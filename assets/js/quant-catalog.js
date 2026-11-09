(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));

  async function loadCatalog() {
    const status = $("catalogStatus");
    const grid = $("moduleGrid");

    const [modulesResult, lessonsResult] = await Promise.all([
      db.from("modules").select("id,title,slug,sort_order").order("sort_order"),
      db.from("lessons")
        .select("id,title,slug,module_id,sort_order")
        .eq("published", true)
        .order("sort_order")
    ]);

    if (modulesResult.error || lessonsResult.error) {
      const error = modulesResult.error || lessonsResult.error;
      status.textContent = "Unable to load the course: " + error.message +
        " Check the published-content access policies in Supabase.";
      return;
    }

    const modules = modulesResult.data || [];
    const lessons = lessonsResult.data || [];
    $("lessonCount").textContent = lessons.length;

    // Synchronise completed lessons to the learner account where available.
    const {data:authData} = await db.auth.getSession();
    if (authData?.session?.user) {
      const localCompleted = lessons.filter(item =>
        window.DrillGREProgress?.isDone("lesson-" + item.id)
      );
      for (const item of localCompleted) {
        await db.rpc("set_gre_lesson_progress", {p_lesson_id:item.id,p_completed:true});
      }
      const {data:remoteProgress,error:progressError} = await db.rpc("get_gre_lesson_progress");
      if (!progressError) {
        (remoteProgress || []).forEach(item =>
          window.DrillGREProgress?.markDone("lesson-" + item.lesson_id, true)
        );
      }
    }

    const visibleModules = modules
      .map(module => ({
        ...module,
        lessons: lessons
          .filter(lesson => String(lesson.module_id) === String(module.id))
          .sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      }))
      .filter(module => module.lessons.length)
      .sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

    if (!visibleModules.length) {
      status.textContent = "No published lessons are available yet. Please check back soon.";
      grid.innerHTML = '<div class="empty-state">Your published lessons will appear here.</div>';
      return;
    }

    status.textContent = visibleModules.length + " modules · " + lessons.length + " published lessons";
    grid.innerHTML = visibleModules.map((module, index) => `
      <article class="module-card">
        <div class="module-head">
          <div class="module-icon">${String(index + 1).padStart(2,"0")}</div>
          <div>
            <h3>${esc(module.title)}</h3>
            <p>${module.lessons.length} published lesson${module.lessons.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div class="module-lessons">
          ${module.lessons.map((lesson, lessonIndex) => `
            <a href="lesson.html?id=${encodeURIComponent(lesson.id)}">
              <span class="num">${String(lessonIndex + 1).padStart(2,"0")}</span>
              <span>${esc(lesson.title)}</span>
              <span class="go">→</span>
            </a>
          `).join("")}
        </div>
      </article>
    `).join("");
  }

  document.addEventListener("DOMContentLoaded", loadCatalog);
})();