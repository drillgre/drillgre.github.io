# DrillGRE learner accounts and mock access

## Database setup order

Run these scripts in the Supabase SQL Editor in this exact order:

1. `gre-mock-tests.sql`
2. `learner-accounts.sql`
3. `learner-read-policies.sql`

The first script creates the mock tables, topic classification, question-use field, shared Data Analysis stimuli, and the mock selection and scoring functions.

The second script creates the learner profile fields and Auth user trigger, applies the guest attempt limit, ties mock attempts to the learner or guest browser key, and exposes the learner dashboard RPC.

The third script configures learner read access, protects question answers from direct client queries, and provides the admin-only question detail RPC used by the question editor.

These scripts are designed to be rerunnable. Run the full scripts in the stated order after code changes.

## Email and password authentication

Learners register with an email address and password. Supabase sends a six-digit OTP only to verify the email address during first-time registration. Returning learners sign in with email and password; sign-in does not send an OTP.

1. Open **Authentication → Providers → Email** and enable email sign-up and email confirmations.
2. Open **Authentication → Email Templates → Confirm signup**. Replace the confirmation-link variable `{{ .ConfirmationURL }}` with the OTP variable `{{ .Token }}`. This template is used to verify a new registration.
3. The **Magic Link** template is not used for ordinary sign-in. Password recovery uses the **Reset Password** template and a recovery link.

   **Subject**
   `Your DrillGRE verification code`

   **Email body**
   ```html
   <h2>Your DrillGRE verification code</h2>
   <p>Enter this six-digit code on the DrillGRE account page:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
   <p>This code expires in one hour. If you did not request it, you can ignore this email.</p>
   ```

4. Open **Authentication → URL Configuration**. Set **Site URL** to `https://drillgre.github.io`.
5. Under **Redirect URLs**, add the exact URL `https://drillgre.github.io/account.html`. Keep localhost only if you actively test locally.

The app calls `signUp` with the user's email and password. For first-time registration, it verifies the six-digit code with `verifyOtp` using `type: "signup"`. Returning learners use `signInWithPassword`. The Forgot password link sends a recovery email so a learner can set a new password.

## Learner registration fields

The registration form collects:

- Full name and email address
- Highest education
- Age range
- Country
- Academic background: one of ten categories, or Other
- Further study goal: PhD or Master's
- Intended field of study: one selection from ten fields, or Other

An Auth trigger copies these fields from Auth user metadata into `public.profiles`. The role is assigned as `learner`; it is not supplied by the browser.

## Mock access policy

- An authenticated learner can start unlimited mocks.
- A guest can start two mock attempts per persistent browser visitor key.
- The guest quota is checked and incremented in PostgreSQL. Clearing browser storage or using another browser can create a new guest key, so this is a practical guest limit rather than strong identity verification.
- Questions and shared Data Analysis groups are selected with no duplicates within an attempt. Selection also prioritises questions and groups used least by that learner or guest in the previous 60 days. Repeats may occur when the eligible pool is small.
- The mock scoring and answer review remain server-side. Direct anonymous question queries do not expose correct answers or explanations.

## Question-bank availability

Each question has a `question_usage` value:

- `mock`: available only to adaptive mocks
- `practice`: available only to lesson practice
- `both`: available to both

The adaptive generator selects only published questions marked `mock` or `both`. Lesson practice policies expose only published questions marked `practice` or `both`.

## Learner pages

- Account creation with email/password and email OTP verification, plus email/password sign-in: `/account.html`
- Learner dashboard and mock history: `/dashboard.html`
- Adaptive mock: `/quant/mock.html`
