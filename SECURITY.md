# DrillGRE security

This is a public static website backed by Supabase. Security controls are enforced primarily in PostgreSQL and Supabase Auth, not by hiding pages in the browser.

## Database hardening

Run the SQL files listed in [LEARNER-SETUP.md](supabase/LEARNER-SETUP.md) in order, including `security-hardening.sql` last. That migration:

- Removes direct insert, update, and delete access to learner profiles for browser roles.
- Allows signed-in users to read only their own profile row and only the fields the frontend needs.
- Protects the profile role field from direct learner-side modification.
- Disables client creation of database objects in the public schema.
- Makes the question-figure bucket public-read but admin-write, with a 5 MB upload limit and raster-image MIME allow-list.

Review Storage policies after migration. Existing broad policies can combine permissively with the new policies; remove any policy that grants general authenticated users write access to the question-figure bucket.

## Supabase project settings

In the Supabase Dashboard, keep email confirmation enabled, restrict Auth redirect URLs, configure appropriate rate limits, enable CAPTCHA/bot protection if public registration is being abused, use strong administrator credentials, and enable MFA for administrator accounts where supported. Enable leaked-password protection when available on the project's plan. Coordinate password-policy changes with existing learners.

## Secrets

The Supabase publishable key in frontend files is designed for browser use. Never commit a `service_role` key, Supabase secret key, database password, GitHub token, or other private credential.

## Hosting headers

GitHub Pages does not expose a repository setting for arbitrary HTTP response headers. The application adds a no-referrer meta policy to the account, admin, dashboard, and quiz pages, but this is not a substitute for HTTP response headers. For a full Content-Security-Policy, HSTS, frame protection, and related headers, use a host or proxy that can configure them. Cloudflare Pages supports custom headers through a `_headers` file.

## Responsible disclosure

Do not test security controls against other users' accounts or data. Report suspected issues privately to the site owner.
