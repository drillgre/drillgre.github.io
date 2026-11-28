
// ============================================================
// DrillGRE Admin
// Supabase configuration
// ============================================================

const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);

let user = null;
let lessonsCache = [];
let figureUrl = null;
let figurePath = null;
let stimulusFigureUrl = null;
let stimulusGroupsCache = [];
let vocabCache = [];
let vocabImportRows = [];
let vocabImportFileName = "";

const typeNames = {
  quantitative_comparison: "Quantitative Comparison",
  multiple_choice_single: "Multiple Choice: Single Answer",
  multiple_choice_multiple: "Multiple Choice: Multiple Answers",
  numeric_entry: "Numeric Entry",
  data_interpretation: "Data Interpretation"
};

// Standard GRE Quant taxonomy. Use these exact IDs in CSV imports.
const categorySubtopics = {
  arithmetic: [
    ["number_properties", "Number properties"],
    ["divisibility_factors_multiples", "Divisibility, factors and multiples"],
    ["fractions_decimals", "Fractions and decimals"],
    ["ratios_proportions", "Ratios and proportions"],
    ["percentages", "Percentages"],
    ["exponents_roots", "Exponents and roots"],
    ["absolute_value", "Absolute value"]
  ],
  algebra: [
    ["algebraic_expressions", "Algebraic expressions"],
    ["linear_equations", "Linear equations"],
    ["systems_of_equations", "Systems of equations"],
    ["quadratic_equations", "Quadratic equations"],
    ["inequalities", "Inequalities"],
    ["functions", "Functions"],
    ["sequences_series", "Sequences and series"],
    ["word_problems", "Algebraic word problems"]
  ],
  geometry: [
    ["lines_angles", "Lines and angles"],
    ["triangles", "Triangles"],
    ["quadrilaterals_polygons", "Quadrilaterals and polygons"],
    ["circles", "Circles"],
    ["coordinate_geometry", "Coordinate geometry"],
    ["area_perimeter", "Area and perimeter"],
    ["solid_geometry", "Three-dimensional geometry"]
  ],
  data_analysis: [
    ["data_interpretation", "Data interpretation"],
    ["descriptive_statistics", "Descriptive statistics"],
    ["probability", "Probability"],
    ["combinatorics", "Combinatorics"],
    ["sets_venn_diagrams", "Sets and Venn diagrams"],
    ["statistical_distributions", "Statistical distributions"]
  ]
};
const categoryLabels = {
  arithmetic: "Arithmetic",
  algebra: "Algebra",
  geometry: "Geometry",
  data_analysis: "Data Analysis"
};

// Accept either canonical subtopic IDs or their display labels in CSV files.
// The legacy "counting" value is mapped to the standard "combinatorics" ID.
function normalizeImportSubtopic(category, value) {
  const raw = importText(value).toLowerCase();
  const options = categorySubtopics[category] || [];
  const match = options.find(([id, label]) =>
    id === raw || label.toLowerCase() === raw
  );
  if (match) return match[0];
  if (category === "data_analysis" && raw === "counting") return "combinatorics";
  return raw.replace(/[\s-]+/g, "_");
}

const slug = s =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

function showAdminDialog({ title = "Information", message = "", confirmText = "Okay", showCancel = false } = {}) {
  const dialog = $("adminConfirmDialog");
  if (!dialog) {
    if (showCancel) return Promise.resolve(window.confirm(message));
    window.alert(message);
    return Promise.resolve(true);
  }
  $("adminConfirmTitle").textContent = title;
  $("adminConfirmMessage").textContent = message;
  $("adminConfirmAccept").textContent = confirmText;
  $("adminConfirmCancel").hidden = !showCancel;
  $("adminConfirmClose").hidden = !showCancel;
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      $("adminConfirmAccept").removeEventListener("click", accept);
      $("adminConfirmCancel").removeEventListener("click", cancel);
      $("adminConfirmClose").removeEventListener("click", cancel);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const accept = () => finish(true);
    const cancel = () => finish(false);
    const onCancel = event => { event.preventDefault(); finish(false); };
    const onClose = () => finish(false);
    $("adminConfirmAccept").addEventListener("click", accept);
    $("adminConfirmCancel").addEventListener("click", cancel);
    $("adminConfirmClose").addEventListener("click", cancel);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}
function showAdminConfirm({ title = "Confirm action", message = "Are you sure you want to continue?", confirmText = "Confirm" } = {}) {
  return showAdminDialog({ title, message, confirmText, showCancel: true });
}
function showAdminNotice(message, title = "Notice") {
  return showAdminDialog({ title, message: String(message ?? ""), confirmText: "Okay", showCancel: false });
}

const FIGURE_EXTENSIONS = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif"
});

function validateFigureFile(file, messageId, inputId) {
  if (!Object.prototype.hasOwnProperty.call(FIGURE_EXTENSIONS, file.type)) {
    message(messageId, "Use a PNG, JPEG, WebP, or GIF image. SVG and other file types are not accepted.");
    $(inputId).value = "";
    return null;
  }
  if (file.size > 5 * 1024 * 1024) {
    message(messageId, "The image must be smaller than 5 MB.");
    $(inputId).value = "";
    return null;
  }
  return FIGURE_EXTENSIONS[file.type];
}

function message(id, text, success = false) {
  const el = $(id);
  if (!el) return;

  el.textContent = text;
  el.style.color = success ? "#147d54" : "#b42318";
}


// ============================================================
// YouTube URL handling
// ============================================================

function getYouTubeEmbedUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url.trim());
    const hostname = parsed.hostname.toLowerCase();

    let videoId = "";

    if (hostname === "youtu.be" || hostname.endsWith(".youtu.be")) {
      videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
    }

    else if (
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com") ||
      hostname === "youtube-nocookie.com" ||
      hostname.endsWith(".youtube-nocookie.com")
    ) {
      if (parsed.pathname === "/watch") {
        videoId = parsed.searchParams.get("v") || "";
      }

      else if (parsed.pathname.startsWith("/embed/")) {
        videoId = parsed.pathname.split("/embed/")[1].split("/")[0];
      }

      else if (parsed.pathname.startsWith("/shorts/")) {
        videoId = parsed.pathname.split("/shorts/")[1].split("/")[0];
      }
    }

    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return null;
    }

    return `https://www.youtube-nocookie.com/embed/${videoId}`;

  } catch {
    return null;
  }
}


// ============================================================
// Explanation format controls
// ============================================================

function updateExplanationFields() {
  const type = $("explanationType").value;

  $("textExplanationField").hidden = type === "video";
  $("videoExplanationField").hidden = type === "text";

  $("explanation").required =
    type === "text" || type === "both";

  $("explanationVideo").required =
    type === "video" || type === "both";
}

$("explanationType").addEventListener(
  "change",
  updateExplanationFields
);


// ============================================================
// Authentication
// ============================================================

async function adminCheck(u) {
  const { data, error } = await db
    .from("profiles")
    .select("role")
    .eq("id", u.id)
    .single();

  if (error || data?.role !== "admin") {
    throw Error("This account does not have the DrillGRE admin role.");
  }
}

async function enter(u) {
  user = u;

  try {
    await adminCheck(u);
  } catch (e) {
    await db.auth.signOut();

    $("login").hidden = false;
    $("dashboard").hidden = true;

    message("loginMsg", e.message);
    return;
  }

  $("login").hidden = true;
  $("dashboard").hidden = false;
  const { data: adminProfile } = await db
    .from("profiles")
    .select("name")
    .eq("id", u.id)
    .maybeSingle();
  const adminFirstName = String(adminProfile?.name || u.user_metadata?.name || u.email || "Admin").trim().split(/\s+/)[0];
  $("who").textContent = adminFirstName + " · Admin workspace";

  await Promise.all([
    loadLessons(),
    loadQuestions(),
    loadLessonOptions(),
    loadStimulusGroups(),
    loadVocabWords()
  ]);
}

$("loginForm").onsubmit = async e => {
  e.preventDefault();

  message("loginMsg", "Signing in…");

  const { data, error } = await db.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });

  if (error) {
    message("loginMsg", error.message);
  } else {
    await enter(data.user);
  }
};

$("logout").onclick = async () => {
  const button = $("logout");
  button.disabled = true;
  button.textContent = "Signing out…";
  try {
    const { error } = await db.auth.signOut({ scope: "local" });
    if (error) throw error;
    window.location.replace("/");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Sign out";
    message("loginMsg", "Sign out failed. Please try again. " + (error.message || ""));
  }
};

(async () => {
  const { data } = await db.auth.getSession();

  if (data.session) {
    await enter(data.session.user);
  }
})();


// ============================================================
// Lessons
// ============================================================

function escapeLessonHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

// Convert legacy Markdown lesson content to safe, editable HTML.
function legacyMarkdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const out = [];
  let listType = null;

  const closeList = () => {
    if (listType) out.push(listType === "ul" ? "</ul>" : "</ol>");
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${escapeLessonHtml(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      const wanted = bullet ? "ul" : "ol";
      if (listType !== wanted) {
        closeList();
        out.push(wanted === "ul" ? "<ul>" : "<ol>");
        listType = wanted;
      }
      out.push(`<li>${escapeLessonHtml((bullet || numbered)[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${escapeLessonHtml(line)}</p>`);
  }

  closeList();
  return out.join("") || "<p></p>";
}

function setLessonEditorContent(content) {
  let html = "";
  if (content && typeof content === "object" && typeof content.html === "string") {
    html = content.html;
  } else if (content && typeof content === "object" && typeof content.markdown === "string") {
    html = legacyMarkdownToHtml(content.markdown);
  } else if (typeof content === "string") {
    html = legacyMarkdownToHtml(content);
  }
  $("lessonSource").value = html;
}

function updateLessonVideoPreview() {
  const input = $("lessonVideo").value.trim();
  const embedUrl = input ? getYouTubeEmbedUrl(input) : "";

  if (!input) {
    $("lessonVideoPreview").innerHTML = "";
    return;
  }

  if (!embedUrl) {
    $("lessonVideoPreview").innerHTML =
      '<p class="field-note">Enter a valid YouTube video URL to preview it.</p>';
    return;
  }

  $("lessonVideoPreview").innerHTML = `
    <div class="lesson-video-preview-wrap">
      <iframe
        class="lesson-video-preview"
        src="${esc(embedUrl)}"
        title="Lesson teaching video preview"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen></iframe>
    </div>
  `;
}

async function loadLessons() {
  const { data, error } = await db
    .from("lessons")
    .select("id,title,slug,module_id,sort_order,published,content,modules(id,title,slug)")
    .order("sort_order");

  if (error) {
    $("lessonList").textContent = error.message;
    return;
  }

  lessonsCache = data || [];

  // Group lessons by their parent module/topic instead of mixing all lessons
  // into one global list. Keep the existing lesson-level actions unchanged.
  const lessonGroups = new Map();
  lessonsCache.forEach(lesson => {
    const groupId = String(lesson.module_id || "unassigned");
    if (!lessonGroups.has(groupId)) {
      lessonGroups.set(groupId, {
        title: lesson.modules?.title || "Unassigned topic",
        lessons: []
      });
    }
    lessonGroups.get(groupId).lessons.push(lesson);
  });

  const sortedGroups = [...lessonGroups.entries()].sort((a, b) =>
    a[1].title.localeCompare(b[1].title)
  );

  $("lessonList").innerHTML = lessonsCache.length
    ? `
      <div class="panel" style="padding:12px 14px;margin:0 0 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin:0">
          <input type="checkbox" id="selectAllLessons" style="width:17px;height:17px">
          Select all lessons
        </label>
        <span id="selectedLessonCount" class="meta">0 selected</span>
        <button type="button" class="del" id="bulkDeleteLessons" disabled>Delete selected</button>
      </div>
      ` + sortedGroups.map(([groupId, group]) => {
        const publishedCount = group.lessons.filter(lesson => lesson.published).length;
        const draftCount = group.lessons.length - publishedCount;
        const lessonCards = group.lessons
          .slice()
          .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) ||
            String(a.title).localeCompare(String(b.title)))
          .map(l => `
            <div class="entry">
              <label style="display:flex;align-items:center;gap:10px;min-width:0;margin:0">
                <input type="checkbox" class="lesson-select" data-lesson-select="${esc(l.id)}" aria-label="Select ${esc(l.title)}" style="width:17px;height:17px;flex:0 0 auto">
                <span style="min-width:0">
                  <strong>${esc(l.title)}</strong>
                <div class="meta">
                  ${l.published ? "Published" : "Draft"}
                  · order ${l.sort_order}
                  ${l.content?.video_url ? " · YouTube video" : ""}
                </div>
                </span>
              </label>
              <div class="buttons">
                <button type="button" data-view="${l.id}">View</button>
                <button type="button" data-edit="${l.id}">Edit</button>
                <button type="button" data-pub="${l.id}">
                  ${l.published ? "Unpublish" : "Publish"}
                </button>
                <button type="button" class="del" data-del="${l.id}">Delete</button>
              </div>
            </div>
          `).join("");

        return `
          <section class="lesson-topic-group" data-topic-group="${esc(groupId)}" style="margin:0 0 26px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 16px;margin-bottom:10px;background:#eef3ff;border:1px solid #dbe5ff;border-radius:12px">
              <strong style="font-size:16px;color:#173b78">${esc(group.title)}</strong>
              <span class="meta">${group.lessons.length} lessons · ${publishedCount} published · ${draftCount} drafts</span>
            </div>
            <div class="lesson-topic-items">${lessonCards}</div>
          </section>
        `;
      }).join("")
    : "<p>No lessons yet. Create your first lesson.</p>";

  const lessonSelectBoxes = [...$("lessonList").querySelectorAll("[data-lesson-select]")];
  const selectAllLessons = $("selectAllLessons");
  const bulkDeleteLessons = $("bulkDeleteLessons");
  const selectedLessonCount = $("selectedLessonCount");
  const refreshLessonSelection = () => {
    const selected = lessonSelectBoxes.filter(box => box.checked).length;
    selectedLessonCount.textContent = selected + " selected";
    bulkDeleteLessons.disabled = selected === 0;
    selectAllLessons.checked = selected > 0 && selected === lessonSelectBoxes.length;
    selectAllLessons.indeterminate = selected > 0 && selected < lessonSelectBoxes.length;
  };
  lessonSelectBoxes.forEach(box => box.addEventListener("change", refreshLessonSelection));
  selectAllLessons.addEventListener("change", () => {
    lessonSelectBoxes.forEach(box => { box.checked = selectAllLessons.checked; });
    refreshLessonSelection();
  });
  bulkDeleteLessons.addEventListener("click", deleteSelectedLessons);
  refreshLessonSelection();

  $("lessonList").querySelectorAll("[data-view]").forEach(button => {
    button.onclick = () => {
      const lesson = lessonsCache.find(item => String(item.id) === String(button.dataset.view));
      if (lesson) window.open("/quant/lesson.html?slug=" + encodeURIComponent(lesson.slug) + "&admin=1", "_blank", "noopener");
    };
  });
  $("lessonList").querySelectorAll("[data-edit]").forEach(button => {
    button.onclick = () => editLesson(button.dataset.edit);
  });
  $("lessonList").querySelectorAll("[data-pub]").forEach(button => {
    button.onclick = () => toggleLesson(button.dataset.pub);
  });
  $("lessonList").querySelectorAll("[data-del]").forEach(button => {
    button.onclick = () => deleteLesson(button.dataset.del);
  });
}

