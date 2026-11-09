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
    .select("id,topic,topic_category,subtopic,stimulus_id,question_type,difficulty,question_usage,question_text,published")
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
            · ${x.question_usage === "mock" ? "Mock only" : x.question_usage === "practice" ? "Practice only" : "Mock + practice"}
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
  const { data, error } = await db.rpc("admin_get_question", {
    p_question_id: String(id)
  });

  if (error || !data) {
    alert(error?.message || "Question details could not be loaded.");
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
  const subtopic = importText(row.subtopic).toLowerCase();
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
    correct = typeof rawAnswer === "number" ? String(rawAnswer) : importText(rawAnswer);
  }

  if (type === "quantitative_comparison") {
    const qa = importText(row.quantity_a);
    const qb = importText(row.quantity_b);
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

function downloadQuestionCsvTemplate() {
  const headers = [
    "topic","topic_category","subtopic","question_type","difficulty","question_text",
    "option_a","option_b","option_c","option_d","option_e","option_f",
    "quantity_a","quantity_b","correct_answer","numeric_answer","numeric_tolerance",
    "figure_url","explanation","explanation_type","explanation_video_url",
    "question_usage","published","lesson_id","stimulus_id"
  ];
  const csv = headers.join(",") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "drillgre-question-import-template.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function readQuestionImportFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) throw new Error("JSON import must be an array of question records.");
    return parsed;
  }

  if (!window.XLSX) throw new Error("The spreadsheet reader could not load. Refresh the admin page and try again.");
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("The workbook does not contain a worksheet.");
  return window.XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: false });
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
  if (!confirm("Import " + rows.length + " questions from " + questionImportFileName + "? Existing and invalid rows will be skipped.")) return;

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
$("validateQuestionImport").addEventListener("click", validateQuestionImport);
$("runQuestionImport").addEventListener("click", runQuestionImport);

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
