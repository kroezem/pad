# pad

A personal, single-user text feed with a live draft composer. Password login, autosave, device sync, searchable blocks, and an append-only endpoint for an iOS share-sheet Shortcut. **Cut** (Ctrl/Cmd+Enter) archives the draft as a block; **Edit** restores a block to the composer, cutting any non-blank draft first. Notes also auto-cut lazily after three hours without edits. Blank drafts are reused. Built with React, Vite, and Supabase; installable as a PWA. Attachments, tags, and other note kinds have schema support only.

## Local development

```sh
npm install
cp .env.example .env.local
# Fill in the three VITE_* variables.
npm run dev
```

`npm run build` runs TypeScript and builds the SPA and service worker. Only the public anon/publishable key belongs in frontend environment variables; never use the service-role key there.

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

Apply both timestamped migrations in order. The original migration creates the schema; `20261012010000_pad_feed.sql` adds block editing/deletion, feed pagination, filtered full-content search, and full replica identity for Realtime. RLS restricts reads to owned rows; clients cannot write archived rows directly. Authorized RPCs handle restore and delete. Every note writer shares a per-user transaction lock; optimistic versions protect concurrent edits. Feed and search results include attachment metadata for a future UI. Timestamp ties are included at feed page boundaries to avoid skipped blocks.

## Vercel

Import this repository into Vercel using its Vite preset (`npm run build`, output `dist`). Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PAD_LOGIN_EMAIL` for the desired environments, then deploy. Add `pad.makro.ca` to the project's domains. Create the `pad` CNAME in the `makro.ca` DNS zone using the target Vercel shows for that domain, and wait for verification and HTTPS. `vercel.json` rewrites SPA paths to `/index.html`.

## Install as an app

On iPhone, open `https://pad.makro.ca` in Safari, then Share → **Add to Home Screen**. On desktop/Android, use the browser's install action. The manifest provides standalone display and grey theme/background colors. PNG icons (192, 512, maskable 512, and Apple 180) are included. To regenerate them without installing dependencies:

```sh
python3 scripts/generate-icons.py
```

`public/icons/pad.svg` is the vector icon. The service worker auto-updates and precaches only the app shell and icons. Supabase requests remain network-only; blocks are not cached for offline browsing. The current draft is saved locally when storage is available. All Supabase access lives in `src/data/index.ts` so UI components do not depend on the backend SDK.

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

Autosave waits 600 ms and also runs on blur or when the page is hidden. Unsaved drafts are stored per user in this browser when localStorage is available; reconnecting retries. Browser termination can interrupt a network save, so the stored draft is recovered on the next login. Conflicts require **Use theirs** or **Keep mine**. **Cut** saves the draft before archiving it; **Edit** saves and cuts any existing draft before restoring a block. The feed orders blocks by cut time, oldest to newest, and loads older pages at the top. New arrivals scroll down only when already near the bottom; otherwise use the **New** pill. Search and All/Text/Links filters use `search_notes`. Copy always copies the full block, even when collapsed. Delete asks for confirmation.

**Sign out** ends this device's session; **Sign out everywhere** revokes all refresh sessions after confirmation. Already-issued access tokens can remain valid until expiry, as with standard Supabase Auth behavior.

Validation for this iteration is limited to `npm run build`, including TypeScript. Manually check migration application, login with closed signups, simultaneous saves/conflicts, cut/edit/delete across devices, paging/search, clipboard, idle rollover and share-sheet append, API key revocation, offline draft recovery, PWA install/update, and keyboard/safe-area behavior in iPhone Safari and standalone mode. No live Supabase project, deployment, browser test, or latency check was used.
