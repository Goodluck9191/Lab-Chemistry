# Running this project

## 1. Reproduce the artifacts a fresh checkout needs

1. **Install dependencies** with the project's package manager (npm — `package-lock.json` is committed):

   ```bash
   npm ci
   ```

2. **Copy the environment file** from the main checkout if `.env.local` is absent. Never symlink it —
   a worktree may need a different port or URL.

   ```bash
   cp "<main checkout>/.env.local" .env.local
   ```

   `.env.local` currently holds **placeholder** values, including a placeholder service-role key.
   It is not a secret store: the real credentials are supplied by whoever runs the live project.

3. **No database is needed for the preview.** The laboratory route
   (`/lab/[experimentId]/attempt/[attemptId]`) requires privileged server-side credentials, because
   `attempt_secrets` has no RLS. With placeholder credentials that route renders its
   "Database credentials not configured" notice, which is expected. Use the development preview
   route instead (below) to see and operate the bench.

## 2. Run the server

```bash
npm run dev
```

`next dev` serves on **http://localhost:3000**. If 3000 is taken, pick a free port and pass it:
`npm run dev -- -p 3100`.

### What to open

- `/lab-preview` — **development only.** The laboratory bench driven by scripted scenarios through
  the real titration engine, with a scenario switcher (fresh attempt, burette filled, running
  titration, near/at/past the endpoint, recorded and concordant trials, stage B). Returns a 404 in a
  production build; scenarios are built server-side and only the public projection is sent.
- `/` , `/login`, `/register` — landing and auth pages.
- `/student/experiments` — needs real Supabase credentials.

### Verifying without a browser

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```
