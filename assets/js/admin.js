import { Editor } from "https://cdn.jsdelivr.net/npm/@tiptap/core@3.31.3/+esm";
import StarterKit from "https://cdn.jsdelivr.net/npm/@tiptap/starter-kit@3.31.3/+esm";
import { Mathematics } from "https://cdn.jsdelivr.net/npm/@tiptap/extension-mathematics@3.31.3/+esm";

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
let lessonEditor = null;
let stimulusFigureUrl = null;
let stimulusGroupsCache = [];

const typeNames = {
  quantitative_comparison: "Quantitative Comparison",
  multiple_choice_single: "Multiple Choice: Single Answer",
  multiple_choice_multiple: "Multiple Choice: Multiple Answers",
  numeric_entry: "Numeric Entry",
  data_interpretation: "Data Interpretation"
};

const categorySubtopics = {
  arithmetic: [
    ["number_properties", "Number properties"],
    ["fractions_decimals", "Fractions and decimals"],
    ["percentages", "Percentages"],
    ["ratios_proportions", "Ratios and proportions"],
    ["exponents_roots", "Exponents and roots"],
    ["absolute_values", "Absolute values"],
    ["arithmetic_other", "Other arithmetic"]
  ],
  data_analysis: [
    ["data_interpretation", "Data interpretation"],
    ["probability", "Probability"],
    ["counting", "Counting, permutations and combinations"],
    ["statistics", "Statistics"]
  ],
  algebra: [
    ["algebra_core", "Equations and functions"],
    ["inequalities", "Inequalities"],
    ["word_problems", "Word problems"]
  ],
  geometry: [
    ["geometry", "Geometry"],
    ["coordinate_geometry", "Coordinate geometry"]
  ]
};
const categoryLabels = {
  arithmetic: "Arithmetic",
  data_analysis: "Data Analysis",
  algebra: "Algebra",
  geometry: "Geometry"
};

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
  $("who").textContent = u.email || "Admin";

  await Promise.all([
    loadLessons(),
    loadQuestions(),
    loadLessonOptions(),
    loadStimulusGroups()
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
  await db.auth.signOut();

  user = null;

  $("dashboard").hidden = true;
  $("login").hidden = false;
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

function initLessonEditor() {
  if (lessonEditor) return;

  lessonEditor = new Editor({
    element: $("lessonEditor"),
    extensions: [
      StarterKit,
      Mathematics.configure({
        katexOptions: { throwOnError: false }
      })
    ],
    content: "<h2>Lesson introduction</h2><p>Start writing your lesson here.</p>",
    onSelectionUpdate: updateLessonToolbar,
    onTransaction: updateLessonToolbar
  });

  $("lessonToolbar").querySelectorAll("[data-editor-command]").forEach(button => {
    button.addEventListener("click", () => {
      if (!lessonEditor) return;

      const command = button.dataset.editorCommand;
      let chain = lessonEditor.chain().focus();

      if (command === "heading") {
        chain.toggleHeading({ level: Number(button.dataset.level) }).run();
      } else if (command === "undo" || command === "redo") {
        chain[command]().run();
      } else {
        const method = "toggle" + command.charAt(0).toUpperCase() + command.slice(1);
        if (typeof chain[method] === "function") chain[method]().run();
      }

      updateLessonToolbar();
    });
  });

  $("insertInlineMath").addEventListener("click", () => {
    const latex = window.prompt("Enter the LaTeX formula (without dollar signs):", "\\frac{a}{b}");
    if (latex && latex.trim()) {
      lessonEditor.chain().focus().insertInlineMath({ latex: latex.trim() }).run();
    }
  });

  $("insertBlockMath").addEventListener("click", () => {
    const latex = window.prompt("Enter the LaTeX equation (without dollar signs):", "\\frac{a}{b}");
    if (latex && latex.trim()) {
      lessonEditor.chain().focus().insertBlockMath({ latex: latex.trim() }).run();
    }
  });
}

function updateLessonToolbar() {
  if (!lessonEditor) return;

  $("lessonToolbar").querySelectorAll("[data-editor-command]").forEach(button => {
    const command = button.dataset.editorCommand;
    let active = false;

    if (command === "bold" || command === "italic" || command === "blockquote" ||
        command === "bulletList" || command === "orderedList" || command === "codeBlock") {
      const name = command === "bold" ? "bold"
        : command === "italic" ? "italic"
        : command === "blockquote" ? "blockquote"
        : command === "bulletList" ? "bulletList"
        : command === "orderedList" ? "orderedList"
        : "codeBlock";
      active = lessonEditor.isActive(name);
    } else if (command === "heading") {
      active = lessonEditor.isActive("heading", { level: Number(button.dataset.level) });
    }

    button.classList.toggle("active", active);
  });
}

function setLessonEditorContent(content) {
  initLessonEditor();

  let html = "<p></p>";
  if (content && typeof content === "object" && typeof content.html === "string") {
    html = content.html;
  } else if (content && typeof content === "object" && typeof content.markdown === "string") {
    html = legacyMarkdownToHtml(content.markdown);
  } else if (typeof content === "string") {
    html = legacyMarkdownToHtml(content);
  }

  lessonEditor.commands.setContent(html);
  updateLessonToolbar();
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

  $("lessonList").innerHTML = lessonsCache.length
    ? lessonsCache.map(l => `
      <div class="entry">
        <div>
          <strong>${esc(l.title)}</strong>
          <div class="meta">
            ${esc(l.modules?.title || "Module")}
            · ${l.published ? "Published" : "Draft"}
            · order ${l.sort_order}
            ${l.content?.video_url ? " · YouTube video" : ""}
          </div>
        </div>
        <div class="buttons">
          <button type="button" data-edit="${l.id}">Edit</button>
          <button type="button" data-pub="${l.id}">
            ${l.published ? "Unpublish" : "Publish"}
          </button>
          <button type="button" class="del" data-del="${l.id}">Delete</button>
        </div>
      </div>
    `).join("")
    : "<p>No lessons yet. Create your first lesson.</p>";

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
  setLessonEditorContent({ html: "<h2>Lesson introduction</h2><p></p>" });
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
    alert(error.message);
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

  if (!lessonEditor) {
    message("lessonMsg", "The lesson editor has not loaded. Refresh and try again.");
    return;
  }

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

  const html = lessonEditor.getHTML();
  const textContent = lessonEditor.getText().trim();
  if (!textContent && !html.includes("data-type=\"block-math\"")) {
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

  if (result.error) alert(result.error.message);
  else await loadLessons();
}

async function deleteLesson(id) {
  if (!confirm("Delete this lesson?")) return;

  const result = await db
    .from("lessons")
    .delete()
    .eq("id", id);

  if (result.error) alert(result.error.message);
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
    db.from("questions").select("stimulus_id").not("stimulus_id", "is", null)
  ]);

  if (groupsResult.error) {
    select.innerHTML = '<option value="">No shared stimulus (standalone question)</option>';
    message("stimulusMsg", groupsResult.error.message);
    return;
  }

  const counts = {};
  (linksResult.data || []).forEach(row => {
    if (row.stimulus_id) counts[row.stimulus_id] = (counts[row.stimulus_id] || 0) + 1;
  });

  stimulusGroupsCache = groupsResult.data || [];
  select.innerHTML = '<option value="">No shared stimulus (standalone question)</option>' +
    stimulusGroupsCache.map(group => {
      const count = counts[group.id] || 0;
      return `<option value="${esc(group.id)}">${esc(group.title)} · ${count}/3 questions linked</option>`;
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

  if (file.size > 5 * 1024 * 1024) {
    message("stimulusMsg", "The shared figure must be smaller than 5 MB.");
    $("stimulusFigure").value = "";
    return;
  }

  $("stimulusFigurePreview").textContent = "Uploading shared figure…";
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
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

  if (file.size > 5 * 1024 * 1024) {
    message("questionMsg", "Figure must be smaller than 5 MB.");

    $("figure").value = "";

    return;
  }

  $("preview").textContent = "Uploading…";

  const ext = (file.name.split(".").pop() || "png")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

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

async function loadQuestions() {
  const { data, error } = await db
    .from("questions")
    .select("id,topic,topic_category,subtopic,stimulus_id,question_type,difficulty,question_text,published")
    .order("created_at", { ascending: false });

  if (error) {
    $("questionList").textContent = error.message;
    return;
  }

  const search = $("search").value.toLowerCase();
  const type = $("typeFilter").value;
  const level = $("levelFilter").value;

  const rows = (data || []).filter(x =>
    (!search ||
      (x.topic + " " + x.question_text)
        .toLowerCase()
        .includes(search)) &&
    (!type || x.question_type === type) &&
    (!level || String(x.difficulty) === level)
  );

  $("questionList").innerHTML = rows.length
    ? rows.map(x => `
      <div class="entry">
        <div>
          <strong>
            ${esc(categoryLabels[x.topic_category] || x.topic_category || "Unclassified")} · ${esc((x.subtopic || "").replaceAll("_"," "))} · Level ${x.difficulty}
          </strong>

          <div class="meta">
            ${esc(typeNames[x.question_type] || x.question_type)}
            · ${x.stimulus_id ? "Shared stimulus group" : "Standalone"}
            · ${x.published ? "Published" : "Draft"}
            · ${esc(x.question_text.slice(0, 130))}
          </div>
        </div>

        <div class="buttons">
          <button data-qedit="${x.id}">Edit</button>

          <button
            data-qpub="${x.id}"
            data-published="${x.published}">
            ${x.published ? "Unpublish" : "Publish"}
          </button>

          <button class="del" data-qdel="${x.id}">
            Delete
          </button>
        </div>
      </div>
    `).join("")
    : "<p>No matching questions.</p>";

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
}

["search", "typeFilter", "levelFilter"].forEach(id => {
  $(id).addEventListener(
    id === "search" ? "input" : "change",
    loadQuestions
  );
});


// ============================================================
// Edit question
// ============================================================

async function editQuestion(id) {
  const { data, error } = await db
    .from("questions")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    alert(error.message);
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
    alert(result.error.message);
  } else {
    await loadQuestions();
  }
}

async function deleteQuestion(id) {
  if (!confirm("Delete this question?")) return;

  const result = await db
    .from("questions")
    .delete()
    .eq("id", id);

  if (result.error) {
    alert(result.error.message);
  } else {
    await Promise.all([loadQuestions(), loadStimulusGroups()]);
  }
}


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

    $("lessons").hidden = b.dataset.tab !== "lessons";
    $("questions").hidden = b.dataset.tab !== "questions";
  };
});
