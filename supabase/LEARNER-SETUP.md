# DrillGRE learner accounts and mock access

## Database setup order

Run these scripts in the Supabase SQL Editor in this exact order:

1. `gre-mock-tests.sql`
2. `learner-accounts.sql`
3. `learner-read-policies.sql`
4. `topic-quiz.sql`
5. `quiz-progress.sql`
6. `question-bank-progress.sql`
7. `question-bank-diagnostics.sql`
8. `vocab-mountain.sql`
9. `vocab-word-progress.sql`
10. `security-hardening.sql`
11. `question-bank-public-count.sql`
12. `question-bank-bookmarks-superquiz.sql`

The first script creates the mock tables, topic classification, question-use field, shared Data Analysis stimuli, and the mock selection and scoring functions.

The second script creates the learner profile fields and Auth user trigger, applies the guest attempt limit, ties mock attempts to the learner or guest browser key, and exposes the learner dashboard RPC.

The third script configures learner read access, protects question answers from direct client queries, and provides the admin-only question detail RPC used by the question editor.

These scripts are designed to be rerunnable. Run the full scripts in the stated order after code changes. The sixth script adds authenticated Question Bank progress, the learner dashboard count, and leaderboard participation counts. The seventh script distinguishes correctly answered questions from items that need review and adds first-attempt diagnostics. The eighth script creates the Vocab Mountain vocabulary table and admin-only content-management policies. The ninth script adds each learner's vocabulary classifications. The tenth script locks profile writes to trusted database functions and restricts question-figure uploads to admins, including a restrictive RLS layer that blocks broader legacy write policies for this bucket. The eleventh script exposes only the aggregate count of published practice questions to visitors. The twelfth script adds private learner bookmarks, aggregate question-attempt counts, and Superquiz support through the persistent quiz engine.
The thirteenth script adds Word Archery scoring, account-level points, streak bonuses, answer attempts, and success-rate statistics.

## Production security checklist

Run `security-hardening.sql` after the other nine database scripts. It removes direct browser-side profile write access, restricts profile reads to the signed-in owner, disables public-schema object creation for client roles, and restricts the public question-figure bucket to administrator uploads. The figure bucket remains public-read so published question images can display without a learner account.

The browser contains only the Supabase **publishable** key. This key is expected to be public and is not an administrator credential. Never put a Supabase `service_role` key, secret key, database password, or personal access token in HTML, JavaScript, GitHub, or any client download.

Before opening registration to the public, review these project settings in the Supabase Dashboard:

1. **Authentication → URL Configuration:** keep the Site URL at `https://drillgre.github.io` and keep the redirect allow-list limited to the account confirmation and recovery URLs actually used by the site.
2. **Authentication → Sign In / Providers:** keep email confirmation enabled. Set a strong password policy, use at least 12 characters where feasible, and enable leaked-password protection if available on your plan. Coordinate any policy change with existing learners.
3. **Authentication → Rate Limits and CAPTCHA:** review sign-up, password recovery, and token-endpoint rate limits. Enable CAPTCHA/bot protection if the project is exposed to public sign-ups.
4. **Admin accounts:** use unique long passwords and enable MFA for every administrator where supported. Do not share admin accounts. Assign `profiles.role = 'admin'` manually only to trusted accounts.
5. **Database → Advisors / Security:** review RLS and exposed-schema warnings after each migration. Test with a separate learner account and a signed-out browser. A learner must not be able to alter a profile role, edit questions, upload figures, or read another learner's private progress.
6. **Storage → Policies:** check for older broad policies on `storage.objects`. PostgreSQL policies are permissive by default when combined, so any old policy that allows all authenticated users to write to every bucket can override the narrow question-figure policies in the new migration. Remove broad write policies for `question-figures`.

GitHub Pages serves the static site over HTTPS, but it does not provide a repository-level mechanism for configuring arbitrary HTTP response security headers. The account, dashboard, admin, and quiz pages now use a no-referrer policy as a browser-side safeguard. For full Content-Security-Policy, frame protection, HSTS, and other response headers, put the site behind a host or proxy that can set HTTP headers. Cloudflare Pages supports a `_headers` file for this purpose.