async function loadLessonOptions() {
  const { data, error } = await db
    .from("lessons")
    .select("id,title")
    .order("title");

  if (error) return;

  $("linkedLesson").innerHTML =
    '<option value="">None</option>' +
    (data || []).map(l =>
      `<option value="${esc(l.id)}">${esc(l.title)}</option>`
    ).join("");
}

$("newLesson").onclick = () => {
  $("lessonForm").reset();
  $("lessonId").value = "";
  $("lessonFormTitle").textContent = "New lesson";
  $("order").value = 0;
  $("moduleSlug").dataset.manual = "";
  $("slug").dataset.manual = "";
  $("lessonVideoPreview").innerHTML = "";
  setLessonEditorContent({ html: "<p></p>" });
  message("lessonMsg", "");
  $("lessonDialog").showModal();
};

$("moduleTitle").oninput = () => {
  if (!$("moduleSlug").dataset.manual) {
    $("moduleSlug").value = slug($("moduleTitle").value);
  }
};
$("moduleSlug").oninput = () => { $("moduleSlug").dataset.manual = "1"; };

$("title").oninput = () => {
  if (!$("slug").dataset.manual) {
    $("slug").value = slug($("title").value);
  }
};
$("slug").oninput = () => { $("slug").dataset.manual = "1"; };

$("lessonVideo").addEventListener("input", updateLessonVideoPreview);

async function editLesson(id) {
  const { data, error } = await db
    .from("lessons")
    .select("*,modules(*)")
    .eq("id", id)
    .single();

  if (error) {
    showAdminNotice(error.message);
    return;
  }

  $("lessonId").value = data.id;
  $("moduleTitle").value = data.modules?.title || "";
  $("moduleSlug").value = data.modules?.slug || "";
  $("title").value = data.title || "";
  $("slug").value = data.slug || "";
  $("order").value = data.sort_order ?? 0;
  $("lessonPublished").checked = !!data.published;
  $("lessonVideo").value = data.content?.video_url || "";
  $("lessonFormTitle").textContent = "Edit lesson";

  setLessonEditorContent(data.content);
  updateLessonVideoPreview();
  message("lessonMsg", "");
  $("lessonDialog").showModal();
}

$("lessonForm").onsubmit = async e => {
  e.preventDefault();
  message("lessonMsg", "Saving…");

  const moduleTitle = $("moduleTitle").value.trim();
  const moduleSlug = slug($("moduleSlug").value);
  const lessonTitle = $("title").value.trim();
  const lessonSlug = slug($("slug").value);
  const videoInput = $("lessonVideo").value.trim();
  const videoUrl = videoInput ? getYouTubeEmbedUrl(videoInput) : null;

  if (!moduleTitle || !moduleSlug || !lessonTitle || !lessonSlug) {
    message("lessonMsg", "Complete the module and lesson titles.");
    return;
  }
  if (videoInput && !videoUrl) {
    message("lessonMsg", "Please enter a valid YouTube URL.");
    return;
  }

  const html = $("lessonSource").value;
  const textContent = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
  if (!textContent) {
    message("lessonMsg", "Please write some lesson content before saving.");
    return;
  }

  let { data: mod, error } = await db
    .from("modules")
    .select("id")
    .eq("slug", moduleSlug)
    .maybeSingle();

  if (error) {
    message("lessonMsg", error.message);
    return;
  }

  if (!mod) {
    const result = await db
      .from("modules")
      .insert({
        title: moduleTitle,
        slug: moduleSlug,
        sort_order: +$("order").value || 0,
        published: $("lessonPublished").checked
      })
      .select("id")
      .single();

    if (result.error) {
      message("lessonMsg", result.error.message);
      return;
    }
    mod = result.data;
  } else {
    const result = await db
      .from("modules")
      .update({
        title: moduleTitle,
        sort_order: +$("order").value || 0
      })
      .eq("id", mod.id);

    if (result.error) {
      message("lessonMsg", result.error.message);
      return;
    }
  }

  const body = {
    module_id: mod.id,
    title: lessonTitle,
    slug: lessonSlug,
    sort_order: +$("order").value || 0,
    published: $("lessonPublished").checked,
    content: {
      html,
      video_url: videoUrl
    },
    updated_at: new Date().toISOString()
  };

  const id = $("lessonId").value;
  const result = id
    ? await db.from("lessons").update(body).eq("id", id)
    : await db.from("lessons").insert(body);

  if (result.error) {
    message("lessonMsg", result.error.message);
    return;
  }

  $("lessonDialog").close();
  await loadLessons();
  await loadLessonOptions();
};

