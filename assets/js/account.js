(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = id => document.getElementById(id);

  let pendingEmail = "";
  let pendingMode = "login";
  let pendingMetadata = null;

  function showMessage(message, error = false) {
    const box = $("accountMessage");
    box.hidden = !message;
    box.textContent = message;
    box.classList.toggle("error", error);
  }

  function setMode(mode) {
    $("loginForm").hidden = mode !== "login";
    $("registerForm").hidden = mode !== "register";
    $("loginTab").classList.toggle("active", mode === "login");
    $("registerTab").classList.toggle("active", mode === "register");
    $("accountForms").hidden = false;
    $("otpForm").hidden = true;
    showMessage("");
  }

  function collectRegistration() {
    const fields = [...document.querySelectorAll('input[name="studyField"]:checked')].map(input => input.value);
    if (!fields.length) {
      throw new Error("Select at least one further-study field: Economics or Mathematics.");
    }

    const profile = {
      name: $("regName").value.trim(),
      education: $("regEducation").value,
      age_range: $("regAge").value,
      country: $("regCountry").value.trim(),
      academic_background: $("regBackground").value,
      further_study: $("regFurtherStudy").value,
      further_study_fields: fields
    };

    if (profile.name.length < 2) throw new Error("Enter your full name.");
    if (!profile.country) throw new Error("Enter your country.");
    return profile;
  }

  async function sendCode(email, mode, metadata = null) {
    pendingEmail = email.trim().toLowerCase();
    pendingMode = mode;
    pendingMetadata = metadata;

    showMessage("Sending a one-time code to " + pendingEmail + "…");
    const options = {
      shouldCreateUser: mode === "register"
    };
    if (metadata) options.data = metadata;

    const { error } = await db.auth.signInWithOtp({
      email: pendingEmail,
      options
    });

    if (error) {
      showMessage(error.message, true);
      return false;
    }

    $("otpEmail").textContent = pendingEmail;
    $("otpCode").value = "";
    $("accountForms").hidden = true;
    $("otpForm").hidden = false;
    showMessage("A six-digit verification code has been sent. Check your inbox and spam folder.");
    $("otpCode").focus();
    return true;
  }

  $("loginTab").addEventListener("click", () => setMode("login"));
  $("registerTab").addEventListener("click", () => setMode("register"));

  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const email = $("loginEmail").value.trim();
    if (!email) return;
    await sendCode(email, "login");
  });

  $("registerForm").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const email = $("regEmail").value.trim();
      const metadata = collectRegistration();
      await sendCode(email, "register", metadata);
    } catch (error) {
      showMessage(error.message || "Please check the registration form.", true);
    }
  });

  $("otpForm").addEventListener("submit", async event => {
    event.preventDefault();
    const code = $("otpCode").value.trim();
    if (!/^[0-9]{6}$/.test(code)) {
      showMessage("Enter the six-digit code from your email.", true);
      return;
    }

    const button = $("otpForm").querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Verifying…";
    showMessage("Verifying your email code…");

    const { data, error } = await db.auth.verifyOtp({
      email: pendingEmail,
      token: code,
      type: "email"
    });

    button.disabled = false;
    button.textContent = "Verify and continue";

    if (error) {
      showMessage(error.message, true);
      return;
    }

    if (!data.session || !data.user) {
      showMessage("Email verification did not create a signed-in session. Request another code and try again.", true);
      return;
    }

    // Attach any guest mock attempts from this browser to the verified learner.
    // The server verifies auth.uid() before changing attempt ownership.
    const guestKey = localStorage.getItem("drillgre_guest_visitor_key_v1");
    if (guestKey) {
      const { error: claimError } = await db.rpc("claim_guest_mock_attempts", {
        p_visitor_key: guestKey
      });
      if (claimError) {
        showMessage("Your account is active, but previous guest attempts could not be attached to your dashboard. " + claimError.message, true);
      }
    }

    showMessage("Your email is verified. Opening your learner dashboard…");
    window.location.replace("dashboard.html");
  });

  $("resendOtp").addEventListener("click", async () => {
    if (!pendingEmail) return;
    await sendCode(pendingEmail, pendingMode, pendingMetadata);
  });

  $("changeEmail").addEventListener("click", () => {
    $("otpForm").hidden = true;
    $("accountForms").hidden = false;
    setMode(pendingMode);
    showMessage("Enter the email address you want to use.");
  });

  document.addEventListener("DOMContentLoaded", async () => {
    const { data } = await db.auth.getSession();
    if (data.session) window.location.replace("dashboard.html");
  });
})();