These changes reduce common exposure and privilege-escalation risks. They do not make any public website impossible to attack. Keep Supabase, dependencies, and access policies updated, and review logs for unusual activity.

## Public Question Bank count

Run `question-bank-public-count.sql` after `security-hardening.sql`. Visitors who are not signed in can see the total number of published questions marked **Practice** or **Both**. This RPC returns only an integer count. The Question Bank list, question-opening controls, completion summary, and diagnostics remain available only after sign-in.

## Question Bank bookmarks, attempt counts, and Superquiz

Run `question-bank-bookmarks-superquiz.sql` after `question-bank-public-count.sql`. It adds:

- A bookmark list private to each signed-in learner, with row-level security preventing access to another learner's saved questions.
- A **Bookmarked only** filter and bookmark controls on Question Bank cards and full-question views.
- A total attempt count on each question. This counts Question Bank submissions and answered questions in completed topic quizzes and Superquizzes. It is an aggregate only; learner identities and answer details are never exposed.
- A **Superquiz** panel on Quant → Quiz. Every bookmarked question enters the learner's Superquiz collection. Learners can assess all saved questions when there are 50 or fewer, or choose a session of up to 50 questions when the collection is larger.
- Timed, extra-time, double-time, and untimed Superquiz sessions using the same autosave, resume, results, and answer-review engine as topic quizzes. Superquiz attempts appear in **Your quizzes**.

The database verifies that every question selected for a Superquiz is currently published, available for practice, and bookmarked by the signed-in learner. The attempt-count ledger begins collecting records after this migration is applied; earlier attempts cannot be reconstructed reliably.

## Word Archery

Run `word-archery.sql` after `vocab-mountain.sql` and `security-hardening.sql`. Word Archery uses published Vocab Mountain words and validates either synonyms or short meanings. Signed-in learners have points, attempts, streaks, and success rates saved to their accounts. Guests can play with statistics stored only in the current browser. Correct answers earn 10 points, with a 5-point bonus on every third consecutive correct answer. The page includes timed rounds, three lives, animated opponent/player arrows, and an optional full-screen arena.

## Vocab Mountain content management

Run `vocab-mountain.sql` in the Supabase SQL Editor. It creates or updates the `vocab_words` table, including the `category` field immediately after `word`. Public visitors can read published vocabulary without querying the protected `profiles` table. Authenticated learners can read published words; administrators can also read drafts and manage vocabulary.

In the Admin workspace, select **Vocab Mountain**. Administrators can:

- Add or edit a word using the entry form, with day, serial number, up to three meanings, synonyms, and up to three examples.
- Import a CSV or Excel workbook after previewing the rows and validation results.
- See and skip duplicate words rather than replacing existing entries.
- Publish, unpublish, or delete entries.

CSV columns are \`day\`, \`sn\`, \`word\`, \`category\`, \`meaning1\`, \`meaning2\`, \`meaning3\`, \`synonyms\`, \`example1\`, \`example2\`, \`example3\`, and \`is_published\`. Only \`day\`, \`word\`, and at least one meaning are required; \`category\` is optional. Download the template from the Admin workspace or use [the CSV template](../templates/drillgre-vocabulary-template.csv).

Vocab Mountain reads published words directly from Supabase and displays each word's category. Guests can browse, search, and study vocabulary, but their progress is not saved and the learning tracker is unavailable until they sign in. Signed-in learners can classify words as **Nailed It** (green), **Revisit** (orange), or **New to Me** (red). These classifications are saved to Supabase and synced across devices. Unclassified cards remain white in the **All** view.


## Email and password authentication

Learners register with an email address and password. Supabase sends an email confirmation link to new users. The user clicks the link to activate the account. Returning learners sign in with email and password; sign-in does not require an OTP.

1. Open **Authentication → Sign In / Providers → Email**. Enable email sign-ups and **Confirm email**.
2. Keep the **Confirm signup** email template's default confirmation link, which uses `{{ .ConfirmationURL }}`. Do not replace it with `{{ .Token }}`, because this application uses a clickable confirmation link rather than a six-digit OTP.
3. Open **Authentication → URL Configuration**. Set **Site URL** to `https://drillgre.github.io`.
4. Under **Redirect URLs**, add `https://drillgre.github.io/account.html` and `https://drillgre.github.io/account.html**`. The wildcard entry preserves the return destination query string when a learner signs up from the protected Question Bank and confirms their email. Keep localhost only if you actively test locally.

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


