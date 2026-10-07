# Dungeon Lab on Netlify: setup

One site that every customer logs in to. Netlify hosts it and Supabase holds the logins and each customer's private data. Nothing in it bills you per use.

You do each step once. Budget about 30 minutes.

## What is in this folder

- `site/` the app itself (all 27 tools)
- `netlify/functions/` one small server function that hands the site its settings
- `supabase/schema.sql` the database, logins-only access rules, and the access-code system
- `netlify.toml` tells Netlify where everything is

## Step 1. Supabase (logins and data)

1. Create a free account at supabase.com and make a new project. Name it Dungeon Lab. Save the database password somewhere safe.
2. Open **SQL Editor**, start a new query, paste the whole of `supabase/schema.sql`, and run it. It should finish with no errors.
3. Open **Authentication**, find the Email sign-in settings, and turn **Confirm email** off. (Supabase's built-in email sender only allows a few emails an hour, which will block customers on a busy day. If you want confirmation emails later, connect your own email sender first.)
4. Still in Authentication, find the URL settings and set **Site URL** to your Netlify address once you have it (Step 2). Password reset emails use it.
5. Open **Project Settings > API** and copy two things: the **Project URL** and the **anon public** key. You need them in Step 2.

Your launch access code is `DUNGEON`. Change it, or add more, in **Table Editor > access_codes**. Set a code's `active` box to off to retire it.

## Step 2. Netlify (hosting)

1. Put this folder in a GitHub repository (github.com > New repository > upload the folder contents). Keep the repository private.
2. In Netlify: **Add new site > Import an existing project**, pick that repository, leave the build settings as they are, and deploy.
3. In the site's **Environment variables**, add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | the Project URL from Step 1 |
| `SUPABASE_ANON_KEY` | the anon public key from Step 1 |

4. Redeploy so the new settings take effect (**Deploys > Trigger deploy**).
5. Add your domain in **Domain management**, for example `lab.timmysdungeon.com`, then go back and set that address as the Site URL in Supabase (Step 1.4).

If the site shows a "Preview mode" banner after this, the two Supabase variables are missing or misspelled.

## Step 3. Test it before any customer sees it

1. Open the site, create an account, enter the access code.
2. Prop Firm Tracker: add an account (50,000 size, 2,000 max drawdown, 1,000 daily loss limit).
3. Journal: log short NQ, 1 contract, entry 20150, stop 20180, exit 20110. You should see +$800.00 and 1.33R, and the Tracker balance at $50,800.00.
4. Create a second account with a different email and confirm it sees none of the first one's data.

## What the customer does

1. Opens the link, creates an account with their email and a password.
2. Enters the access code the coach gives them on the call.
3. Lands on Today. Adds their first account in Prop Firm Tracker, fills in the Trading Plan, logs a trade.

## Running it

- **See customers:** Supabase > Authentication > Users. Data is in Table Editor.
- **Remove a customer's access:** Table Editor > profiles > set `has_access` to off.
- **Update the app:** change files in GitHub and Netlify redeploys on its own.

## Known limits

- Access is by shared code, not tied to Whop. Anyone with the link and the code can get in. Rotate the code if it leaks. A Whop purchase check can replace this later.
- AI Timmy is not part of this build.
- Trailing drawdown follows the balance trade by trade and does not model a firm locking the floor.
- Prop Firm Rules start blank. Each trader fills in the plans they run.
