# pad

A personal, single-user message feed with password login, search, device-local drafts, and an iOS share-sheet endpoint. **Send** (Ctrl/Cmd+Enter) posts a message; **Edit** loads its text into the composer and updates the same message when sent. Edited messages move to the bottom, keeping their ID and creation time. Built with React, Vite, and Supabase; installable as a PWA. Attachments, tags, and other note kinds have schema support only.

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

Apply all timestamped migrations in order. For an existing installation, run `supabase db push`, then redeploy with `supabase functions deploy append`. The new `20261014000000_pad_messages.sql` migration backfills sent timestamps from archive/edit times, removes blank current notes and draft machinery, and introduces message RPCs. RLS keeps rows owner-only and permits updates to owned content. Feed and search include attachment metadata for a future UI. Feed pagination includes timestamp ties at page boundaries to avoid skipped messages. Realtime publishes message inserts, updates, and deletes.

## Vercel

Import this repository into Vercel using its Vite preset (`npm run build`, output `dist`). Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PAD_LOGIN_EMAIL` for the desired environments, then deploy. Add `pad.makro.ca` to the project's domains. Create the `pad` CNAME in the `makro.ca` DNS zone using the target Vercel shows for that domain, and wait for verification and HTTPS. `vercel.json` rewrites SPA paths to `/index.html`.

## Install as an app

On iPhone, open `https://pad.makro.ca` in Safari, then Share → **Add to Home Screen**. On desktop/Android, use the browser's install action. The manifest provides standalone display and grey theme/background colors. PNG icons (192, 512, maskable 512, and Apple 180) are included. To regenerate them:

```sh
npm run icons
```

`public/icons/favicon.svg` is the vector icon. The white collection glyph is Bootstrap Icons **collection-fill**, licensed under [MIT](https://github.com/twbs/icons/blob/main/LICENSE). It uses 58% of regular icons and 48% of the maskable icon. The rasterizer uses the development dependency `@resvg/resvg-js`.

The service worker auto-updates and precaches only the app shell and icons. Supabase requests remain network-only; messages are not cached for offline browsing. The unsent draft is stored per user on this device when localStorage is available. Frontend Supabase calls live in `src/data/index.ts`; the append Edge Function owns its server-side calls.

## iOS Shortcut

1. Create a new Shortcut named **Pad**.
2. Enable **Show in Share Sheet** and accept **Text** and **URLs**.
3. Add **Get Contents of URL**:
   - URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/append` (also shown in the API key panel).
   - Method: **POST**.
   - Header: `x-pad-key` = your generated key.
   - Request Body: **JSON**, with key `text` = **Shortcut Input**. Use a Text action first if the shared item needs conversion to a string.
4. Add **Show Notification** with **Added to pad**.
5. Share some text or a URL to **Pad** and check the feed.

Test the endpoint from a terminal:

```sh
curl --fail-with-body 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/append' \
  -H 'x-pad-key: pad_YOUR_KEY' \
  -H 'Content-Type: application/json' \
  --data '{"text":"Hello from the share sheet"}'
```

Each call creates a new message; the function name, URL, authentication, limits, and response remain compatible with existing Shortcuts. It also accepts `Content-Type: text/plain`. Trailing whitespace is trimmed; empty text is rejected, and text is capped at 100,000 Unicode characters. Responses never include note contents.

## Behavior and verification

The composer is local to each device and restores its unsent text from localStorage. Send keeps the text while pending and disables editing; success clears it and immediately adds the returned message to the feed, de-duplicating its Realtime arrival. Failure keeps the text and offers Retry. Blank text cannot be sent.

Edit marks the original card and loads its full text. If the composer has text, choose **Send draft first**, **Discard draft**, or **Cancel**. Canceling edit clears the composer and leaves the original untouched. Messages appear oldest to newest, with older pages loaded at the top; updates move to the bottom and deletes remove the card. Focus and returning to a visible tab refresh the feed. New arrivals scroll down only when already near the bottom; otherwise use **Latest ↓**. Search and All/Text/Links filters use `search_notes`. Cards over 12 lines collapse with Show more/less; Copy always copies the full content. Delete asks for confirmation.

The top search/filter/menu pill and bottom composer share the feed column width. Measured heights reserve feed space, including keyboard and safe-area offsets. The background uses a fixed dot grid.

**Sign out** ends this device's session; **Sign out everywhere** revokes all refresh sessions after confirmation. Already-issued access tokens can remain valid until expiry, as with standard Supabase Auth behavior.

Validation is limited to `npm run build`, including TypeScript. After deploying, manually check migration application, Send/edit/delete across devices, paging/search, collapsed cards and clipboard, share-sheet messages and key revocation, local draft recovery, PWA icons/update, and composer spacing with the iPhone keyboard and safe areas. No tests, browser run, or lint iteration was performed.
