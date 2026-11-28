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

  function oauthCallbackUrl() {
    const url = new URL(accountPageUrl());
    url.searchParams.set("oauth_callback", "1");
    return url.toString();
  }

  const GOOGLE_CLIENT_ID = "945303545006-g3stkv8se32igo6u47ornfhojjkepgca.apps.googleusercontent.com";
  let googleRawNonce = null;
  let googleScriptPromise = null;

  function loadGoogleIdentityServices() {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (googleScriptPromise) return googleScriptPromise;

    googleScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        if (window.google?.accounts?.id) resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Google sign-in could not be loaded. Check your connection and try again."));
      document.head.appendChild(script);
    });
    return googleScriptPromise;
  }

  // SHA-256 fallback for browsers/contexts where Web Crypto's subtle API
  // is unavailable. The output is identical to crypto.subtle.digest("SHA-256").
  function sha256Fallback(message) {
    const K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    const bytes = Array.from(new TextEncoder().encode(message));
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    for (let i = 3; i >= 0; i--) bytes.push((high >>> (i * 8)) & 255);
    for (let i = 3; i >= 0; i--) bytes.push((low >>> (i * 8)) & 255);

    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Uint32Array(64);
    const rotr = (x,n) => (x >>> n) | (x << (32-n));

    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let i = 0; i < 16; i++) {
        const p = offset + i * 4;
        w[i] = ((bytes[p] << 24) | (bytes[p+1] << 16) | (bytes[p+2] << 8) | bytes[p+3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3);
        const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10);
        w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
      }

      let [a,b,c,d,e,f,g,h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        [h,g,f,e,d,c,b,a] = [g,f,e,(d+t1)>>>0,c,b,a,(t1+t2)>>>0];
      }
      H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
      H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
    }
    return H.map(value => value.toString(16).padStart(8,"0")).join("");
  }

  async function createGoogleNonce() {
    if (!window.crypto?.getRandomValues) {
      throw new Error("This browser cannot generate a secure sign-in nonce. Please use an up-to-date browser over HTTPS.");
    }
    const randomBytes = window.crypto.getRandomValues(new Uint8Array(32));
    const rawNonce = btoa(String.fromCharCode(...randomBytes));
    let hashedNonce;

    if (window.crypto.subtle?.digest) {
      const encodedNonce = new TextEncoder().encode(rawNonce);
      const digest = await window.crypto.subtle.digest("SHA-256", encodedNonce);
      hashedNonce = Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
    } else {
      hashedNonce = sha256Fallback(rawNonce);
    }

    return { rawNonce, hashedNonce };
  }

  async function handleGoogleCredential(response) {
    if (!response?.credential || !googleRawNonce) {
      showMessage("Google did not return a valid sign-in credential. Please try again.", true);
      return;
    }

    const rawNonce = googleRawNonce;
    googleRawNonce = null;
    showMessage("Verifying your Google account…");

    try {
      const { data, error } = await db.auth.signInWithIdToken({
        provider: "google",
        token: response.credential,
        nonce: rawNonce
      });
      if (error) throw error;
      await claimGuestAttemptsAndContinue(data.user);
    } catch (error) {
      showMessage(error.message || "Google sign-in failed. Please try again.", true);
      // A nonce is single-use. Prepare a fresh one for the next attempt.
      initializeGoogleSignIn().catch(() => {});
    }
  }

  async function initializeGoogleSignIn() {
    const host = $("googleSignInButton");
    if (!host) return;

    host.textContent = "Loading Google sign-in…";
    try {
      await loadGoogleIdentityServices();
      const { rawNonce, hashedNonce } = await createGoogleNonce();
      googleRawNonce = rawNonce;

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
        nonce: hashedNonce,
        ux_mode: "popup",
        auto_select: false
      });

      host.replaceChildren();
      window.google.accounts.id.renderButton(host, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: Math.min(Math.max(host.clientWidth || 440, 200), 440)
      });
    } catch (error) {
      host.textContent = "Google sign-in is temporarily unavailable.";
      showMessage(error.message || "Google sign-in could not be initialized.", true);
    }
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

  initializeGoogleSignIn();

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
    const isOAuthCallback = queryParams.get("oauth_callback") === "1";
    const isRecovery = queryParams.get("type") === "recovery"
      || hashParams.get("type") === "recovery"
      || (queryParams.has("code") && !isOAuthCallback);
    const authError = hashParams.get("error_description") || queryParams.get("error_description");

    if (authError) {
      showMessage(authError, true);
      return;
    }

    const { data } = await db.auth.getSession();
    if (data.session && (!isRecovery || isOAuthCallback)) {
      await claimGuestAttemptsAndContinue();
    }
  });
})();