## Authenticated Question Bank and completion tracking

The Quant → Question Bank page is available only to signed-in learners. Guests are directed to sign in or create an account before question content is loaded.

Run \`question-bank-progress.sql\` after \`quiz-progress.sql\`, then run \`question-bank-diagnostics.sql\`. The diagnostics migration updates the Question Bank tracking logic and adds:

- Per-learner, persistent completion records for Question Bank items.
- A server-side grading RPC that marks a correctly answered item Done and an incorrect answer Review.
- A progress RPC that returns each question's status, attempt count, and first-attempt result.
- A diagnostics RPC showing questions attempted by difficulty and first-attempt success rates.
- A Question Bank completion total in the learner dashboard.
- A completed Question Bank question count on the opt-in public leaderboard.

A Question Bank item is marked Done only when the submitted answer is correct. An incorrect answer is marked Review and remains available for another attempt. The latest status is saved to the learner's account and remains visible on later visits and across devices. First-attempt correctness is retained for diagnostics. Older submissions made before the diagnostics migration are conservatively set to Review because their original correctness was not stored. Leaderboard ranking continues to prioritise the best completed mock score; completed topic quizzes and Question Bank items provide additional participation tie-breakers.

The Question Bank listing shows an excerpt. Selecting **Open full question** opens the complete question in a lightbox. Figures are displayed only when a usable figure is provided; questions without figures do not display empty image placeholders. Correct answers and explanations are returned only after the signed-in learner submits an answer.


## Bulk question import

The admin workspace includes **Import questions** in the Question bank tab. Sign in at `/admin.html` using your own administrator account. No credentials need to be shared with anyone. A blank [CSV template](../templates/drillgre-question-import-template.csv) is also available in the repository.

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

Question figures must already be uploaded and reachable by a public HTTP/HTTPS URL. Use the existing single-question editor to upload figure files to Supabase Storage, or host them at a stable public image URL. The spreadsheet importer does not extract images embedded inside Excel cells.

A JSON file may instead contain an array of question records using the database field names, including `options` and `correct_answer` as JSON arrays or objects.


## Topic and subtopic quizzes

The Quant navigation has separate Lessons and Quiz pages. The Quiz page includes a topic-quiz builder. Learners can select multiple GRE categories and subtopics, choose a quiz length from 10 to 15 questions, and receive a random set from the published practice bank. All supported question formats are used, including Quantitative Comparison, single-answer, multiple-answer, numeric-entry, and Data Interpretation questions.

Topic quizzes show a simple correct-answer count and answer review. They do not calculate the mock-test 130–170 practice scale.

The learner selects the quiz timing option in Quant Academy. The quiz opens in a new browser tab with a GRE-style test interface, question navigation, Mark for Review, a countdown timer, and a final review screen. Standard timing follows the mock-test pace: 21 minutes for up to 12 questions and 26 minutes for 15 questions, scaled proportionally for other quiz lengths. The 50% extra-time, double-time, and untimed options are also available. The timer and answers are retained within the tab if the learner refreshes the page.

Run `topic-quiz.sql` after the three core setup scripts. It enables published practice stimulus groups to be read on the topic quiz page and creates the `grade_gre_quiz_question` RPC. Correct answers and explanations are returned by this RPC only after each learner submits the quiz.


## Persistent topic quizzes, lesson progress, and leaderboard participation

Run `quiz-progress.sql` after `topic-quiz.sql`. It adds:

- Two free guest topic quiz attempts per browser visitor key, enforced in PostgreSQL. Starting a quiz uses one allowance even when the quiz is left unfinished.
- Unlimited topic quiz attempts for signed-in learners.
- Server-side quiz attempt snapshots, answer autosaving, review flags, and resume support.
- Quiz history on the Quant → Quiz page and the learner dashboard.
- Account-level lesson completion, synchronised across devices.
- Dashboard counts for lessons completed, quizzes attempted and completed, and mock tests completed.
- Completed topic quiz counts on the opt-in leaderboard. Leaderboard ranking remains based on the best completed mock score because topic quiz results have different question counts and are not comparable to the 130–170 mock scale.
