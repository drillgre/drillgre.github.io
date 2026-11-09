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

Learners register with an email address and password. Supabase sends an email confirmation link to new users. The user clicks the link to activate the account. Returning learners sign in with email and password; sign-in does not require an OTP.

1. Open **Authentication → Sign In / Providers → Email**. Enable email sign-ups and **Confirm email**.
2. Keep the **Confirm signup** email template's default confirmation link, which uses `{{ .ConfirmationURL }}`. Do not replace it with `{{ .Token }}`, because this application uses a clickable confirmation link rather than a six-digit OTP.
3. Open **Authentication → URL Configuration**. Set **Site URL** to `https://drillgre.github.io`.
4. Under **Redirect URLs**, add the exact URL `https://drillgre.github.io/account.html`. Keep localhost only if you actively test locally.

The app calls `signUp` with the user's email and password and passes `account.html` as the confirmation redirect. After the user clicks the link, Supabase returns them to the account page; the app detects the new session and opens the learner dashboard. Returning learners use `signInWithPassword`. The Forgot password link sends a password-reset email.

**Email delivery note:** Supabase's built-in email service is for testing. It only sends to email addresses that belong to the project's organisation team and is limited to two emails per hour across the project. To allow registrations from the general public, configure a custom SMTP provider such as Resend before launch.

## Learner registration fields

The registration form collects:

- Full name and email address
- Highest education
- Age range
- Country
- Academic background: Engineering; Commerce and Business; Economics; Mathematics and Statistics; Computer Science and IT; Natural Sciences; Social Sciences; Humanities and Arts; Law; Medicine and Health Sciences; or Other
- Further study goal: PhD or Master's
- Field of study: Economics; Mathematics; Statistics; Finance; Business Administration; Public Policy; Development Studies; Computer Science; Data Science; Engineering; or Other

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

- Account creation with email/password and email-link confirmation, plus email/password sign-in: `/account.html`
- Learner dashboard and mock history: `/dashboard.html`
- Adaptive mock: `/quant/mock.html`
- Privacy-first public leaderboard: `/leaderboard.html` (learner opt-in required)
- Admin question-management workspace: `/admin.html` (requires `profiles.role = 'admin'`)


## Mock timing and leaderboard additions

The latest `learner-accounts.sql` file also adds question-level time recording and the opt-in public leaderboard. If you have already run an earlier version of `learner-accounts.sql`, run the latest version again after `gre-mock-tests.sql` to add the timing column, update the mock submission RPCs, and create the leaderboard functions.

The leaderboard is opt-in. The public page displays only the learner's first name, best completed DrillGRE mock score, and number of completed mocks. Email addresses and user IDs are not published.

The Quant mock uses standard GRE timing by default: 21 minutes for the first Quant section and 26 minutes for the second. Learners may select 50% extra time, double time, or untimed practice before starting. Question time is an estimate based on how long each question is visible while the test page is active.


## Bulk question import

The admin workspace includes **Import questions** in the Question bank tab. Sign in at `/admin.html` using your own administrator account. No credentials need to be shared with anyone.

Supported file formats are `.xlsx`, `.xls`, `.csv`, and `.json`. The importer previews rows, validates required fields and answer formats, checks existing questions for duplicates, and allows valid rows to be imported while invalid or duplicate rows are skipped. New questions default to unpublished unless the spreadsheet explicitly sets `published` to TRUE.

### Spreadsheet columns

Required columns:

- `topic`: readable label, such as Algebra or Number properties
- `topic_category`: `arithmetic`, `data_analysis`, `algebra`, or `geometry`
- `subtopic`: use the exact key for the selected category:
  - Arithmetic: `number_properties`, `fractions_decimals`, `percentages`, `ratios_proportions`, `exponents_roots`, `absolute_values`, `arithmetic_other`
  - Data Analysis: `data_interpretation`, `probability`, `counting`, `statistics`
  - Algebra: `algebra_core`, `inequalities`, `word_problems`
  - Geometry: `geometry`, `coordinate_geometry`
- `question_type`: `multiple_choice_single`, `multiple_choice_multiple`, `quantitative_comparison`, `numeric_entry`, or `data_interpretation`
- `difficulty`: integer from 1 through 5
- `question_text`: question prompt
- `correct_answer`: option label such as `B`, multiple labels such as `A,C`, a Quantitative Comparison answer `A` to `D`, or a numeric value for Numeric Entry

For ordinary multiple-choice questions, place answer choices in `option_a` through `option_f). For Quantitative Comparison, use `quantity_a` and `quantity_b). For Numeric Entry, use `numeric_answer` and optionally `numeric_tolerance`.

Other supported columns are `figure_url`, `explanation`, `explanation_type` (`text`, `video`, or `both`), `explanation_video_url`, `question_usage` (`mock`, `practice`, or `both`), `published` (TRUE or FALSE), `lesson_id` (optional UUID), and `stimulus_id` (optional existing shared-stimulus UUID).

For shared Data Interpretation groups, create the stimulus in the admin workspace first, then put its `stimulus_id` on each linked question. The database allows no more than three questions in a group and requires all linked questions to use the same lesson assignment. Import the three questions together or complete the group in separate imports.

Question figures must already be uploaded and reachable by a public HTTP/HTTPS URL. Use the existing single-question editor to upload figure files to Supabase Storage, or host them at a stable public image URL.

A JSON file may instead contain an array of question records using the database field names, including `options` and `correct_answer` as JSON arrays or objects.
