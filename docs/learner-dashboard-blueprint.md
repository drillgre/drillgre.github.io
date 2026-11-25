# DrillGRE Quant Learner Dashboard: implementation blueprint

## Release objective

Deliver a hybrid dashboard that combines performance analytics with practical coaching. The first release is Quant-only. The existing Question Bank, topic quiz, Superquiz, and adaptive Mock Test engines remain unchanged. The dashboard reads their existing learner-owned records through a new, read-only Supabase RPC.

## Implemented in this release

### Dashboard experience
- Quant performance overview with recorded answers, overall accuracy, Question Bank first-attempt accuracy, and number of topics practised.
- Topic and subtopic accuracy with answer counts.
- Coaching suggestions based on observed topic performance.
- Weekly practice trend for the most recent 16 weeks.
- Practice-source breakdown for Question Bank, topic quizzes, Superquizzes, and mock tests.
- Recent completed DrillGRE mock-score progression, explicitly identified as an internal practice estimate.
- A private Mistake Notebook covering incorrect answers, learner notes, review/mastered status, filters, and search.
- Existing lesson completion, quiz history, and mock history remain available.
- Vocabulary and Word Archery statistics are removed from the main Quant dashboard view. Profile details are also de-emphasised.

### Analytics definition
- **Recorded answers:** latest saved Question Bank result per learner-question, plus submitted answers in completed topic quizzes, Superquizzes, and completed mocks.
- **Overall accuracy:** correct recorded answers divided by recorded answers. This is a learning indicator, not a standardized GRE score.
- **Question Bank first-attempt accuracy:** the first-attempt correctness values already retained by the Question Bank diagnostics migration. Older legacy entries without a recorded correctness result are excluded.
- **Topic/subtopic accuracy:** based on the same recorded-answer events, grouped using the question taxonomy stored in the current question record or assessment snapshot.
- **Weekly trend:** answer events grouped by week over the latest 16 weeks. A Question Bank event is dated using its latest saved progress timestamp.
- **Coaching threshold:** a topic is eligible for a coaching signal only after at least five recorded answers. Below this threshold the dashboard reports the data but avoids calling the topic a strength or weakness.
- **Mock scores:** existing DrillGRE internal mock scores are not presented as official ETS scores.

## Repository changes

| File | Change |
|---|---|
| `dashboard.html` | Added Quant insights, responsive analytics layout, and a focused Quant dashboard hierarchy. |
| `assets/js/learner-dashboard.js` | Preserved authentication, guest-attempt claiming, lesson progress, and quiz/mock history. Removed the unrelated vocabulary/Word Archery load from the main dashboard flow. |
| `assets/js/learner-quant-analytics.js` | New client renderer for Quant analytics and practice recommendations. |
| `supabase/learner-dashboard-analytics.sql` | New learner-scoped, read-only analytics RPC. |
| `assets/js/learner-mistake-notebook.js` | New Mistake Notebook renderer, filters, search, notes, and mastery controls. |
| `supabase/learner-mistake-notebook.sql` | New learner-private notes table and learner-scoped notebook RPC. |

## Supabase deployment

1. Open the Supabase project connected to DrillGRE.
2. Open **SQL Editor** and create a new query.
3. Copy the complete contents of `supabase/learner-dashboard-analytics.sql` from this repository.
4. Run the script.
5. Run `supabase/learner-mistake-notebook.sql` after the analytics migration and existing assessment migrations.
6. Sign in with a learner account and refresh `/dashboard.html`.

This migration depends on the existing Question Bank diagnostics, persistent topic quiz, mock test, and Question Bank/Superquiz tracking tables. Apply the existing setup migrations first if they have not already been run. Do not rerun or replace the Question Bank or Mock Test engines for this dashboard release.

If the migration has not been applied, the dashboard displays an explicit setup message instead of silently showing fabricated or incomplete analytics.

## Privacy and access control

- The RPC requires an authenticated user and derives the learner identity from `auth.uid()`.
- Every underlying event query is filtered to that learner.
- The RPC returns aggregates only. It does not return question text, answer responses, explanations, email addresses, or other learners' records.
- Public and anonymous execution is revoked. Execution is granted to authenticated users only.
- The dashboard does not write to Question Bank, quiz, or mock attempt tables.

## Known data limitations

- Historical per-question response time is not consistently available across all assessment sources. No time-management score is inferred in this release.
- Question Bank historical records created before correctness tracking may not contain first-attempt correctness. These are excluded from accuracy calculations when correctness is unknown.
- Topic quizzes and Superquizzes contribute submitted answers from completed attempts. In-progress attempts are excluded.
- Mock analytics use completed mock attempts only.
- Topic labels depend on the taxonomy recorded on the question or immutable assessment snapshot. Unclassified records are grouped separately.
- The five-answer threshold is an initial guard against over-interpreting small samples. It can be raised after observing real usage.

## Acceptance checks

- A signed-out visitor is redirected through the existing account flow.
- An administrator is redirected to the admin workspace.
- A learner sees only their own analytics.
- A learner with no practice history sees clear empty states and no fabricated accuracy.
- Question Bank, quiz, Superquiz, and mock pages continue to start, save, resume, submit, and review attempts as before.
- Completing a practice activity updates dashboard analytics after refresh.
- Topic recommendations are not generated for topics with fewer than five recorded answers.
- The dashboard works on desktop and mobile widths.
- Mistake Notebook displays only the signed-in learner's incorrect answers.
- Notes and mastered/review status persist after refresh and remain private to the learner.
- Mock score labels remain clearly identified as DrillGRE practice estimates, not official ETS scores.

## Recommended next iteration

After the first release is live and real learner data has been observed:
1. Add a dedicated mistake notebook using incorrect-answer history and learner notes.
2. Add goal setting and weekly practice targets.
3. Add a more detailed mock-score progression view with a clear explanation of the DrillGRE scoring scale.
4. Add prospective per-question timing consistently across Question Bank, quizzes, and mocks before showing time-management diagnostics.
5. Consider a comparison of recent versus previous four-week performance once sample sizes are adequate.
