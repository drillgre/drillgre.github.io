(() => {
  "use strict";

  const SUPABASE_URL = "https://aayzpcfryixauwsytphd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = id => document.getElementById(id);

  let pendingEmail = "";
  let passwordToSetAfterOtp = "";

  function accountPageUrl() {
    return new URL("account.html", window.location.href).toString();
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
    $("otpForm").hidden = true;
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

  function showSignupOtp(email) {
    pendingEmail = email;
    $("otpEmail").textContent = email;
    $("otpCode").value = "";
    $("accountForms").hidden = true;
    $("resetPasswordForm").hidden = true;
    $("otpForm").hidden = false;
    showMessage("A six-digit email verification code has been sent. Enter it below to activate your account.");
    $("otpCode").focus();
  }

  async function resendSignupOtp() {
    if (!pendingEmail) return;
    showMessage("Sending another verification code to " + pendingEmail + "…");
    const { error } = await db.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: { emailRedirectTo: accountPageUrl() }
    });
    if (error) {
      showMessage(error.message, true);
      return;
    }
    showMessage("A new six-digit verification code has been sent. Check your inbox and spam folder.");
  }

  async function claimGuestAttemptsAndContinue() {
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
    showMessage("Your account is ready. Opening your learner dashboard…");
    window.location.replace("dashboard.html");
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

    const { error } = await db.auth.signInWithPassword({ email, password });

    button.disabled = false;
    button.textContent = "Sign in";

    if (error) {
      if (/email not confirmed/i.test(error.message)) {
        pendingEmail = email;
        showMessage("Your email address has not been verified. Sending a verification code…");
        const { error: resendError } = await db.auth.resend({
          type: "signup",
          email,
          options: { emailRedirectTo: accountPageUrl() }
        });
        if (resendError) {
          showMessage(error.message + " " + resendError.message, true);
        } else {
          showSignupOtp(email);
        }
        return;
      }
      showMessage(error.message, true);
      return;
    }

    await claimGuestAttemptsAndContinue();
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
      showMessage("Creating your account and sending an email verification code…");

      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: accountPageUrl(),
          data: metadata
        }
      });

      button.disabled = false;
      button.textContent = "Create account and send verification code";

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

      // Older test registrations may already have created an Auth user
      // through the previous OTP-only flow. Resend its signup code and set
      // the password after verification so the learner can use password login.
      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        pendingEmail = email;
        passwordToSetAfterOtp = password;
        const { error: resendError } = await db.auth.resend({
          type: "signup",
          email,
          options: { emailRedirectTo: accountPageUrl() }
        });
        if (resendError) {
          showMessage("An account with this email may already exist. Try Sign in and use Forgot password to set a password. " + resendError.message, true);
          return;
        }
        showSignupOtp(email);
        return;
      }

      passwordToSetAfterOtp = "";
      showSignupOtp(email);
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
    showMessage("Verifying your email address…");

    const { data, error } = await db.auth.verifyOtp({
      email: pendingEmail,
      token: code,
      type: "email"
    });

    button.disabled = false;
    button.textContent = "Verify email and continue";

    if (error) {
      showMessage(error.message, true);
      return;
    }

    if (!data.session || !data.user) {
      showMessage("Email verification did not create a signed-in session. Request another code and try again.", true);
      return;
    }

    if (passwordToSetAfterOtp) {
      const { error: passwordError } = await db.auth.updateUser({ password: passwordToSetAfterOtp });
      passwordToSetAfterOtp = "";
      if (passwordError) {
        showMessage("Your email is verified, but the password could not be saved. Use Forgot password to set it. " + passwordError.message, true);
        return;
      }
    }

    await claimGuestAttemptsAndContinue();
  });

  $("resendOtp").addEventListener("click", resendSignupOtp);

  $("changeEmail").addEventListener("click", () => {
    $("otpForm").hidden = true;
    $("accountForms").hidden = false;
    setMode("register");
    showMessage("Return to registration to change the email address.");
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
    const { error } = await db.auth.updateUser({ password });
    button.disabled = false;
    if (error) {
      showMessage(error.message, true);
      return;
    }
    showMessage("Your password has been updated. Opening your learner dashboard…");
    window.location.replace("dashboard.html");
  });

  db.auth.onAuthStateChange(async event => {
    if (event === "PASSWORD_RECOVERY") {
      $("accountForms").hidden = true;
      $("otpForm").hidden = true;
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
    const { data } = await db.auth.getSession();
    if (data.session && !isRecovery) {
      window.location.replace("dashboard.html");
    }
  });
})();
