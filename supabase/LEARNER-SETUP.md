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

## Email OTP configuration

The account page uses Supabase email OTP, not passwords.

In Supabase Authentication settings:

- Enable email sign-in and email confirmations.
- Open the **Magic Link or OTP** email template. Replace the confirmation-link variable `{{ .ConfirmationURL }}` with the OTP variable `{{ .Token }}`, and include that token in the email body. This makes Supabase send a six-digit code instead of a magic link.
- Set the site URL to `https://drillgre.github.io`.
- Add the deployed site and any local development URL to the allowed redirect URLs if you use redirect-based email flows elsewhere.

The app calls `signInWithOtp` and then `verifyOtp` with `type: "email"`. Supabase's default email OTP limit is one request per 60 seconds, and codes expire after one hour unless those project settings are changed.

## Learner registration fields

The registration form collects:

- Full name and email address
- Highest education
- Age range
- Country
- Academic background: Engineering, Commerce, Economics, or Mathematics
- Further study goal: PhD or Master's
- Further study fields: Economics and/or Mathematics

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

- Account creation and email OTP sign-in: `/account.html`
- Learner dashboard and mock history: `/dashboard.html`
- Adaptive mock: `/quant/mock.html`
