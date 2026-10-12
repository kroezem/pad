# pad

A personal, single-user plain-text scratchpad. Password login, autosave, live device sync, searchable history, and an append-only endpoint for an iOS share-sheet Shortcut. Notes roll over lazily after three hours without edits; blank notes are reused. Built with React, Vite, and Supabase. Attachments, tags, and other note kinds have schema support only.

## Local development

```sh
npm install
cp .env.example .env.local
# Fill in the three VITE_* variables.
npm run dev
```

`npm run build` and `npm run lint` verify the SPA. Only the public anon/publishable key belongs in frontend environment variables; never use the service-role key there.

## Supabase setup

1. Create a Supabase project. In Authentication → Users, create the single owner with an email such as `pad@example.com` and a generated strong password. Confirm the email when creating the user. Set `VITE_PAD_LOGIN_EMAIL` to this email.
2. Disable **Allow new users to sign up** in Authentication settings. Keep email/password login enabled. Do not create other users: authorization isolates each authenticated user's data; single-user access relies on having only the owner account and closed signups.
3. Install the Supabase CLI, log in, and apply the migration:

   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

4. Deploy the append function:

   ```sh
   supabase functions deploy append
   ```

   `supabase/config.toml` sets `verify_jwt = false` for this function because it authenticates `x-pad-key` itself. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to hosted functions. The service-role-only database RPC cannot be called by browser clients.
5. Sign in and open the menu → API key. Generate and copy a key; only its SHA-256 hash is stored. Revoke keys from this panel when no longer needed.

The migration enables RLS on every table, permits only owned-row reads, and routes note writes through RPCs. Archived note rows cannot be written directly by clients. All note writers share a per-user transaction lock; optimistic versions protect concurrent edits. Realtime is enabled for `notes` in the migration.

## Vercel

Import this repository into Vercel using its Vite preset (`npm run build`, output `dist`). Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PAD_LOGIN_EMAIL` for the desired environments, then deploy. Add `pad.makro.ca` to the project's domains. Create the `pad` CNAME in the `makro.ca` DNS zone using the target Vercel shows for that domain, and wait for verification and HTTPS. `vercel.json` rewrites SPA paths to `/index.html`.

## iOS Shortcut

1. Create a new Shortcut named **Pad**.
2. Enable **Show in Share Sheet** and accept **Text** and **URLs**.
3. Add **Get Contents of URL**:
   - URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/append` (also shown in the API key panel).
   - Method: **POST**.
   - Header: `x-pad-key` = your generated key.
   - Request Body: **JSON**, with key `text` = **Shortcut Input**. Use a Text action first if the shared item needs conversion to a string.
4. Add **Show Notification** with **Added to pad**.
5. Share some text or a URL to **Pad** and check the scratchpad.

Test the endpoint from a terminal:

```sh
curl --fail-with-body 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/append' \
  -H 'x-pad-key: pad_YOUR_KEY' \
  -H 'Content-Type: application/json' \
  --data '{"text":"Hello from the share sheet"}'
```

It also accepts `Content-Type: text/plain`. Trailing whitespace is trimmed; empty text is rejected, and text is capped at 100,000 Unicode characters. Responses never include note contents.

## Behavior and verification

Autosave waits 600 ms and also runs on blur or when the page is hidden. Unsaved drafts are stored per user in this browser when localStorage is available; reconnecting retries. Browser termination can interrupt a network save, so the stored draft is recovered on the next login. Conflicts require **Use theirs** or **Keep mine**. **New** saves the current draft before archiving it. History search always goes through `search_notes`.

**Sign out** ends this device's session; **Sign out everywhere** revokes all refresh sessions after confirmation. Already-issued access tokens can remain valid until expiry, as with standard Supabase Auth behavior.

Before release, verify against your live project: migration application and permissions, owner login with closed signups, simultaneous saves and rollover, two-device Realtime latency, offline recovery, history search, API key revocation, function responses, and the iOS Shortcut. Build/lint checks cannot verify hosted Auth, Realtime, Edge Functions, DNS, or real iPhone Safari behavior.
