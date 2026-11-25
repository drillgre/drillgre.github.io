(() => {
  "use strict";
  const db = window.supabase.createClient(
    "https://aayzpcfryixauwsytphd.supabase.co",
    "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz"
  );
  const $ = id => document.getElementById(id);
  async function loadVocabularyProgress() {
    const [mastered, total, learning] = await Promise.all([
      db.from("vocab_word_progress").select("vocab_word_id", {count:"exact",head:true}).eq("status","know"),
      db.from("vocab_words").select("id", {count:"exact",head:true}).eq("is_published",true),
      db.from("vocab_word_progress").select("vocab_word_id", {count:"exact",head:true}).neq("status","know")
    ]);
    const status = $("vocabProgressStatus");
    if (mastered.error || total.error || learning.error || total.count == null) {
      status.textContent = "Vocabulary progress is temporarily unavailable.";
      $("vocabProgressPercent").textContent = "Progress unavailable";
      return;
    }
    const done = Number(mastered.count || 0);
    const all = Number(total.count || 0);
    const underway = Number(learning.count || 0);
    const remaining = Math.max(0, all - done);
    const pct = all ? Math.min(100, done / all * 100) : 0;
    $("vocabMastered").textContent = done.toLocaleString();
    $("vocabTotal").textContent = all.toLocaleString() + " total words";
    $("vocabLearning").textContent = underway.toLocaleString();
    $("vocabRemaining").textContent = remaining.toLocaleString();
    $("vocabProgressBar").style.width = pct + "%";
    $("vocabProgressPercent").textContent = pct.toFixed(1) + "% mastered";
    status.textContent = "Your mastered words are saved to your account and sync across devices.";
  }
  document.addEventListener("DOMContentLoaded", async () => {
    const {data} = await db.auth.getSession();
    if (data?.session) loadVocabularyProgress().catch(() => {
      const status = $("vocabProgressStatus");
      if (status) status.textContent = "Vocabulary progress is temporarily unavailable.";
    });
  });
})();