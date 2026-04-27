# Fragranza Organizer

A shared workspace for tasks, meetings, and to-dos. Teammates sign in with a magic link sent to their email — no passwords. Everyone in the workspace sees the same items in real time.

Built with Next.js 14 (App Router), Supabase (database + auth + realtime), and Tailwind CSS. Designed to be deployed on Vercel.

---

## What you'll set up

1. A free Supabase project (database + auth backend)
2. A Resend account (so the auth emails actually land in inboxes — not just spam)
3. A Vercel project that hosts the Next.js app
4. Three environment variables wired between them

End state: you visit your app's URL, type your email, click the magic link, and you're in. You can invite teammates from the **Team** button in the app.

Total time: **~25 minutes** the first time through.

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free account.
2. Click **New project**. Pick any name (e.g. `fragranza-organizer`), set a strong DB password (save it somewhere — you won't need it for the app, but Supabase will), choose the region nearest your team.
3. Wait ~2 minutes for the project to provision.
4. Once it's up, open **Project Settings → API**. You'll see two values you need:
   - **Project URL** — looks like `https://xxxxxxxx.supabase.co`
   - **Project API key (anon, public)** — a long `eyJhbGc…` string

Keep these handy — they go into Vercel as env vars in step 4.

## 2. Apply the database schema

1. In the Supabase dashboard, open the **SQL Editor** (left sidebar, looks like `< >`).
2. Click **New query**.
3. Open `supabase/schema.sql` from this repo, copy the entire contents, paste into the SQL editor, click **Run**.
4. You should see `Success. No rows returned`. The schema creates two tables (`profiles` and `items`), the trigger that auto-creates a profile when someone signs up, row-level security policies, and the realtime publication.

To verify: open **Database → Tables**. You should see `profiles` and `items` listed under the `public` schema.

## 3. Hook up Resend for transactional email

Supabase's built-in email service is rate-limited (3 emails/hour) and frequently lands in spam — fine for testing, not fine for real users. Resend fixes both.

1. Go to [resend.com](https://resend.com), create an account.
2. **Add a domain** — use your real domain (e.g. `fragranza.com`) and follow Resend's instructions to add the DNS records. If you can't add DNS yet, you can skip this and use Resend's `onboarding@resend.dev` sender for testing only.
3. Once verified, go to **API Keys → Create API Key** and copy the key.
4. Back in Supabase, open **Project Settings → Auth → SMTP Settings** and toggle **Enable Custom SMTP**. Fill in:
   - **Sender email**: `noreply@yourdomain.com` (must match your verified Resend domain)
   - **Sender name**: `Fragranza`
   - **Host**: `smtp.resend.com`
   - **Port**: `465`
   - **Username**: `resend`
   - **Password**: *(paste the Resend API key)*
5. Click **Save**.
6. While you're in Auth settings, also visit **Auth → URL Configuration** and add your future Vercel URL (e.g. `https://fragranza-organizer.vercel.app`) to **Site URL** and to the **Redirect URLs** allow-list. (You can come back and update this once you know the Vercel URL — step 4.)

## 4. Deploy to Vercel

1. Push this folder to a GitHub repo (or use Vercel's CLI to deploy directly).
2. Go to [vercel.com](https://vercel.com), click **Add New → Project**, import your GitHub repo.
3. Vercel auto-detects Next.js. On the configuration screen, expand **Environment Variables** and add three:

   | Name                            | Value                                                |
   | ------------------------------- | ---------------------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | The Project URL from step 1                          |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The anon key from step 1                             |
   | `NEXT_PUBLIC_SITE_URL`          | The URL Vercel will give you (e.g. the `*.vercel.app` URL — you can fill this in after the first deploy and redeploy) |

4. Click **Deploy**. First build takes ~2 minutes.
5. Once it's live, copy the URL Vercel gives you. Go back to **Supabase → Auth → URL Configuration** and confirm that URL is in **Site URL** and **Redirect URLs**. If you set `NEXT_PUBLIC_SITE_URL` to a placeholder earlier, update it now and trigger a redeploy.

## 5. First sign-in

1. Open your Vercel URL.
2. You'll be redirected to `/login`. Type your email, click **Send magic link**.
3. Check your inbox (it'll be from your Resend sender). Click the link.
4. You'll land in the organizer with an empty workspace. Add some items, click **Team** in the top-right to invite teammates.

That's it.

---

## Local development (optional)

```bash
npm install
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# and NEXT_PUBLIC_SITE_URL=http://localhost:3000
npm run dev
```

For local development, also add `http://localhost:3000` to Supabase's allowed redirect URLs.

---

## How the permissions work

This app uses a **single shared workspace** — every authenticated user sees and can edit every item. No per-team isolation, no roles. That's the simplest setup, and the right one for a single small team.

If you later want multiple teams or read-only members, the place to change it is `supabase/schema.sql` (the RLS policies on `items`). The app code is already keyed on the authenticated user, so adding e.g. a `workspace_id` column and scoping policies to it is a contained change.

## Repo layout

```
app/
  layout.tsx              root layout
  globals.css             tailwind directives
  page.tsx                home — server component, loads items + members
  login/page.tsx          magic-link request form
  auth/confirm/route.ts   verifies the OTP token in the magic link
  auth/signout/route.ts   POST endpoint that signs out
components/
  Organizer.tsx           main UI: list view, calendar view, filters, modals
  LogoSvg.tsx             Fragranza brand mark (currentColor)
lib/supabase/
  client.ts               browser Supabase client
  server.ts               server Supabase client (cookie-aware)
  middleware.ts           refreshes the session on every request
middleware.ts             root middleware — redirects unauth users to /login
supabase/schema.sql       database schema, RLS, triggers, realtime publication
tailwind.config.ts        custom colors (accent #c96442 — Fragranza brand)
```