async function toggleLesson(id) {
  const lesson = lessonsCache.find(x => String(x.id) === String(id));
  if (!lesson) return;

  const result = await db
    .from("lessons")
    .update({
      published: !lesson.published,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (result.error) showAdminNotice(result.error.message);
  else await loadLessons();
}

async function deleteSelectedLessons() {
  const selectedIds = [...$("lessonList").querySelectorAll("[data-lesson-select]:checked")]
    .map(box => box.dataset.lessonSelect);
  if (!selectedIds.length) return;
  if (!await showAdminConfirm({
    title: "Delete selected lessons",
    message: "Permanently delete " + selectedIds.length + " selected lesson(s)? This action cannot be undone.",
    confirmText: "Delete lessons"
  })) return;

  const button = $("bulkDeleteLessons");
  button.disabled = true;
  button.textContent = "Deleting…";
  const failures = [];
  let deleted = 0;
  for (const id of selectedIds) {
    const lesson = lessonsCache.find(item => String(item.id) === String(id));
    const result = await db.from("lessons").delete().eq("id", id);
    if (result.error) failures.push((lesson?.title || id) + ": " + result.error.message);
    else deleted++;
  }
  await Promise.all([loadLessons(), loadLessonOptions()]);
  if (failures.length) {
    showAdminNotice(
      deleted + " lesson(s) deleted. " + failures.length + " could not be deleted:\n" +
      failures.join("\n"),
      "Bulk deletion partially completed"
    );
  } else {
    showAdminNotice(deleted + " lesson(s) deleted successfully.", "Lessons deleted");
  }
}

async function deleteLesson(id) {
  if (!await showAdminConfirm({ title: "Delete lesson", message: "Are you sure you want to delete this lesson? This action cannot be undone.", confirmText: "Delete" })) return;

  const result = await db
    .from("lessons")
    .delete()
    .eq("id", id);

  if (result.error) showAdminNotice(result.error.message);
  else {
    await loadLessons();
    await loadLessonOptions();
  }
}


// ============================================================
// Question option helpers
// ============================================================

function parseOptions(raw) {
  if (Array.isArray(raw)) {
    return raw.map((x, i) =>
      typeof x === "string"
        ? {
            label: String.fromCharCode(65 + i),
            text: x
          }
        : x
    );
  }

  if (typeof raw === "string") {
    try {
      return parseOptions(JSON.parse(raw));
    } catch {
      return raw
        .split("\n")
        .filter(Boolean)
        .map((text, i) => ({
          label: String.fromCharCode(65 + i),
          text
        }));
    }
  }

  return [];
}

function answerString(raw) {
  if (Array.isArray(raw)) return raw;

  if (raw && typeof raw === "object") {
    return raw.answer ?? raw.value ?? raw.selected ?? "";
  }

  return raw ?? "";
}

function optionRow(o, i) {
  const label = o.label || String.fromCharCode(65 + i);

  return `
    <div class="option-row">
      <span class="option-label">${esc(label)}.</span>

      <input
        class="option-text"
        aria-label="Option ${esc(label)}"
        value="${esc(o.text ?? "")}"
        placeholder="Enter option ${esc(label)}">

      <button
        type="button"
        class="secondary remove-option"
        data-remove-option>
        Remove
      </button>
    </div>
  `;
}

function collectOptions() {
  return [
    ...document.querySelectorAll("#optionRows .option-row")
  ].map((row, i) => ({
    label: String.fromCharCode(65 + i),
    text: row.querySelector(".option-text").value.trim()
  })).filter(o => o.text);
}

function renumberOptions() {
  document.querySelectorAll("#optionRows .option-row")
    .forEach((row, i) => {
      row.querySelector(".option-label").textContent =
        String.fromCharCode(65 + i) + ".";
    });
}

function syncCorrectChoices() {
  const type = $("qType").value;
  const multiple = type === "multiple_choice_multiple";

  const prior = [
    ...document.querySelectorAll("#correctChoices input:checked")
  ].map(x => x.value);

  const options = collectOptions();

  $("correctChoices").innerHTML = options.map(o => `
    <label class="choice">
      <input
        type="${multiple ? "checkbox" : "radio"}"
        name="dynamicAnswer"
        value="${esc(o.label)}"
        ${prior.includes(o.label) ? "checked" : ""}
        ${!multiple ? "required" : ""}>

      <span>
        <b>${esc(o.label)}.</b> ${esc(o.text)}
      </span>
    </label>
  `).join("");
}


// ============================================================
// Dynamic question fields
// ============================================================

function renderDynamicFields(
  existingOptions = [],
  existingAnswer = "",
  extra = {}
) {
  const type = $("qType").value;

  const opts = parseOptions(existingOptions);
  const ans = answerString(existingAnswer);

  const answerList = Array.isArray(ans)
    ? ans.map(String)
    : String(ans).split(",").map(s => s.trim()).filter(Boolean);

  let html = "";

  if (type === "quantitative_comparison") {
    const qa = extra.quantity_a ?? opts[0]?.text ?? "";
    const qb = extra.quantity_b ?? opts[1]?.text ?? "";

    html = `
      <div class="dynamic-card">
        <h3>Quantitative Comparison</h3>

        <label>Quantity A</label>
        <textarea id="quantityA" rows="2">${esc(qa)}</textarea>

        <label>Quantity B</label>
        <textarea id="quantityB" rows="2">${esc(qb)}</textarea>

        <label>Correct answer</label>

        <div class="answer-choices">
          ${[
            ["A", "Quantity A is greater"],
            ["B", "Quantity B is greater"],
            ["C", "The two quantities are equal"],
            ["D", "The relationship cannot be determined"]
          ].map(([v, t]) => `
            <label class="choice">
              <input
                type="radio"
                name="dynamicAnswer"
                value="${v}"
                ${String(ans) === v ? "checked" : ""}
                required>

              <span><b>${v}.</b> ${t}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `;

  } else if (type === "numeric_entry") {
    const numeric = extra.numeric_answer ??
      (typeof ans === "object" ? ans.value : ans) ?? "";

    const tolerance = extra.tolerance ?? "";

    html = `
      <div class="dynamic-card">
        <h3>Numeric Entry</h3>

        <label>Correct numerical answer</label>
        <input
          id="numericAnswer"
          type="text"
          inputmode="decimal"
          value="${esc(numeric)}"
          placeholder="e.g. 12.5"
          required>

        <label>Optional tolerance</label>
        <input
          id="numericTolerance"
          type="number"
          min="0"
          step="any"
          value="${esc(tolerance)}"
          placeholder="e.g. 0.01">

        <p class="field-note">
          Tolerance allows answers close to the correct value to be accepted.
        </p>
      </div>
    `;

  } else {
    const multiple = type === "multiple_choice_multiple";

    const defaultOptions = opts.length
      ? opts
      : [
          { label: "A", text: "" },
          { label: "B", text: "" },
          { label: "C", text: "" },
          { label: "D", text: "" }
        ];

    html = `
      <div class="dynamic-card">
        <h3>Answer options</h3>

        <p class="field-note">
          For a linked Data Interpretation set, create a shared stimulus above
          and associate all three questions with the same group.
        </p>

        <div id="optionRows">
          ${defaultOptions.map((o, i) => optionRow(o, i)).join("")}
        </div>

        <button
          type="button"
          class="secondary add-option"
          id="addOption">
          + Add option
        </button>

        <label>Correct answer${multiple ? "s" : ""}</label>

        <div class="answer-choices" id="correctChoices">
          ${defaultOptions.map((o, i) => {
            const v = o.label || String.fromCharCode(65 + i);

            return `
              <label class="choice">
                <input
                  type="${multiple ? "checkbox" : "radio"}"
                  name="dynamicAnswer"
                  value="${esc(v)}"
                  ${answerList.includes(v) ? "checked" : ""}
                  ${!multiple ? "required" : ""}>

                <span>
                  <b>${esc(v)}.</b>
                  ${esc(o.text || "Option " + v)}
                </span>
              </label>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  $("dynamicFields").innerHTML = html;

  if (
    type !== "quantitative_comparison" &&
    type !== "numeric_entry"
  ) {
    $("addOption")?.addEventListener("click", () => {
      const rows = $("optionRows");
      const n = rows.querySelectorAll(".option-row").length;

      const row = document.createElement("div");

      row.innerHTML = optionRow({
        label: String.fromCharCode(65 + n),
        text: ""
      }, n);

      rows.appendChild(row.firstElementChild);

      syncCorrectChoices();
    });

    $("optionRows")?.addEventListener("input", syncCorrectChoices);

    $("optionRows")?.addEventListener("click", e => {
      if (e.target.matches("[data-remove-option]")) {
        e.preventDefault();

        e.target.closest(".option-row").remove();

        renumberOptions();
        syncCorrectChoices();
      }
    });
  }
}

$("qType").addEventListener("change", () => {
  renderDynamicFields();
});


// ============================================================
// GRE topic classification and shared Data Analysis stimuli
// ============================================================

function fillSubtopicOptions(selected = "") {
  const category = $("topicCategory").value;
  const options = categorySubtopics[category] || [];
  $("subtopic").innerHTML = options.map(([value,label]) =>
    `<option value="${value}">${label}</option>`
  ).join("");
  if (selected && options.some(([value]) => value === selected)) {
    $("subtopic").value = selected;
  }
}

function updateStimulusPanel() {
  const isDataAnalysis = $("topicCategory").value === "data_analysis";
  $("stimulusPanel").hidden = !isDataAnalysis;
  if (!isDataAnalysis) {
    $("stimulusGroup").value = "";
    $("stimulusEditor").hidden = true;
    renderSelectedStimulusPreview();
  }
}

function renderSelectedStimulusPreview() {
  const id = $("stimulusGroup").value;
  const group = stimulusGroupsCache.find(item => item.id === id);
  const target = $("stimulusSelectedPreview");
  if (!target || !group) {
    if (target) target.innerHTML = "";
    return;
  }
  target.innerHTML = `
    <div class="field-note"><b>${esc(group.title)}</b></div>
    ${group.stimulus_text ? `<p>${esc(group.stimulus_text)}</p>` : ""}
    ${group.figure_url ? `<img src="${esc(group.figure_url)}" alt="Shared stimulus figure preview">` : ""}
  `;
}

async function loadStimulusGroups(selectedId = "") {
  const select = $("stimulusGroup");
  if (!select) return;

  const [groupsResult, linksResult] = await Promise.all([
    db.from("question_stimuli")
      .select("id,title,stimulus_text,figure_url")
      .order("created_at", { ascending: false }),
    db.from("questions").select("stimulus_id,published").not("stimulus_id", "is", null)
  ]);

  if (groupsResult.error) {
    select.innerHTML = '<option value="">No shared stimulus (standalone question)</option>';
    message("stimulusMsg", groupsResult.error.message);
    return;
  }

  const counts = {};
  const publishedCounts = {};
  (linksResult.data || []).forEach(row => {
    if (row.stimulus_id) {
      counts[row.stimulus_id] = (counts[row.stimulus_id] || 0) + 1;
      if (row.published) publishedCounts[row.stimulus_id] = (publishedCounts[row.stimulus_id] || 0) + 1;
    }
  });

  stimulusGroupsCache = groupsResult.data || [];
  select.innerHTML = '<option value="">No shared stimulus (standalone question)</option>' +
    stimulusGroupsCache.map(group => {
      const count = counts[group.id] || 0;
      return `<option value="${esc(group.id)}">${esc(group.title)} · ${count}/3 linked, ${publishedCounts[group.id] || 0}/3 published</option>`;
    }).join("");

  if (selectedId) select.value = selectedId;
  renderSelectedStimulusPreview();
}

$("stimulusGroup").addEventListener("change", renderSelectedStimulusPreview);

$("topicCategory").addEventListener("change", () => {
  fillSubtopicOptions();
  updateStimulusPanel();
});

$("newStimulusGroup").addEventListener("click", () => {
  $("stimulusTitle").value = "";
  $("stimulusText").value = "";
  $("stimulusFigure").value = "";
  $("stimulusFigurePreview").innerHTML = "";
  stimulusFigureUrl = null;
  $("stimulusEditor").hidden = false;
  message("stimulusMsg", "");
});

$("stimulusFigure").addEventListener("change", async () => {
  const file = $("stimulusFigure").files[0];
  if (!file) return;

  const ext = validateFigureFile(file, "stimulusMsg", "stimulusFigure");
  if (!ext) return;

  $("stimulusFigurePreview").textContent = "Uploading shared figure…";
  const path = `${user.id}/stimulus-${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from("question-figures").upload(path, file, {
    contentType: file.type
  });

  if (error) {
    message("stimulusMsg", "Upload failed: " + error.message);
    return;
  }

  const { data } = db.storage.from("question-figures").getPublicUrl(path);
  stimulusFigureUrl = data.publicUrl;
  $("stimulusFigurePreview").innerHTML =
    `<img src="${esc(stimulusFigureUrl)}" alt="Shared stimulus preview">`;
});

$("saveStimulusGroup").addEventListener("click", async () => {
  const title = $("stimulusTitle").value.trim();
  const stimulusText = $("stimulusText").value.trim();
  if (!title || (!stimulusText && !stimulusFigureUrl)) {
    message("stimulusMsg", "Enter a title and provide shared instructions or a figure.");
    return;
  }

  $("saveStimulusGroup").disabled = true;
  message("stimulusMsg", "Saving shared stimulus…");
  const { data, error } = await db.from("question_stimuli").insert({
    title,
    stimulus_text: stimulusText,
    figure_url: stimulusFigureUrl
  }).select("id").single();
  $("saveStimulusGroup").disabled = false;

  if (error) {
    message("stimulusMsg", error.message);
    return;
  }

  await loadStimulusGroups(data.id);
  $("stimulusEditor").hidden = true;
  message("stimulusMsg", "Stimulus saved. Link three Data Analysis questions to this group.", true);
});

// ============================================================
// New question
// ============================================================

$("newQuestion").onclick = async () => {
  $("questionForm").reset();

  $("questionId").value = "";

  $("topicCategory").value = "arithmetic";
  $("questionUsage").value = "both";
  fillSubtopicOptions("number_properties");
  updateStimulusPanel();
  await loadStimulusGroups();
  $("stimulusGroup").value = "";
  $("stimulusEditor").hidden = true;
  stimulusFigureUrl = null;

  figureUrl = null;
  figurePath = null;

  $("preview").innerHTML = "";

  $("questionFormTitle").textContent = "New question";

  message("questionMsg", "");

  updateExplanationFields();
  renderDynamicFields();

  $("questionDialog").showModal();
};


// ============================================================
// Figure upload
// ============================================================

$("figure").onchange = async () => {
  const file = $("figure").files[0];

  if (!file) return;

  const ext = validateFigureFile(file, "questionMsg", "figure");
  if (!ext) return;

  $("preview").textContent = "Uploading…";

  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

  const { error } = await db
    .storage
    .from("question-figures")
    .upload(path, file, {
      contentType: file.type
    });

  if (error) {
    $("preview").textContent = "Upload failed: " + error.message;
    return;
  }

  const { data } = db
    .storage
    .from("question-figures")
    .getPublicUrl(path);

  figureUrl = data.publicUrl;
  figurePath = path;

  $("preview").innerHTML = `
    <img
      src="${esc(figureUrl)}"
      alt="Question figure preview">
  `;
};


// ============================================================
// Load questions
// ============================================================

let selectedQuestionIds = new Set();

function updateQuestionBulkControls() {
  const selected = selectedQuestionIds.size;
  $("questionSelectionCount").textContent = selected + " selected";
  $("deleteSelectedQuestions").disabled = selected === 0;
  $("publishSelectedQuestions").disabled = selected === 0;
  $("publishSelectedQuestions").textContent = "[Un]Publish selected";
  $("selectAllQuestions").checked = false;
  const visible = [...$("questionList").querySelectorAll("[data-qselect]")];
  $("selectAllQuestions").checked = visible.length > 0 && visible.every(input => input.checked);
  $("selectAllQuestions").indeterminate = visible.some(input => input.checked) && !visible.every(input => input.checked);
  const category = $("categoryFilter").value;
  $("deleteCategoryQuestions").disabled = !category;
  $("deleteCategoryQuestions").textContent = category
    ? "Delete all in category"
    : "Delete category";
  $("publishCategoryQuestions").disabled = !category;
  $("publishCategoryQuestions").textContent = "[Un]Publish category";
}

function populateSubtopicFilter(reset = false) {
  const select = $("subtopicFilter");
  if (!select) return;
  const category = $("categoryFilter").value;
  const previous = reset ? "" : select.value;
  const entries = category
    ? (categorySubtopics[category] || [])
    : Object.values(categorySubtopics).flat();
  const unique = [...new Map(entries.map(([id, label]) => [id, label])).entries()];
  select.innerHTML = '<option value="">All subcategories</option>' +
    unique.map(([id, label]) => '<option value="' + esc(id) + '">' + esc(label) + '</option>').join("");
  if (unique.some(([id]) => id === previous)) select.value = previous;
}

async function loadQuestions() {
  const { data, error } = await db
    .from("questions")
    .select("id,topic,topic_category,subtopic,stimulus_id,question_type,difficulty,question_usage,question_text,published")
    .order("created_at", { ascending: false });

  if (error) {
    $("questionList").textContent = error.message;
    return;
  }

  const search = $("search").value.toLowerCase();
  const category = $("categoryFilter").value;
  const subtopic = $("subtopicFilter").value;
  const type = $("typeFilter").value;
  const level = $("levelFilter").value;
  const status = $("statusFilter").value;

  const rows = (data || []).filter(x =>
    (!category || x.topic_category === category) &&
    (!subtopic || x.subtopic === subtopic) &&
    (!search ||
      (x.topic + " " + x.question_text)
        .toLowerCase()
        .includes(search)) &&
    (!type || x.question_type === type) &&
    (!level || String(x.difficulty) === level) &&
    (!status || (status === "published" ? x.published === true : x.published !== true))
  );

  const visibleIds = new Set(rows.map(x => String(x.id)));
  selectedQuestionIds = new Set([...selectedQuestionIds].filter(id => visibleIds.has(id)));

  $("questionList").innerHTML = rows.length
    ? rows.map(x => `
      <div class="entry question-entry">
        <label class="question-select">
          <input type="checkbox" data-qselect="${esc(x.id)}" ${selectedQuestionIds.has(String(x.id)) ? "checked" : ""} aria-label="Select question">
        </label>
        <div class="question-entry-content">
          <strong>
            ${esc(categoryLabels[x.topic_category] || x.topic_category || "Unclassified")} · ${esc((x.subtopic || "").replaceAll("_"," "))} · Level ${x.difficulty}
          </strong>
          <div class="meta">
            ${esc(typeNames[x.question_type] || x.question_type)}
            · ${x.stimulus_id ? "Shared stimulus group" : "Standalone"}
            · ${x.question_usage === "mock" ? "Mock only" : x.question_usage === "practice" ? "Practice only" : "Mock + practice"}
            · ${x.published ? "Published" : "Draft"}
            · ${esc(x.question_text.slice(0, 130))}
          </div>
        </div>
        <div class="buttons">
          <button data-qedit="${esc(x.id)}">Edit</button>
          <button data-qpub="${esc(x.id)}" data-published="${x.published}">
            ${x.published ? "Unpublish" : "Publish"}
          </button>
          <button class="del" data-qdel="${esc(x.id)}">Delete</button>
        </div>
      </div>
    `).join("")
    : "<p>No matching questions.</p>";

  $("questionList").querySelectorAll("[data-qselect]").forEach(input => {
    input.addEventListener("change", () => {
      const id = String(input.dataset.qselect);
      if (input.checked) selectedQuestionIds.add(id);
      else selectedQuestionIds.delete(id);
      updateQuestionBulkControls();
    });
  });

  $("questionList").querySelectorAll("[data-qedit]").forEach(b => {
    b.onclick = () => editQuestion(b.dataset.qedit);
  });

  $("questionList").querySelectorAll("[data-qpub]").forEach(b => {
    b.onclick = () => toggleQuestion(
      b.dataset.qpub,
      b.dataset.published === "true"
    );
  });

  $("questionList").querySelectorAll("[data-qdel]").forEach(b => {
    b.onclick = () => deleteQuestion(b.dataset.qdel);
  });

  updateQuestionBulkControls();
}

$("selectAllQuestions").addEventListener("change", event => {
  $("questionList").querySelectorAll("[data-qselect]").forEach(input => {
    input.checked = event.target.checked;
    const id = String(input.dataset.qselect);
    if (input.checked) selectedQuestionIds.add(id);
    else selectedQuestionIds.delete(id);
  });
  updateQuestionBulkControls();
});

$("publishSelectedQuestions").addEventListener("click", async () => {
  const ids = [...selectedQuestionIds];
  if (!ids.length) return;
  if (!await showAdminConfirm({
    title: "Update selected questions",
    message: "You are about to switch the publication status of " + ids.length + " selected questions. Published questions will become drafts, and draft questions will be published.",
    confirmText: "Update status"
  })) return;
  const button = $("publishSelectedQuestions");
  button.disabled = true;
  button.textContent = "Updating…";
  const current = await db.from("questions").select("id,published").in("id", ids);
  if (current.error) { showAdminNotice("Could not read selected question statuses: " + current.error.message); updateQuestionBulkControls(); return; }
  const publishIds = (current.data || []).filter(row => !row.published).map(row => row.id);
  const unpublishIds = (current.data || []).filter(row => row.published).map(row => row.id);
  const timestamp = new Date().toISOString();
  const results = await Promise.all([
    publishIds.length ? db.from("questions").update({ published: true, updated_at: timestamp }).in("id", publishIds) : Promise.resolve({ error: null }),
    unpublishIds.length ? db.from("questions").update({ published: false, updated_at: timestamp }).in("id", unpublishIds) : Promise.resolve({ error: null })
  ]);
  if (results.some(result => result.error)) { showAdminNotice("Could not update all selected questions: " + results.filter(result => result.error).map(result => result.error.message).join("; ")); updateQuestionBulkControls(); return; }
  selectedQuestionIds.clear();
  showAdminNotice((current.data || []).length + " question(s) had their publication status toggled.");
  await loadQuestions();
});

$("publishCategoryQuestions").addEventListener("click", async () => {
  const category = $("categoryFilter").value;
  if (!category) return;
  const label = categoryLabels[category] || category.replaceAll("_", " ");
  if (!await showAdminConfirm({
    title: "Update topic question status",
    message: "You are about to switch the publication status of every question in " + label + ". Published questions will become drafts, and draft questions will be published.",
    confirmText: "Update status"
  })) return;
  const button = $("publishCategoryQuestions");
  button.disabled = true;
  button.textContent = "Updating…";
  const current = await db.from("questions").select("id,published").eq("topic_category", category);
  if (current.error) { showAdminNotice("Could not read category question statuses: " + current.error.message); updateQuestionBulkControls(); return; }
  const publishIds = (current.data || []).filter(row => !row.published).map(row => row.id);
  const unpublishIds = (current.data || []).filter(row => row.published).map(row => row.id);
  const timestamp = new Date().toISOString();
  const results = await Promise.all([
    publishIds.length ? db.from("questions").update({ published: true, updated_at: timestamp }).in("id", publishIds) : Promise.resolve({ error: null }),
    unpublishIds.length ? db.from("questions").update({ published: false, updated_at: timestamp }).in("id", unpublishIds) : Promise.resolve({ error: null })
  ]);
  if (results.some(result => result.error)) { showAdminNotice("Could not update all category questions: " + results.filter(result => result.error).map(result => result.error.message).join("; ")); updateQuestionBulkControls(); return; }
  selectedQuestionIds.clear();
  showAdminNotice((current.data || []).length + " question(s) in " + label + " had their publication status toggled.");
  await loadQuestions();
});
$("deleteSelectedQuestions").addEventListener("click", async () => {
  const ids = [...selectedQuestionIds];
  if (!ids.length) return;
  if (!await showAdminConfirm({ title: "Delete selected questions", message: "Permanently delete " + ids.length + " selected questions? This action cannot be undone.", confirmText: "Delete questions" })) return;

  const button = $("deleteSelectedQuestions");
  button.disabled = true;
  button.textContent = "Deleting…";
  const result = await db.from("questions").delete().in("id", ids);
  button.textContent = "Delete selected";

  if (result.error) {
    showAdminNotice("Could not delete selected questions: " + result.error.message);
    updateQuestionBulkControls();
    return;
  }

  selectedQuestionIds.clear();
  await Promise.all([loadQuestions(), loadStimulusGroups()]);
});

$("deleteCategoryQuestions").addEventListener("click", async () => {
  const category = $("categoryFilter").value;
  if (!category) return;
  const label = categoryLabels[category] || category.replaceAll("_", " ");
  if (!await showAdminConfirm({ title: "Delete topic questions", message: "Permanently delete every question in " + label + "? This includes published and draft questions. This action cannot be undone.", confirmText: "Delete all questions" })) return;

  const button = $("deleteCategoryQuestions");
  button.disabled = true;
  button.textContent = "Deleting…";
  const result = await db.from("questions").delete().eq("topic_category", category);
  button.textContent = "Delete all in category";

  if (result.error) {
    showAdminNotice("Could not delete category questions: " + result.error.message);
    updateQuestionBulkControls();
    return;
  }

  selectedQuestionIds.clear();
  await Promise.all([loadQuestions(), loadStimulusGroups()]);
});

populateSubtopicFilter(true);
["search", "subtopicFilter", "typeFilter", "levelFilter", "statusFilter"].forEach(id => {
  $(id).addEventListener(
    id === "search" ? "input" : "change",
    loadQuestions
  );
});
$("categoryFilter").addEventListener("change", () => {
  populateSubtopicFilter(true);
  loadQuestions();
});

// ============================================================
// Edit question
// ============================================================

async function editQuestion(id) {
  const { data, error } = await db.rpc("admin_get_question", {
    p_question_id: String(id)
  });

  if (error || !data) {
    showAdminNotice(error?.message || "Question details could not be loaded.");
    return;
  }

  $("questionId").value = data.id;

  $("topicCategory").value = data.topic_category || "arithmetic";
  fillSubtopicOptions(data.subtopic || "arithmetic_other");
  updateStimulusPanel();
  await loadStimulusGroups(data.stimulus_id || "");
  $("stimulusGroup").value = data.stimulus_id || "";
  $("stimulusEditor").hidden = true;

  $("topic").value = data.topic;
  $("questionUsage").value = data.question_usage || "both";
  $("qType").value = data.question_type;
  $("difficulty").value = data.difficulty;
  $("linkedLesson").value = data.lesson_id || "";

  $("qText").value = data.question_text;
  $("qPublished").checked = data.published;

  $("explanation").value = data.explanation || "";

  $("explanationType").value =
    data.explanation_type || "text";

  $("explanationVideo").value =
    data.explanation_video_url || "";

  figureUrl = data.figure_url || null;
  figurePath = null;

  $("figure").value = "";

  $("preview").innerHTML = figureUrl
    ? `<img src="${esc(figureUrl)}" alt="Figure preview">`
    : "";

  const opts = parseOptions(data.options);

  const extra = {};

  if (data.question_type === "quantitative_comparison") {
    extra.quantity_a = opts[0]?.text || "";
    extra.quantity_b = opts[1]?.text || "";
  }

  if (data.question_type === "numeric_entry") {
    extra.numeric_answer = answerString(data.correct_answer);

    if (
      data.correct_answer &&
      typeof data.correct_answer === "object"
    ) {
      extra.tolerance = data.correct_answer.tolerance ?? "";
    }
  }

  $("questionFormTitle").textContent = "Edit question";

  message("questionMsg", "");

  updateExplanationFields();

  renderDynamicFields(
    data.options,
    data.correct_answer,
    extra
  );

  $("questionDialog").showModal();
}


// ============================================================
// Save question
// ============================================================

$("questionForm").onsubmit = async e => {
  e.preventDefault();

  message("questionMsg", "Saving…");

  const type = $("qType").value;

  let options = [];
  let correct;

  if (type === "quantitative_comparison") {
    options = [
      {
        label: "Quantity A",
        text: $("quantityA").value.trim()
      },
      {
        label: "Quantity B",
        text: $("quantityB").value.trim()
      }
    ];

    correct = document.querySelector(
      'input[name="dynamicAnswer"]:checked'
    )?.value || "";

    if (!options[0].text || !options[1].text || !correct) {
      message(
        "questionMsg",
        "Enter both quantities and select the correct answer."
      );

      return;
    }

  } else if (type === "numeric_entry") {
    const value = $("numericAnswer").value.trim();
    const tolerance = $("numericTolerance").value.trim();

    if (!value || !Number.isFinite(Number(value))) {
      message("questionMsg", "Enter a valid numerical answer.");
      return;
    }

    correct = {
      value,
      tolerance: tolerance === "" ? null : Number(tolerance)
    };

    options = [];

  } else {
    options = collectOptions();

    const selected = [
      ...document.querySelectorAll("#correctChoices input:checked")
    ].map(x => x.value);

    if (!options.length || !selected.length) {
      message(
        "questionMsg",
        "Add answer options and select the correct answer."
      );

      return;
    }

    if (type === "multiple_choice_multiple") {
      correct = selected;
    } else {
      correct = selected[0];
    }
  }


  // Explanation validation

  const explanationType = $("explanationType").value;

  const explanationText = $("explanation").value.trim();

  const explanationVideoInput =
    $("explanationVideo").value.trim();

  const explanationVideoUrl =
    getYouTubeEmbedUrl(explanationVideoInput);

  if (
    (explanationType === "text" ||
      explanationType === "both") &&
    !explanationText
  ) {
    message(
      "questionMsg",
      "Please enter the written explanation."
    );

    return;
  }

  if (
    (explanationType === "video" ||
      explanationType === "both") &&
    !explanationVideoUrl
  ) {
    message(
      "questionMsg",
      "Please enter a valid YouTube video URL."
    );

    return;
  }


  // Question database record

  const topicCategory = $("topicCategory").value;
  const subtopic = $("subtopic").value;
  const stimulusId = topicCategory === "data_analysis"
    ? ($("stimulusGroup").value || null)
    : null;

  if (stimulusId && subtopic !== "data_interpretation") {
    message("questionMsg", "Questions linked to a shared figure must use the Data Interpretation subtopic.");
    return;
  }

  const body = {
    topic: $("topic").value.trim(),
    topic_category: topicCategory,
    subtopic,
    stimulus_id: stimulusId,
    question_usage: $("questionUsage").value,

    question_type: type,

    difficulty: +$("difficulty").value,

    lesson_id: $("linkedLesson").value || null,

    question_text: $("qText").value.trim(),

    options,

    correct_answer: correct,

    figure_url: figureUrl,

    explanation: explanationText,

    explanation_type: explanationType,

    explanation_video_url: explanationVideoUrl,

    published: $("qPublished").checked,

    updated_at: new Date().toISOString()
  };


  const id = $("questionId").value;

  const result = id
    ? await db.from("questions").update(body).eq("id", id)
    : await db.from("questions").insert(body);

  if (result.error) {
    message("questionMsg", result.error.message);
    return;
  }

  $("questionDialog").close();

  await Promise.all([
    loadQuestions(),
    loadStimulusGroups(stimulusId || "")
  ]);
};


// ============================================================
// Publish / unpublish / delete question
// ============================================================

async function toggleQuestion(id, published) {
  const result = await db
    .from("questions")
    .update({
      published: !published,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (result.error) {
    showAdminNotice(result.error.message);
  } else {
    await loadQuestions();
  }
}

async function deleteQuestion(id) {
  if (!await showAdminConfirm({ title: "Delete question", message: "Are you sure you want to delete this question? This action cannot be undone.", confirmText: "Delete" })) return;

  const result = await db
    .from("questions")
    .delete()
    .eq("id", id);

  if (result.error) {
    showAdminNotice(result.error.message);
  } else {
    await Promise.all([loadQuestions(), loadStimulusGroups()]);
  }
}



/* ============================================================
   Bulk question import
   Accepts CSV / Excel with the template columns, or JSON records.
   ============================================================ */

let questionImportRows = [];
let questionImportFileName = "";

const questionImportTypes = new Set([
  "quantitative_comparison",
  "multiple_choice_single",
  "multiple_choice_multiple",
  "numeric_entry",
  "data_interpretation"
]);

function importText(value) {
  return String(value ?? "").trim();
}

function importHeaderRow(row) {
  const result = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    result[String(key).trim().toLowerCase().replace(/[\s-]+/g, "_")] = value;
  });
  return result;
}

function parseImportJsonCell(value, label, rowNumber, errors) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    errors.push("Row " + rowNumber + ": " + label + " must contain valid JSON.");
    return undefined;
  }
}

function importBoolean(value, defaultValue = false) {
  if (value === null || value === undefined || String(value).trim() === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "published"].includes(text)) return true;
  if (["false", "0", "no", "n", "draft"].includes(text)) return false;
  return null;
}

function importQuestionRecord(rawRow, rowNumber) {
  const row = importHeaderRow(rawRow);
  const errors = [];

  const category = importText(row.topic_category).toLowerCase();
  const subtopic = normalizeImportSubtopic(category, row.subtopic);
  const type = importText(row.question_type).toLowerCase();
  const difficulty = Number(row.difficulty);
  const questionText = importText(row.question_text);
  const topic = importText(row.topic);
  const usage = importText(row.question_usage || "both").toLowerCase();
  const explanationType = importText(row.explanation_type || "text").toLowerCase();

  if (!topic) errors.push("Topic is required.");
  if (!categorySubtopics[category]) errors.push("Invalid topic_category. Use arithmetic, data_analysis, algebra, or geometry.");
  if (categorySubtopics[category] && !categorySubtopics[category].some(item => item[0] === subtopic)) {
    errors.push("Invalid subtopic for " + category + ".");
  }
  if (!questionImportTypes.has(type)) errors.push("Invalid question_type.");
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) errors.push("Difficulty must be an integer from 1 to 5.");
  if (!questionText) errors.push("Question text is required.");
  if (!["mock", "practice", "both"].includes(usage)) errors.push("question_usage must be mock, practice, or both.");
  if (!["text", "video", "both"].includes(explanationType)) errors.push("explanation_type must be text, video, or both.");

  let options = parseImportJsonCell(row.options_json, "options_json", rowNumber, errors);
  if (options === undefined && row.options !== undefined && row.options !== "") {
    options = parseImportJsonCell(row.options, "options", rowNumber, errors);
  }

  let correct = parseImportJsonCell(row.correct_answer_json, "correct_answer_json", rowNumber, errors);
  if (correct === undefined && row.correct_answer !== undefined && row.correct_answer !== "") {
    const rawAnswer = row.correct_answer;
    correct = rawAnswer && typeof rawAnswer === "object"
      ? rawAnswer
      : typeof rawAnswer === "number" ? String(rawAnswer) : importText(rawAnswer);
  }

  if (type === "quantitative_comparison") {
    const existingQuantityA = Array.isArray(options)
      ? options.find(item => String(item.label || "").toLowerCase() === "quantity a")?.text
      : "";
    const existingQuantityB = Array.isArray(options)
      ? options.find(item => String(item.label || "").toLowerCase() === "quantity b")?.text
      : "";
    const qa = importText(row.quantity_a || existingQuantityA || (Array.isArray(options) ? options[0]?.text : ""));
    const qb = importText(row.quantity_b || existingQuantityB || (Array.isArray(options) ? options[1]?.text : ""));
    if (!qa || !qb) errors.push("Quantitative Comparison requires quantity_a and quantity_b.");
    options = [
      { label: "Quantity A", text: qa },
      { label: "Quantity B", text: qb }
    ];
    const answer = importText(correct).toUpperCase();
    if (!["A", "B", "C", "D"].includes(answer)) errors.push("Quantitative Comparison correct_answer must be A, B, C, or D.");
    correct = answer;
  } else if (type === "numeric_entry") {
    const numericValue = row.numeric_answer !== undefined && row.numeric_answer !== ""
      ? row.numeric_answer
      : (correct && typeof correct === "object" ? correct.value : correct);
    const toleranceValue = row.numeric_tolerance !== undefined && row.numeric_tolerance !== ""
      ? row.numeric_tolerance
      : (correct && typeof correct === "object" ? correct.tolerance : null);
    if (numericValue === null || numericValue === undefined || importText(numericValue) === "" || !Number.isFinite(Number(numericValue))) {
      errors.push("Numeric Entry requires a valid numeric_answer.");
    }
    if (toleranceValue !== null && toleranceValue !== undefined && toleranceValue !== "" &&
        (!Number.isFinite(Number(toleranceValue)) || Number(toleranceValue) < 0)) {
      errors.push("numeric_tolerance must be a non-negative number.");
    }
    correct = {
      value: importText(numericValue),
      tolerance: toleranceValue === null || toleranceValue === undefined || toleranceValue === "" ? null : Number(toleranceValue)
    };
    options = [];
  } else {
    if (!Array.isArray(options) || !options.length) {
      options = [];
      for (let i = 0; i < 6; i++) {
        const label = String.fromCharCode(65 + i);
        const value = importText(row["option_" + label.toLowerCase()]);
        if (value) options.push({ label, text: value });
      }
    }
    options = Array.isArray(options) ? options.map((item, index) => {
      if (typeof item === "string") return { label: String.fromCharCode(65 + index), text: item };
      return {
        label: importText(item.label || String.fromCharCode(65 + index)),
        text: importText(item.text)
      };
    }) : [];

    if (options.length < 2) errors.push("Multiple-choice questions require at least two options.");
    if (options.some(item => !item.text)) errors.push("Every supplied option must have text.");

    if (correct === undefined || correct === null || correct === "") {
      errors.push("correct_answer is required.");
    } else {
      const answers = Array.isArray(correct)
        ? correct.map(x => importText(x).toUpperCase())
        : importText(correct).split(",").map(x => x.trim().toUpperCase()).filter(Boolean);
      const labels = options.map(item => item.label.toUpperCase());
      if (!answers.length || answers.some(x => !labels.includes(x))) errors.push("correct_answer must reference existing option labels, such as A or A,C.");
      else if (type === "multiple_choice_multiple") correct = answers;
      else {
        if (answers.length !== 1) errors.push("This question type requires exactly one correct option.");
        correct = answers[0] || "";
      }
    }
  }

  const explanation = importText(row.explanation);
  const explanationVideoInput = importText(row.explanation_video_url);
  const explanationVideoUrl = explanationVideoInput ? getYouTubeEmbedUrl(explanationVideoInput) : null;

  if ((explanationType === "text" || explanationType === "both") && !explanation) {
    errors.push("Written explanation is required for the selected explanation_type.");
  }
  if ((explanationType === "video" || explanationType === "both") && !explanationVideoUrl) {
    errors.push("A valid YouTube explanation URL is required for the selected explanation_type.");
  }

  let figureUrl = importText(row.figure_url) || null;
  if (figureUrl) {
    try {
      const parsed = new URL(figureUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid protocol");
    } catch (_) {
      errors.push("figure_url must be a valid http or https URL.");
    }
  }

  const published = importBoolean(row.published, false);
  if (published === null) errors.push("published must be TRUE or FALSE.");

  const lessonId = importText(row.lesson_id) || null;
  const stimulusId = importText(row.stimulus_id) || null;
  if (stimulusId && (category !== "data_analysis" || subtopic !== "data_interpretation")) {
    errors.push("stimulus_id can only be used with Data Analysis / Data Interpretation questions.");
  }

  const record = {
    topic,
    topic_category: category,
    subtopic,
    stimulus_id: stimulusId,
    question_usage: usage,
    question_type: type,
    difficulty,
    lesson_id: lessonId,
    question_text: questionText,
    options: Array.isArray(options) ? options : [],
    correct_answer: correct,
    figure_url: figureUrl,
    explanation,
    explanation_type: explanationType,
    explanation_video_url: explanationVideoUrl,
    published: published === null ? false : published,
    updated_at: new Date().toISOString()
  };

  return { rowNumber, record, errors, duplicate: false, imported: false };
}

function renderQuestionImportPreview() {
  const rows = questionImportRows;
  const valid = rows.filter(row => !row.errors.length && !row.duplicate && !row.imported).length;
  const duplicates = rows.filter(row => row.duplicate).length;
  const invalid = rows.filter(row => row.errors.length).length;
  const imported = rows.filter(row => row.imported).length;

  $("questionImportSummary").hidden = false;
  $("questionImportSummary").innerHTML =
    '<div class="rule-grid" style="margin:12px 0">' +
      '<div class="rule"><strong>' + valid + '</strong><span>Ready to import</span></div>' +
      '<div class="rule"><strong>' + duplicates + '</strong><span>Duplicates skipped</span></div>' +
      '<div class="rule"><strong>' + invalid + '</strong><span>Rows with errors</span></div>' +
      '<div class="rule"><strong>' + imported + '</strong><span>Imported</span></div>' +
    '</div>';

  const preview = rows.slice(0, 30);
  $("questionImportPreview").innerHTML = preview.length
    ? '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr><th style="text-align:left;padding:8px">Row</th><th style="text-align:left;padding:8px">Question</th><th style="text-align:left;padding:8px">Category / type</th><th style="text-align:left;padding:8px">Status</th></tr></thead>' +
      '<tbody>' + preview.map(row => {
        const status = row.imported ? "Imported" : row.errors.length ? row.errors.join(" ") : row.duplicate ? "Duplicate of an existing question" : "Ready";
        const colour = row.imported ? "#147d54" : row.errors.length ? "#b42318" : row.duplicate ? "#8a5a00" : "#147d54";
        return '<tr style="border-top:1px solid #e2e8f0">' +
          '<td style="padding:8px;vertical-align:top">' + row.rowNumber + '</td>' +
          '<td style="padding:8px;vertical-align:top;min-width:260px">' + esc(row.record.question_text.slice(0, 150)) + '</td>' +
          '<td style="padding:8px;vertical-align:top">' + esc(row.record.topic_category) + ' · ' + esc(row.record.question_type) + ' · L' + esc(row.record.difficulty) + '</td>' +
          '<td style="padding:8px;vertical-align:top;color:' + colour + ';min-width:180px">' + esc(status) + '</td>' +
        '</tr>';
      }).join("") + '</tbody></table>' +
      (rows.length > preview.length ? '<p class="field-note">Showing the first ' + preview.length + ' of ' + rows.length + ' rows.</p>' : '')
    : '<p class="field-note">No question rows found.</p>';

  $("runQuestionImport").disabled = valid === 0;
  $("runQuestionImport").textContent = valid ? "Import " + valid + " valid questions" : "No valid questions to import";
}

const questionCsvHeaders = [
  "topic","topic_category","subtopic","question_type","difficulty","question_text",
  "option_a","option_b","option_c","option_d","option_e","option_f",
  "quantity_a","quantity_b","correct_answer","numeric_answer","numeric_tolerance",
  "figure_url","explanation","explanation_type","explanation_video_url",
  "question_usage","published","lesson_id","stimulus_id"
];

function downloadCsvFile(filename, rows) {
  const escapeCell = value => {
    const text = String(value ?? "");
    return /[",\\r\\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const csv = rows.map(row => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
  const blob = new Blob(["\\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadQuestionCsvTemplate() {
  downloadCsvFile("drillgre-question-import-template.csv", [questionCsvHeaders]);
}

function downloadQuestionCsvExample() {
  // Build rows by column name rather than positional arrays. This prevents
  // column shifts that can turn difficulty into NaN or misplace answer fields.
  const example = fields => questionCsvHeaders.map(header =>
    fields[header] === undefined || fields[header] === null ? "" : fields[header]
  );

  const examples = [
    // Multiple Choice: Single Answer
    example({
      topic: "GCD and divisibility",
      topic_category: "arithmetic",
      subtopic: "divisibility_factors_multiples",
      question_type: "multiple_choice_single",
      difficulty: 2,
      question_text: "What is the greatest common divisor of 24 and 36?",
      option_a: "6", option_b: "8", option_c: "12", option_d: "18",
      correct_answer: "C",
      explanation: "The greatest common divisor is the largest positive integer that divides both numbers. The answer is 12.",
      explanation_type: "text",
      question_usage: "both",
      published: "FALSE"
    }),
    // Multiple Choice: Multiple Answers
    example({
      topic: "Properties of integers",
      topic_category: "arithmetic",
      subtopic: "number_properties",
      question_type: "multiple_choice_multiple",
      difficulty: 3,
      question_text: "Which of the following are prime numbers? Select all that apply.",
      option_a: "2", option_b: "9", option_c: "11", option_d: "15", option_e: "17",
      correct_answer: "A,C,E",
      explanation: "A prime number has exactly two positive factors. Therefore, 2, 11 and 17 are prime.",
      explanation_type: "text",
      question_usage: "both",
      published: "FALSE"
    }),
    // Quantitative Comparison
    example({
      topic: "Linear expressions",
      topic_category: "algebra",
      subtopic: "algebraic_expressions",
      question_type: "quantitative_comparison",
      difficulty: 2,
      question_text: "Compare Quantity A and Quantity B. Assume x can be any real number.",
      quantity_a: "2x + 1",
      quantity_b: "7",
      correct_answer: "D",
      explanation: "The value of x is not specified. Quantity A can be less than, equal to, or greater than Quantity B, so the relationship cannot be determined.",
      explanation_type: "text",
      question_usage: "both",
      published: "FALSE"
    }),
    // Numeric Entry
    example({
      topic: "Linear equations",
      topic_category: "algebra",
      subtopic: "linear_equations",
      question_type: "numeric_entry",
      difficulty: 2,
      question_text: "If 3x + 5 = 20, what is the value of x?",
      numeric_answer: "5",
      numeric_tolerance: "0",
      correct_answer: "5",
      explanation: "Subtract 5 from both sides and divide by 3. Therefore, x = 5.",
      explanation_type: "text",
      question_usage: "both",
      published: "FALSE"
    }),
    // Data Interpretation
    example({
      topic: "Data interpretation",
      topic_category: "data_analysis",
      subtopic: "data_interpretation",
      question_type: "data_interpretation",
      difficulty: 2,
      question_text: "Monthly sales were 20, 25 and 30 units in three successive months. What were total sales?",
      option_a: "65", option_b: "70", option_c: "75", option_d: "80",
      correct_answer: "C",
      explanation: "Add the three monthly figures: 20 + 25 + 30 = 75 units. For linked questions, supply the shared stimulus_id.",
      explanation_type: "text",
      question_usage: "practice",
      published: "FALSE"
    })
  ];

  downloadCsvFile("drillgre-question-import-example.csv", [questionCsvHeaders, ...examples]);
}

function parseQuestionCsvText(source) {
  // CSV answer choices must remain literal text. Do not pass CSV through a
  // spreadsheet date parser, which can turn values such as 21/8 into dates.
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(source || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      if (row.some(value => value.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some(value => value.trim() !== "")) rows.push(row);
  if (!rows.length) return [];

  const headers = rows.shift().map(value => value.trim());
  return rows.map(values => {
    const record = {};
    headers.forEach((header, index) => {
      if (header) record[header] = values[index] ?? "";
    });
    return record;
  });
}

async function readQuestionImportFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) throw new Error("JSON import must be an array of question records.");
    return parsed;
  }

  if (name.endsWith(".csv")) {
    return parseQuestionCsvText(await file.text());
  }

  if (!window.XLSX) throw new Error("The spreadsheet reader could not load. Refresh the admin page and try again.");
  const workbook = window.XLSX.read(await file.arrayBuffer(), {
    type: "array",
    raw: true,
    cellDates: false
  });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("The workbook does not contain a worksheet.");
  return window.XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: true });
}

async function validateQuestionImport() {
  const file = $("questionImportFile").files[0];
  if (!file) {
    message("questionImportStatus", "Choose an .xlsx, .xls, .csv, or .json file first.");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    message("questionImportStatus", "The import file must be 10 MB or smaller.");
    return;
  }

  $("validateQuestionImport").disabled = true;
  $("runQuestionImport").disabled = true;
  message("questionImportStatus", "Reading and validating the file…");

  try {
    const rawRows = await readQuestionImportFile(file);
    if (!rawRows.length) throw new Error("The file contains no question rows.");

    const parsedRows = rawRows
      .map((row, index) => ({ row, index }))
      .filter(item => item.row && Object.values(item.row).some(value => String(value ?? "").trim() !== ""))
      .map(item => importQuestionRecord(item.row, item.index + 2));

    if (!parsedRows.length) throw new Error("No non-empty question rows were found.");

    message("questionImportStatus", "Checking for existing questions…");
    const existing = new Set();
    let offset = 0;
    while (true) {
      const { data, error } = await db
        .from("questions")
        .select("question_type,question_text")
        .range(offset, offset + 999);
      if (error) throw new Error("Could not check existing questions for duplicates: " + error.message);
      (data || []).forEach(item => {
        existing.add(String(item.question_type) + "::" + String(item.question_text || "").trim().toLowerCase().replace(/\s+/g, " "));
      });
      if (!data || data.length < 1000) break;
      offset += 1000;
    }

    const seen = new Set();
    parsedRows.forEach(item => {
      const key = String(item.record.question_type) + "::" +
        String(item.record.question_text || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (!item.errors.length && (existing.has(key) || seen.has(key))) item.duplicate = true;
      if (!item.errors.length) seen.add(key);
    });

    questionImportRows = parsedRows;
    questionImportFileName = file.name;
    renderQuestionImportPreview();
    const valid = questionImportRows.filter(item => !item.errors.length && !item.duplicate).length;
    message("questionImportStatus", "Validated " + parsedRows.length + " rows from " + file.name + ". " + valid + " are ready to import.", true);
  } catch (error) {
    questionImportRows = [];
    $("questionImportSummary").hidden = true;
    $("questionImportPreview").innerHTML = "";
    message("questionImportStatus", error.message || "Could not read this file.");
  } finally {
    $("validateQuestionImport").disabled = false;
  }
}

async function runQuestionImport() {
  const rows = questionImportRows.filter(item => !item.errors.length && !item.duplicate && !item.imported);
  if (!rows.length) return;
  if (!await showAdminConfirm({ title: "Import questions", message: "Import " + rows.length + " questions from " + questionImportFileName + "? Existing and invalid rows will be skipped.", confirmText: "Import questions" })) return;

  $("runQuestionImport").disabled = true;
  $("validateQuestionImport").disabled = true;
  let imported = 0;
  const failures = [];

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    $("runQuestionImport").textContent = "Importing " + (i + 1) + " of " + rows.length + "…";
    const { error } = await db.from("questions").insert(item.record);
    if (error) {
      item.errors.push("Import failed: " + error.message);
      failures.push("Row " + item.rowNumber + ": " + error.message);
    } else {
      item.imported = true;
      imported++;
    }
    if (i % 5 === 0) renderQuestionImportPreview();
  }

  await Promise.all([loadQuestions(), loadStimulusGroups()]);
  renderQuestionImportPreview();
  $("validateQuestionImport").disabled = false;
  message(
    "questionImportStatus",
    imported + " questions imported successfully. " + failures.length + " rows failed. Review the preview for details.",
    failures.length === 0
  );
  $("runQuestionImport").textContent = "Import remaining valid questions";
}

$("importQuestions").addEventListener("click", () => {
  questionImportRows = [];
  questionImportFileName = "";
  $("questionImportFile").value = "";
  $("questionImportSummary").hidden = true;
  $("questionImportPreview").innerHTML = "";
  $("runQuestionImport").disabled = true;
  $("runQuestionImport").textContent = "Import valid questions";
  message("questionImportStatus", "");
  $("importQuestionsDialog").showModal();
});
$("downloadQuestionTemplate").addEventListener("click", downloadQuestionCsvTemplate);
$("downloadQuestionExample").addEventListener("click", downloadQuestionCsvExample);
$("validateQuestionImport").addEventListener("click", validateQuestionImport);
$("runQuestionImport").addEventListener("click", runQuestionImport);



// ============================================================
// Unified course-package importer
// One JSON file creates lessons and links their practice questions.
// Existing lessons are matched by slug and are never overwritten.
// ============================================================

let coursePackagePlan = null;
let coursePackageName = "";

function coursePackageSlug(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function coursePackageHtml(content) {
  if (typeof content === "string") return content;
  if (content && typeof content.html === "string") return content.html;
  if (content && typeof content.markdown === "string") return legacyMarkdownToHtml(content.markdown);
  return "";
}

async function readCoursePackage(file) {
  if (!file || !file.name.toLowerCase().endsWith(".json")) {
    throw new Error("Choose a course-package .json file.");
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("The package must be 10 MB or smaller.");
  const parsed = JSON.parse(await file.text());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The package root must be a JSON object.");
  }
  return parsed;
}

async function validateCoursePackage() {
  const file = $("coursePackageFile").files[0];
  if (!file) {
    message("coursePackageStatus", "Choose a course-package JSON file first.");
    return;
  }
  $("validateCoursePackage").disabled = true;
  $("runCoursePackage").disabled = true;
  message("coursePackageStatus", "Reading package and checking lessons and questions…");

  try {
    const pkg = await readCoursePackage(file);
    if (![1, "1"].includes(pkg.schema_version)) throw new Error("Unsupported schema_version. Use schema_version: 1.");
    if (!pkg.module || typeof pkg.module !== "object") throw new Error("The package must include a module object.");
    const moduleTitle = importText(pkg.module.title);
    const moduleSlug = coursePackageSlug(pkg.module.slug || moduleTitle);
    if (!moduleTitle || !moduleSlug) throw new Error("Module title and slug are required.");
    if (!Array.isArray(pkg.lessons) || !pkg.lessons.length) throw new Error("Add at least one lesson to the lessons array.");

    const { data: moduleRows, error: moduleError } = await db.from("modules")
      .select("id,title,slug").eq("slug", moduleSlug).limit(1);
    if (moduleError) throw new Error("Could not check the module: " + moduleError.message);
    const existingModule = moduleRows?.[0] || null;

    const lessonsBySlug = new Map();
    let lessonOffset = 0;
    while (true) {
      const { data, error } = await db.from("lessons")
        .select("id,title,slug,module_id").range(lessonOffset, lessonOffset + 999);
      if (error) throw new Error("Could not check existing lessons: " + error.message);
      (data || []).forEach(item => lessonsBySlug.set(item.slug, item));
      if (!data || data.length < 1000) break;
      lessonOffset += 1000;
    }

    const existingQuestionKeys = new Set();
    let questionOffset = 0;
    while (true) {
      const { data, error } = await db.from("questions")
        .select("question_type,question_text").range(questionOffset, questionOffset + 999);
      if (error) throw new Error("Could not check existing questions: " + error.message);
      (data || []).forEach(item => existingQuestionKeys.add(
        String(item.question_type) + "::" +
        String(item.question_text || "").trim().toLowerCase().replace(/\s+/g, " ")
      ));
      if (!data || data.length < 1000) break;
      questionOffset += 1000;
    }

    const planLessons = [];
    const packageLessonSlugs = new Set();
    const packageQuestionKeys = new Set();
    let questionCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    for (let i = 0; i < pkg.lessons.length; i++) {
      const source = pkg.lessons[i] || {};
      const title = importText(source.title);
      const lessonSlug = coursePackageSlug(source.slug || title);
      const htmlContent = coursePackageHtml(source.content);
      const plainText = htmlContent.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
      const errors = [];
      if (!title) errors.push("Lesson title is required.");
      if (!lessonSlug) errors.push("Lesson slug is required.");
      if (packageLessonSlugs.has(lessonSlug)) errors.push("Duplicate lesson slug within this package.");
      packageLessonSlugs.add(lessonSlug);
      if (!plainText) errors.push("Lesson content is empty.");
      const videoInput = importText(source.video_url || source.content?.video_url);
      const videoUrl = videoInput ? getYouTubeEmbedUrl(videoInput) : null;
      if (videoInput && !videoUrl) errors.push("Invalid YouTube video URL.");

      const existingLesson = lessonsBySlug.get(lessonSlug) || null;
      if (existingLesson && existingModule && existingLesson.module_id !== existingModule.id) {
        errors.push("This lesson slug already exists under a different module.");
      }
      if (existingLesson && !existingModule) {
        errors.push("This lesson already exists, but its module could not be matched.");
      }

      const rawQuestions = Array.isArray(source.questions) ? source.questions : [];
      if (!Array.isArray(source.questions)) errors.push("Each lesson must contain a questions array.");
      const parsedQuestions = rawQuestions.map((raw, qIndex) => {
        const parsed = importQuestionRecord({
          ...raw,
          lesson_id: existingLesson?.id || "pending",
          published: false
        }, (i + 1) * 1000 + qIndex + 1);
        parsed.record.published = false;
        parsed.record.lesson_id = existingLesson?.id || null;
        const key = String(parsed.record.question_type) + "::" +
          String(parsed.record.question_text || "").trim().toLowerCase().replace(/\s+/g, " ");
        if (!parsed.errors.length) {
          if (existingQuestionKeys.has(key) || packageQuestionKeys.has(key)) {
            parsed.duplicate = true;
            duplicateCount++;
          }
          packageQuestionKeys.add(key);
        }
        questionCount++;
        if (parsed.errors.length) invalidCount++;
        return parsed;
      });

      if (errors.length) invalidCount++;
      planLessons.push({
        title, slug: lessonSlug,
        sort_order: Number.isInteger(Number(source.sort_order)) ? Number(source.sort_order) : i + 1,
        html: htmlContent, video_url: videoUrl,
        existingLesson, errors, questions: parsedQuestions
      });
    }

    coursePackagePlan = {
      module: { title: moduleTitle, slug: moduleSlug, existingModule },
      lessons: planLessons,
      validQuestions: planLessons.reduce((n, lesson) =>
        n + lesson.questions.filter(q => !q.errors.length && !q.duplicate).length, 0),
      questionCount
    };
    coursePackageName = file.name;
    renderCoursePackagePreview();
    const newLessons = planLessons.filter(x => !x.existingLesson).length;
    const reusedLessons = planLessons.length - newLessons;
    const invalidQuestions = planLessons.reduce((n, l) => n + l.questions.filter(q => q.errors.length).length, 0);
    message("coursePackageStatus",
      "Validated " + planLessons.length + " lessons (" + newLessons + " new, " + reusedLessons +
      " existing) and " + questionCount + " questions. " + coursePackagePlan.validQuestions +
      " new questions are ready; " + duplicateCount + " duplicates and " + invalidQuestions +
      " invalid questions will be skipped.", true);
    $("runCoursePackage").disabled = newLessons === 0 && coursePackagePlan.validQuestions === 0;
  } catch (error) {
    coursePackagePlan = null;
    $("coursePackageSummary").hidden = true;
    $("coursePackagePreview").innerHTML = "";
    message("coursePackageStatus", error.message || "Could not validate this package.");
  } finally {
    $("validateCoursePackage").disabled = false;
  }
}

function renderCoursePackagePreview() {
  const plan = coursePackagePlan;
  if (!plan) return;
  const newLessons = plan.lessons.filter(x => !x.existingLesson).length;
  const rows = plan.lessons.map(lesson => {
    const valid = lesson.questions.filter(q => !q.errors.length && !q.duplicate).length;
    const duplicates = lesson.questions.filter(q => q.duplicate).length;
    const invalid = lesson.questions.filter(q => q.errors.length).length;
    return "<tr style='border-top:1px solid #e2e8f0'>" +
      "<td style='padding:8px;vertical-align:top'>" + esc(lesson.title) +
      "<div class='field-note'>" + (lesson.existingLesson ? "Existing lesson, questions will be added" : "New lesson draft") +
      (lesson.errors.length ? " · " + esc(lesson.errors.join(" ")) : "") + "</div></td>" +
      "<td style='padding:8px;vertical-align:top'>" + lesson.questions.length + "</td>" +
      "<td style='padding:8px;vertical-align:top'>" + valid + "</td>" +
      "<td style='padding:8px;vertical-align:top'>" + duplicates + "</td>" +
      "<td style='padding:8px;vertical-align:top'>" + invalid + "</td></tr>";
  }).join("");
  $("coursePackageSummary").hidden = false;
  $("coursePackageSummary").innerHTML =
    "<div class='panel' style='padding:12px;margin:12px 0'><strong>" + esc(plan.module.title) +
    "</strong><div class='field-note'>" + newLessons + " new lessons · " +
    (plan.lessons.length - newLessons) + " existing lessons · " +
    plan.questionCount + " total questions · " + plan.validQuestions + " new questions ready</div></div>";
  $("coursePackagePreview").innerHTML =
    "<div style='overflow:auto'><table style='width:100%;border-collapse:collapse;font-size:13px'>" +
    "<thead><tr><th style='text-align:left;padding:8px'>Lesson</th><th>Questions</th><th>Ready</th><th>Duplicates</th><th>Invalid</th></tr></thead>" +
    "<tbody>" + rows + "</tbody></table></div>";
}

async function runCoursePackageImport() {
  const plan = coursePackagePlan;
  if (!plan) return;
  const ready = plan.validQuestions;
  const newLessons = plan.lessons.filter(x => !x.existingLesson).length;
  if (!newLessons && !ready) return;
  if (!await showAdminConfirm({ title: "Import course package", message: "Import " + newLessons + " new lessons and " + ready + " new questions? Existing lesson content will not be changed. All imported content will remain unpublished drafts.", confirmText: "Import package" })) return;

  $("runCoursePackage").disabled = true;
  $("validateCoursePackage").disabled = true;
  let moduleId = plan.module.existingModule?.id || null;
  let lessonsCreated = 0;
  let questionsCreated = 0;
  const failures = [];

  try {
    if (!moduleId) {
      const { data, error } = await db.from("modules").insert({
        title: plan.module.title, slug: plan.module.slug,
        sort_order: 0, published: false
      }).select("id").single();
      if (error) throw new Error("Module creation failed: " + error.message);
      moduleId = data.id;
    }

    for (let i = 0; i < plan.lessons.length; i++) {
      const lesson = plan.lessons[i];
      let lessonId = lesson.existingLesson?.id || null;
      if (!lessonId) {
        $("runCoursePackage").textContent = "Creating lesson " + (i + 1) + " of " + plan.lessons.length + "…";
        const { data, error } = await db.from("lessons").insert({
          module_id: moduleId,
          title: lesson.title,
          slug: lesson.slug,
          sort_order: lesson.sort_order,
          published: false,
          content: { html: lesson.html, video_url: lesson.video_url },
          updated_at: new Date().toISOString()
        }).select("id").single();
        if (error) {
          failures.push(lesson.title + ": lesson creation failed: " + error.message);
          continue;
        }
        lessonId = data.id;
        lessonsCreated++;
      }

      const questions = lesson.questions.filter(q => !q.errors.length && !q.duplicate);
      for (let qIndex = 0; qIndex < questions.length; qIndex++) {
        const item = questions[qIndex];
        $("runCoursePackage").textContent = "Importing questions " + (questionsCreated + 1) + "…";
        const record = { ...item.record, lesson_id: lessonId, published: false };
        const { error } = await db.from("questions").insert(record);
        if (error) failures.push(lesson.title + " question " + item.rowNumber + ": " + error.message);
        else questionsCreated++;
      }
    }

    await Promise.all([loadLessons(), loadLessonOptions(), loadQuestions()]);
    message("coursePackageStatus",
      "Import finished: " + lessonsCreated + " lessons and " + questionsCreated +
      " questions added as drafts. " + failures.length + " errors." +
      (failures.length ? " First issue: " + failures[0] : ""), failures.length === 0);
    $("runCoursePackage").textContent = "Import completed";
  } catch (error) {
    message("coursePackageStatus", error.message || "Import failed. Some earlier records may already have been created.");
    $("runCoursePackage").textContent = "Retry import";
  } finally {
    $("validateCoursePackage").disabled = false;
    $("runCoursePackage").disabled = true;
    if (failures.length) console.error("Course package import issues:", failures);
  }
}

$("importCoursePackage").addEventListener("click", () => {
  coursePackagePlan = null;
  coursePackageName = "";
  $("coursePackageFile").value = "";
  $("coursePackageSummary").hidden = true;
  $("coursePackagePreview").innerHTML = "";
  $("runCoursePackage").disabled = true;
  $("runCoursePackage").textContent = "Import course package";
  message("coursePackageStatus", "");
  $("importCoursePackageDialog").showModal();
});
function downloadCoursePackageExample() {
  const sample = {
    schema_version: 1,
    module: { title: "GRE Quantitative Reasoning: Sample Module", slug: "gre-sample-module" },
    lessons: [{
      title: "Sample Lesson: Integer Properties",
      slug: "sample-integer-properties",
      sort_order: 1,
      content: {
        html: "<h2>Learning objectives</h2><p>Explain the key concept here. Use $x^2$ for inline mathematics and $x^2+y^2=z^2$ for displayed mathematics.</p><h2>Worked example</h2><p>Show a step-by-step solution.</p>",
        video_url: null
      },
      questions: [{
        topic: "Integer properties",
        topic_category: "arithmetic",
        subtopic: "number_properties",
        question_type: "multiple_choice_single",
        difficulty: 2,
        question_usage: "practice",
        question_text: "Which of the following integers is even?",
        options: [
          { label: "A", text: "7" },
          { label: "B", text: "11" },
          { label: "C", text: "14" },
          { label: "D", text: "19" }
        ],
        correct_answer: "C",
        explanation: "An even integer is divisible by 2. Since 14 = 2 × 7, the correct answer is C.",
        explanation_type: "text"
      }]
    }]
  };
  const blob = new Blob([JSON.stringify(sample, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "drillgre-course-package-example.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

$("downloadCoursePackageExample").addEventListener("click", downloadCoursePackageExample);

$("validateCoursePackage").addEventListener("click", validateCoursePackage);
$("runCoursePackage").addEventListener("click", runCoursePackageImport);


// ============================================================
// Vocab Mountain management
// ============================================================

function vocabText(value) {
  return String(value ?? "").trim();
}

function vocabNormalizeHeader(value) {
  const key = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases = {
    serial:"sn", serialnumber:"sn", daynumber:"day", synonym:"synonyms",
    meaningone:"meaning1", meaningtwo:"meaning2", meaningthree:"meaning3",
    exampleone:"example1", exampletwo:"example2", examplethree:"example3",
    published:"ispublished"
  };
  return aliases[key] || key;
}

function vocabNormalizeRow(raw) {
  const row = {};
  Object.entries(raw || {}).forEach(([key,value]) => {
    row[vocabNormalizeHeader(key)] = value;
  });
  return row;
}

function vocabBoolean(value, fallback = true) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  if (typeof value === "boolean") return value;
  const v = String(value).trim().toLowerCase();
  if (["true","1","yes","y","published"].includes(v)) return true;
  if (["false","0","no","n","draft"].includes(v)) return false;
  return null;
}

function vocabRecord(raw, rowNumber = 0) {
  const row = vocabNormalizeRow(raw);
  const errors = [];
  const dayValue = vocabText(row.day);
  const day = Number(dayValue);
  const snValue = vocabText(row.sn);
  const sn = snValue === "" ? null : Number(snValue);
  const word = vocabText(row.word);
  if (!Number.isInteger(day) || day < 1) errors.push("Day must be a positive whole number.");
  if (sn !== null && (!Number.isInteger(sn) || sn < 1)) errors.push("SN must be a positive whole number when supplied.");
  if (!word) errors.push("Word is required.");
  if (![1,2,3].some(n => vocabText(row["meaning"+n]))) errors.push("At least one meaning is required.");
  const published = vocabBoolean(row.ispublished, true);
  if (published === null) errors.push("is_published must be TRUE or FALSE.");
  const record = {
    day, sn, word,
    category:vocabText(row.category) || null,
    meaning1:vocabText(row.meaning1) || null,
    meaning2:vocabText(row.meaning2) || null,
    meaning3:vocabText(row.meaning3) || null,
    synonyms:vocabText(row.synonyms) || null,
    example1:vocabText(row.example1) || null,
    example2:vocabText(row.example2) || null,
    example3:vocabText(row.example3) || null,
    is_published:published === null ? true : published,
    updated_at:new Date().toISOString()
  };
  return {rowNumber,record,errors,duplicate:false,imported:false};
}

function vocabMeaningSummary(record) {
  return [record.meaning1,record.meaning2,record.meaning3].filter(Boolean).join(" · ");
}

function renderVocabWords() {
  const search = $("vocabSearch").value.trim().toLowerCase();
  const day = $("vocabDayFilter").value;
  const published = $("vocabPublishFilter").value;
  const rows = vocabCache.filter(item => {
    const text = [item.word,item.category,item.meaning1,item.meaning2,item.meaning3,item.synonyms].filter(Boolean).join(" ").toLowerCase();
    return (!search || text.includes(search)) &&
      (!day || String(item.day) === day) &&
      (published === "" || String(item.is_published) === published);
  });
  $("vocabCount").textContent = rows.length + " shown · " + vocabCache.length + " vocabulary words in database";
  $("vocabWordList").innerHTML = rows.length ? rows.map(item =>
    '<div class="entry"><div><strong>' + esc(item.word) +
    ' <span class="meta" style="font-weight:500">· Day ' + esc(item.day) +
    (item.sn ? " · SN " + esc(item.sn) : "") + '</span></strong>' +
    '<div class="meta">' + (item.category ? "Category: " + esc(item.category) + " · " : "") + esc(vocabMeaningSummary(item)) + '</div>' +
    '<div class="meta">' + (item.is_published ? "Published" : "Draft") +
    (item.synonyms ? " · Synonyms: " + esc(item.synonyms) : "") + '</div></div>' +
    '<div class="buttons"><button type="button" data-vocab-edit="' + esc(item.id) + '">Edit</button>' +
    '<button type="button" data-vocab-publish="' + esc(item.id) + '" data-published="' + item.is_published + '">' +
    (item.is_published ? "Unpublish" : "Publish") + '</button>' +
    '<button type="button" class="del" data-vocab-delete="' + esc(item.id) + '">Delete</button></div></div>'
  ).join("") : "<p>No vocabulary words match these filters.</p>";

  $("vocabWordList").querySelectorAll("[data-vocab-edit]").forEach(button => {
    button.onclick = () => editVocabWord(button.dataset.vocabEdit);
  });
  $("vocabWordList").querySelectorAll("[data-vocab-publish]").forEach(button => {
    button.onclick = () => toggleVocabPublished(button.dataset.vocabPublish,button.dataset.published === "true");
  });
  $("vocabWordList").querySelectorAll("[data-vocab-delete]").forEach(button => {
    button.onclick = () => deleteVocabWord(button.dataset.vocabDelete);
  });
}

function populateVocabDayFilter() {
  const current = $("vocabDayFilter").value;
  const days = [...new Set(vocabCache.map(item => Number(item.day)).filter(Number.isInteger))].sort((a,b)=>a-b);
  $("vocabDayFilter").innerHTML = '<option value="">All days</option>' +
    days.map(day => '<option value="' + day + '">Day ' + day + '</option>').join("");
  if (days.includes(Number(current))) $("vocabDayFilter").value = current;
}

async function loadVocabWords() {
  const {data,error} = await db.from("vocab_words")
    .select("id,day,sn,word,category,meaning1,meaning2,meaning3,synonyms,example1,example2,example3,is_published,created_at")
    .order("day",{ascending:true})
    .order("sn",{ascending:true,nullsFirst:false})
    .limit(10000);
  if (error) {
    $("vocabStatus").textContent = "Vocab Mountain database is not ready. Run supabase/vocab-mountain.sql in the Supabase SQL Editor. " + error.message;
    $("vocabStatus").style.color = "#b42318";
    $("vocabCount").textContent = "Unable to load vocabulary";
    return;
  }
  vocabCache = data || [];
  populateVocabDayFilter();
  renderVocabWords();
  $("vocabStatus").textContent = vocabCache.length
    ? "Vocabulary is connected to Supabase. Changes made here are saved to the database."
    : "The database is ready but has no words yet. Add a word or import the existing vocabulary CSV.";
  $("vocabStatus").style.color = "#147d54";
}

function resetVocabForm() {
  $("vocabWordForm").reset();
  $("vocabWordId").value = "";
  $("vocabWordTitle").textContent = "Add vocabulary word";
  $("vocabPublished").checked = true;
  const maxDay = vocabCache.reduce((max,item)=>Math.max(max,Number(item.day)||0),0);
  $("vocabDay").value = String(Math.max(1,maxDay || 1));
  const maxSn = vocabCache.filter(item=>Number(item.day)===Number($("vocabDay").value))
    .reduce((max,item)=>Math.max(max,Number(item.sn)||0),0);
  $("vocabSn").value = maxSn ? String(maxSn+1) : "";
  message("vocabWordMsg","");
}

function editVocabWord(id) {
  const item = vocabCache.find(row => String(row.id) === String(id));
  if (!item) return;
  $("vocabWordForm").reset();
  $("vocabWordId").value = item.id;
  $("vocabWordTitle").textContent = "Edit vocabulary word";
  $("vocabDay").value = item.day;
  $("vocabSn").value = item.sn ?? "";
  $("vocabWord").value = item.word || "";
  $("vocabCategory").value = item.category || "";
  $("vocabMeaning1").value = item.meaning1 || "";
  $("vocabMeaning2").value = item.meaning2 || "";
  $("vocabMeaning3").value = item.meaning3 || "";
  $("vocabSynonyms").value = item.synonyms || "";
  $("vocabExample1").value = item.example1 || "";
  $("vocabExample2").value = item.example2 || "";
  $("vocabExample3").value = item.example3 || "";
  $("vocabPublished").checked = !!item.is_published;
  message("vocabWordMsg","");
  $("vocabWordDialog").showModal();
}

$("vocabWordForm").addEventListener("submit",async event => {
  event.preventDefault();
  const result = vocabRecord({
    day:$("vocabDay").value, sn:$("vocabSn").value, word:$("vocabWord").value,
    category:$("vocabCategory").value,
    meaning1:$("vocabMeaning1").value, meaning2:$("vocabMeaning2").value,
    meaning3:$("vocabMeaning3").value, synonyms:$("vocabSynonyms").value,
    example1:$("vocabExample1").value, example2:$("vocabExample2").value,
    example3:$("vocabExample3").value, is_published:$("vocabPublished").checked
  });
  if (result.errors.length) {
    message("vocabWordMsg",result.errors.join(" "));
    return;
  }
  const id = $("vocabWordId").value;
  const button = $("saveVocabWord");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const query = id
      ? db.from("vocab_words").update(result.record).eq("id",id)
      : db.from("vocab_words").insert(result.record);
    const {error} = await query;
    if (error) throw error;
    $("vocabWordDialog").close();
    await loadVocabWords();
  } catch (error) {
    message("vocabWordMsg",/duplicate key|unique/i.test(error.message)
      ? "This word already exists. Edit the existing entry instead."
      : "Could not save this word. " + error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save word";
  }
});

async function toggleVocabPublished(id,published) {
  const {error} = await db.from("vocab_words")
    .update({is_published:!published,updated_at:new Date().toISOString()})
    .eq("id",id);
  if (error) {
    message("vocabStatus","Could not update publication status. " + error.message);
    return;
  }
  await loadVocabWords();
}

async function deleteVocabWord(id) {
  const item = vocabCache.find(row=>String(row.id)===String(id));
  if (!item || !await showAdminConfirm({ title: "Delete vocabulary word", message: 'Delete "' + item.word + '" from Vocab Mountain? This action cannot be undone.', confirmText: "Delete word" })) return;
  const {error} = await db.from("vocab_words").delete().eq("id",id);
  if (error) {
    message("vocabStatus","Could not delete this word. " + error.message);
    return;
  }
  await loadVocabWords();
}

function downloadVocabCsvTemplate() {
  const headers = ["day","sn","word","category","meaning1","meaning2","meaning3","synonyms","example1","example2","example3","is_published"];
  const sample = ["1","1","abound","Abundance","to exist in large numbers","to be plentiful","","plentiful; numerous","The flowers abound in the garden.","Opportunities abound for prepared students.","","TRUE"];
  const quote = value => '"' + String(value ?? "").replace(/"/g,'""') + '"';
  const csv = [headers,sample].map(row=>row.map(quote).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = "drillgre-vocabulary-template.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderVocabImportPreview() {
  const valid = vocabImportRows.filter(row=>!row.errors.length && !row.duplicate && !row.imported).length;
  const duplicates = vocabImportRows.filter(row=>row.duplicate).length;
  const invalid = vocabImportRows.filter(row=>row.errors.length).length;
  const imported = vocabImportRows.filter(row=>row.imported).length;
  $("vocabImportSummary").hidden = false;
  $("vocabImportSummary").innerHTML =
    '<div class="rule-grid" style="margin:12px 0">' +
      '<div class="rule"><strong>' + valid + '</strong><span>Ready to import</span></div>' +
      '<div class="rule"><strong>' + duplicates + '</strong><span>Duplicates skipped</span></div>' +
      '<div class="rule"><strong>' + invalid + '</strong><span>Rows with errors</span></div>' +
      '<div class="rule"><strong>' + imported + '</strong><span>Imported</span></div></div>';
  const preview = vocabImportRows.slice(0,40);
  $("vocabImportPreview").innerHTML = preview.length
    ? '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th>Row</th><th>Word</th><th>Category</th><th>Day</th><th>Meaning</th><th>Status</th></tr></thead><tbody>' +
      preview.map(row => {
        const status = row.imported ? "Imported" : row.errors.length ? row.errors.join(" ") : row.duplicate ? "Duplicate, skipped" : "Ready";
        const colour = row.imported ? "#147d54" : row.errors.length ? "#b42318" : row.duplicate ? "#8a5a00" : "#147d54";
        return '<tr><td>' + row.rowNumber + '</td><td><strong>' + esc(row.record.word) + '</strong></td><td>' + esc(row.record.category || "—") + '</td><td>' + esc(row.record.day) + '</td><td>' + esc(vocabMeaningSummary(row.record).slice(0,120)) + '</td><td style="color:' + colour + '">' + esc(status) + '</td></tr>';
      }).join("") + '</tbody></table>' +
      (vocabImportRows.length > preview.length ? '<p class="field-note">Showing the first ' + preview.length + ' of ' + vocabImportRows.length + ' rows.</p>' : '')
    : '<p class="field-note">No vocabulary rows found.</p>';
  $("runVocabImport").disabled = valid === 0;
  $("runVocabImport").textContent = valid ? "Import " + valid + " valid words" : "No valid words to import";
}

async function validateVocabImport() {
  const file = $("vocabImportFile").files[0];
  if (!file) {
    message("vocabImportStatus","Choose a CSV or Excel workbook first.");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    message("vocabImportStatus","The CSV file must be 10 MB or smaller.");
    return;
  }
  $("validateVocabImport").disabled = true;
  $("runVocabImport").disabled = true;
  message("vocabImportStatus","Reading and validating the vocabulary file…");
  try {
    if (!window.XLSX) throw new Error("The CSV reader could not load. Refresh the admin page and try again.");
    const workbook = window.XLSX.read(await file.arrayBuffer(),{type:"array"});
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("The CSV file contains no data.");
    const rawRows = window.XLSX.utils.sheet_to_json(sheet,{defval:"",raw:false});
    if (!rawRows.length) throw new Error("The CSV file contains no vocabulary rows.");
    const parsed = rawRows.map((row,index)=>vocabRecord(row,index+2))
      .filter(item=>Object.values(item.record).some(value=>value!==null && value!=="" && value!==false));
    const existing = new Set(vocabCache.map(item=>String(item.word||"").trim().toLowerCase()));
    const seen = new Set();
    parsed.forEach(item=>{
      const key = String(item.record.word||"").trim().toLowerCase();
      if (!item.errors.length && (existing.has(key)||seen.has(key))) item.duplicate=true;
      if (!item.errors.length) seen.add(key);
    });
    vocabImportRows = parsed;
    vocabImportFileName = file.name;
    renderVocabImportPreview();
    const valid = parsed.filter(item=>!item.errors.length&&!item.duplicate).length;
    message("vocabImportStatus","Validated " + parsed.length + " rows from " + file.name + ". " + valid + " new words are ready to import.",true);
  } catch (error) {
    vocabImportRows = [];
    $("vocabImportSummary").hidden = true;
    $("vocabImportPreview").innerHTML = "";
    message("vocabImportStatus",error.message || "Could not read this CSV file.");
  } finally {
    $("validateVocabImport").disabled = false;
  }
}

async function runVocabImport() {
  const rows = vocabImportRows.filter(item=>!item.errors.length&&!item.duplicate&&!item.imported);
  if (!rows.length) return;
  if (!await showAdminConfirm({ title: "Import vocabulary", message: "Import " + rows.length + " new vocabulary words from " + vocabImportFileName + "? Existing words will be skipped.", confirmText: "Import words" })) return;
  $("runVocabImport").disabled = true;
  $("validateVocabImport").disabled = true;
  let imported = 0;
  const failures = [];
  for (let index=0; index<rows.length; index++) {
    const item=rows[index];
    $("runVocabImport").textContent="Importing " + (index+1) + " of " + rows.length + "…";
    const {error}=await db.from("vocab_words").insert(item.record);
    if(error) {
      item.errors.push("Import failed: " + error.message);
      failures.push("Row " + item.rowNumber + ": " + error.message);
    } else {
      item.imported=true;
      imported++;
    }
    if(index%5===0) renderVocabImportPreview();
  }
  await loadVocabWords();
  renderVocabImportPreview();
  $("validateVocabImport").disabled=false;
  $("runVocabImport").textContent="Import remaining valid words";
  message("vocabImportStatus",imported + " words imported. " + failures.length + " rows failed. Review the preview for details.",failures.length===0);
}

$("newVocabWord").addEventListener("click",()=>{
  resetVocabForm();
  $("vocabWordDialog").showModal();
});
$("importVocab").addEventListener("click",()=>{
  vocabImportRows=[];
  vocabImportFileName="";
  $("vocabImportFile").value="";
  $("vocabImportSummary").hidden=true;
  $("vocabImportPreview").innerHTML="";
  $("runVocabImport").disabled=true;
  $("runVocabImport").textContent="Import valid words";
  message("vocabImportStatus","");
  $("importVocabDialog").showModal();
});
$("downloadVocabTemplate").addEventListener("click",downloadVocabCsvTemplate);
$("validateVocabImport").addEventListener("click",validateVocabImport);
$("runVocabImport").addEventListener("click",runVocabImport);
["vocabSearch","vocabDayFilter","vocabPublishFilter"].forEach(id=>{
  $(id).addEventListener(id==="vocabSearch"?"input":"change",renderVocabWords);
});

// ============================================================
// Dialog controls
// ============================================================

document.querySelectorAll("[data-close]").forEach(b => {
  b.onclick = () => $(b.dataset.close).close();
});

document.querySelectorAll(".tab").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll(".tab").forEach(x => {
      x.classList.toggle("selected", x === b);
    });

    ["lessons", "questions", "vocabulary"].forEach(id => {
      $(id).hidden = b.dataset.tab !== id;
    });
  };
});
