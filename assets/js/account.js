(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = id => document.getElementById(id);

  let pendingEmail = "";

  function postAuthDestination() {
    const requested = new URLSearchParams(window.location.search).get("redirect") || "";
    if (!requested || !requested.startsWith("/") || requested.startsWith("//") || requested.includes("\\")) {
      return "/dashboard.html";
    }
    const target = new URL(requested, window.location.origin);
    if (target.origin !== window.location.origin) return "/dashboard.html";
    return target.pathname + target.search + target.hash;
  }

  function accountPageUrl() {
    const url = new URL("account.html", window.location.href);
    const requested = new URLSearchParams(window.location.search).get("redirect");
    if (requested) url.searchParams.set("redirect", postAuthDestination());
    return url.toString();
  }

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
    $("confirmationPanel").hidden = true;
    $("resetPasswordForm").hidden = true;
    showMessage("");
  }

  function collectRegistration() {
    const profile = {
      name: $("regName").value.trim(),
      education: $("regEducation").value,
      age_range: $("regAge").value,
      country: $("regCountry").value.trim(),
      academic_background: $("regBackground").value,
      further_study: $("regFurtherStudy").value,
      further_study_field: $("regStudyField").value
    };

    if (profile.name.length < 2) throw new Error("Enter your full name.");
    if (!profile.country) throw new Error("Enter your country.");
    if (!profile.academic_background) throw new Error("Select your academic background.");
    if (!profile.further_study_field) throw new Error("Select your intended field of study.");
    return profile;
  }

  function showConfirmationPending(email, message = "") {
    pendingEmail = email;
    $("confirmationEmail").textContent = email;
    $("accountForms").hidden = true;
    $("resetPasswordForm").hidden = true;
    $("confirmationPanel").hidden = false;
    showMessage(message || "Your account has been created. Open the confirmation link sent to your email address to activate your account.");
  }

  async function resendConfirmationEmail() {
    if (!pendingEmail) return;
    const button = $("resendConfirmation");
    button.disabled = true;
    button.textContent = "Sending…";
    showMessage("Sending another confirmation email to " + pendingEmail + "…");

    const { error } = await db.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: { emailRedirectTo: accountPageUrl() }
    });

    button.disabled = false;
    button.textContent = "Resend confirmation email";

    if (error) {
      showMessage(error.message, true);
      return;
    }
    showMessage("A new confirmation email has been sent. Check your inbox and spam folder.");
  }

  async function claimGuestAttemptsAndContinue(user = null) {
    if (!user) {
      const { data } = await db.auth.getUser();
      user = data?.user || null;
    }

    if (user) {
      const { data: profile } = await db
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (profile?.role === "admin") {
        showMessage("Admin account recognised. Opening the admin workspace…");
        window.location.replace("/admin.html");
        return;
      }
    }

    const guestKey = localStorage.getItem("drillgre_guest_visitor_key_v1");
    if (guestKey) {
      const { error } = await db.rpc("claim_guest_mock_attempts", {
        p_visitor_key: guestKey
      });
      if (error) {
        showMessage("Your account is active, but previous guest attempts could not be attached to your dashboard. " + error.message, true);
        return;
      }
    }
    const destination = postAuthDestination();
    const isQuestionBank = destination.startsWith("/quant/question-bank.html");
    showMessage(isQuestionBank ? "Your account is ready. Opening the Question Bank…" : "Your account is ready. Opening your learner dashboard…");
    window.location.replace(destination);
  }

  $("loginTab").addEventListener("click", () => setMode("login"));
  $("registerTab").addEventListener("click", () => setMode("register"));

  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const email = $("loginEmail").value.trim().toLowerCase();
    const password = $("loginPassword").value;
    if (!email || !password) return;

    const button = $("loginForm").querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Signing in…";
    showMessage("Signing in to your DrillGRE account…");

    const { data, error } = await db.auth.signInWithPassword({ email, password });

    button.disabled = false;
    button.textContent = "Sign in";

    if (error) {
      if (/email not confirmed/i.test(error.message)) {
        showConfirmationPending(email, "Your email address has not been confirmed. Use the button below to resend the confirmation link.");
        return;
      }
      showMessage(error.message, true);
      return;
    }

    await claimGuestAttemptsAndContinue(data.user);
  });

  $("registerForm").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const email = $("regEmail").value.trim().toLowerCase();
      const password = $("regPassword").value;
      const confirmPassword = $("regPasswordConfirm").value;
      const metadata = collectRegistration();

      if (password.length < 8) {
        throw new Error("Use a password with at least 8 characters.");
      }
      if (password !== confirmPassword) {
        throw new Error("The two passwords do not match.");
      }

      const button = $("registerForm").querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = "Creating account…";
      showMessage("Creating your account and sending a confirmation email…");

      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: accountPageUrl(),
          data: metadata
        }
      });

      button.disabled = false;
      button.textContent = "Create account and send confirmation email";

      if (error) {
        showMessage(error.message, true);
        return;
      }

      if (data.session && data.user) {
        await claimGuestAttemptsAndContinue();
        return;
      }

      if (!data.user) {
        showMessage("The account could not be created. Please try again.", true);
        return;
      }

      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        showMessage("An account with this email may already exist. Sign in instead, or use Forgot password if you need to set or reset its password.", true);
        return;
      }

      showConfirmationPending(email);
    } catch (error) {
      showMessage(error.message || "Please check the registration form.", true);
    }
  });

  $("resendConfirmation").addEventListener("click", resendConfirmationEmail);

  $("changeRegistrationEmail").addEventListener("click", () => {
    $("confirmationPanel").hidden = true;
    $("accountForms").hidden = false;
    setMode("register");
    showMessage("You can change the email address in the registration form.");
  });

  $("forgotPassword").addEventListener("click", async () => {
    const email = $("loginEmail").value.trim().toLowerCase();
    if (!email) {
      showMessage("Enter your email address first, then select Forgot password.", true);
      $("loginEmail").focus();
      return;
    }
    showMessage("Sending a password-reset email to " + email + "…");
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: accountPageUrl()
    });
    if (error) {
      showMessage(error.message, true);
      return;
    }
    showMessage("A password-reset link has been sent. Open it in this browser, then choose a new password.");
  });

  $("resetPasswordForm").addEventListener("submit", async event => {
    event.preventDefault();
    const password = $("newPassword").value;
    const confirmPassword = $("newPasswordConfirm").value;
    if (password.length < 8) {
      showMessage("Use a password with at least 8 characters.", true);
      return;
    }
    if (password !== confirmPassword) {
      showMessage("The two passwords do not match.", true);
      return;
    }

    const button = $("resetPasswordForm").querySelector('button[type="submit"]');
    button.disabled = true;
    const { data, error } = await db.auth.updateUser({ password });
    button.disabled = false;
    if (error) {
      showMessage(error.message, true);
      return;
    }
    showMessage("Your password has been updated. Opening your account workspace…");
    await claimGuestAttemptsAndContinue(data.user);
  });

  db.auth.onAuthStateChange(async event => {
    if (event === "PASSWORD_RECOVERY") {
      $("accountForms").hidden = true;
      $("confirmationPanel").hidden = true;
      $("resetPasswordForm").hidden = false;
      showMessage("Choose a new password for your DrillGRE account.");
    }
  });

  document.addEventListener("DOMContentLoaded", async () => {
    const queryParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const isRecovery = queryParams.get("type") === "recovery"
      || hashParams.get("type") === "recovery"
      || queryParams.has("code");
    const authError = hashParams.get("error_description") || queryParams.get("error_description");

    if (authError) {
      showMessage(authError, true);
      return;
    }

    const { data } = await db.auth.getSession();
    if (data.session && !isRecovery) {
      await claimGuestAttemptsAndContinue();
    }
  });
})();
