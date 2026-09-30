# Task Marketplace API

A REST API for a local task marketplace. Users post tasks, submit proposals, get assigned, submit work, and receive reviews. The API serves a Vue front end (Vercel) from Railway, with a live event stream for notifications and feed updates.

Interactive docs are served by the API itself: UI at `GET /openapi`, spec at `GET /openapi.json`.

## Response envelope

Every response uses the same shape. Success carries `data` (and sometimes a message); errors carry a machine-readable `code` and, on validation failures, the Zod issues so clients can map field errors.

```json
{ "ok": true, "data": {}, "message": "optional" }
{ "ok": false, "code": "VALIDATION_ERROR", "message": "...", "issues": [] }
```

Codes in use: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT_STATE` (right actor, wrong task state), `ALREADY_EXISTS`, `GOOGLE_LINK_REQUIRED`, `RATE_LIMITED`, `SERVER_ERROR`. HTTP statuses follow the same lines: 400, 401, 403, 404, 409, 429, 500. Creates return 201 with the created resource.

One serialization detail: `reward` is a Prisma Decimal and arrives as a JSON string (`"250"`), not a number.

## Authentication

Sessions are cookie based. Login sets an `access_token` cookie (15 minutes) and a `refresh_token` cookie (7 days, path `/auth`). Browsers send them automatically; API clients need to store and attach them.

- `POST /auth/register` takes username, email, first/last/middle name, and a password (min 8 chars). Returns 201, or 409 when the email or username is taken.
- `POST /auth/login` takes either email + password or username + password. Returns the safe user object (no password hash).
- `POST /auth/refresh` rotates the refresh token on every use and sets a fresh pair of cookies. Reusing an already-rotated token revokes all of the user's sessions, which is the theft response. Expired rows are pruned as they are seen.
- `POST /auth/logout` ends the current session. `POST /auth/logout-all` ends every session for the user.
- `GET /auth/me` returns the current profile. `GET /auth/exist?email=` (or `?username=`) reports whether an identifier is taken, for signup forms.
- `POST /auth/google` takes a Google ID token (from Google Identity Services). A linked account logs in; an unknown email creates a Google account (201, no password, email treated as verified). An email that already belongs to a password account gets 409 `GOOGLE_LINK_REQUIRED` and nothing is linked automatically.
- `POST /auth/google/link` takes the ID token plus the account password and links the two, for the case above. Wrong password and unknown email give the same 401, so the endpoint does not reveal which emails exist.

Login, register, refresh, and both Google endpoints are rate limited (20 requests per minute per IP; skipped in the test environment).

Google login needs `GOOGLE_CLIENT_ID` from a Google Cloud OAuth client. An optional `GOOGLE_ALLOWED_DOMAINS` allowlist restricts which email domains may sign in.

## Task lifecycle

```
OPEN → ASSIGNED → SUBMITTED → COMPLETED
```

Owners cancel open tasks (`OPEN → CANCELLED`) and can send assigned or submitted tasks back (`ASSIGNED/SUBMITTED → OPEN`). Reviews happen once, only on completed tasks. Edits are allowed on open tasks only, and hard deletes are limited to tasks the owner holds that are open or cancelled. State changes use guarded writes, so a concurrent transition wins instead of silently overwriting.

## Tasks

Auth is required on all of these.

- `POST /tasks` with title (1-200 chars), optional description, positive reward, and a future deadline. Returns 201 with the task.
- `GET /tasks` is the open-task feed, excluding your own. Sort with `sort_by` (`newest`, `reward_desc`, `deadline_soon`; default `newest`), filter with `q` (title/description text), `minReward`/`maxReward`, `deadlineFrom`/`deadlineTo`. Pages return `{ tasks, nextCursor, hasNextPage }` with a 1-100 limit (default 20).
- `GET /tasks/me` and `GET /tasks/assigned/me` are your posted and assigned lists, paginated the same way, with an optional `status` filter. The posted list includes each task's tasker and proposal count.
- `GET /tasks/:taskId` returns the task with owner and tasker profiles (username plus ratings), its review if any, the proposal count, and your own proposal on it if you made one.
- `PATCH /tasks/:taskId` takes one JSON-patch style op: replace `/title`, `/deadline`, `/description`, or `/reward`, or remove `/description`.
- `DELETE /tasks/:taskId` removes it and returns it.

## Proposals

- `POST /tasks/:taskId/proposals` with a title and body. The task must be open, owners cannot bid on their own tasks, and each user gets one proposal per task (duplicates are 409).
- `GET /tasks/:taskId/proposals` (owner only) lists bids with each proposer's username and rating.
- `PATCH /tasks/:taskId/proposals/me` edits your bid, and `DELETE /tasks/:taskId/proposals/me` withdraws it. Both work while the task is open; after assignment they are 409.

## Assignment flow

- `POST /tasks/:taskId/assign` with `{ userId }` (owner only, task open, user must have proposed). Assigning yourself is rejected.
- `POST /tasks/:taskId/submit` (tasker only, while assigned) moves the task to submitted.
- `POST /tasks/:taskId/confirm` (owner only, while submitted) completes it.
- `POST /tasks/:taskId/review` with stars (1-5) and a comment records the single review and updates the tasker's average and count in the same transaction.
- `GET /tasks/:taskId/review` reads it back, or null when there is none yet.

A 403 here means the wrong actor; a 409 means the right actor but the wrong state, and the message names the current status.

## Users

- `GET /users/me/stats` returns your profile with posted, active (assigned plus submitted), completed-as-tasker, and proposals-sent counts.
- `GET /users/:id/public` returns username, ratings, and posted/completed counts for anyone.

## Realtime events

`GET /events` is a cookie-authenticated Server-Sent Events stream. Event types are `task:created` (broadcast, for the live feed), `proposal:created`, `task:assigned`, `task:unassigned`, `task:submitted`, `task:confirmed`, and `review:received`, each addressed to the owner or the tasker. Events publish after the database transaction commits, never inside it. Clients resume with `Last-Event-ID`; the server replays its recent buffer and then tails live.

```js
const source = new EventSource("https://<api>/events", { withCredentials: true });
source.addEventListener("task:created", (e) => prependTask(JSON.parse(e.data)));
```

## Pagination

List endpoints use keyset pagination, which stays stable while rows change underneath. The cursor is opaque: pass `nextCursor` back as `cursor` for the next page and stop when `hasNextPage` is false. Cursors are bound to their sort, so a cursor minted for one sort is rejected on another.

```
GET /tasks?sort_by=reward_desc&limit=20&cursor=<opaque>
```

## Getting started

You need Node 22+ and Docker (for the local Postgres).

```bash
npm install
cp .env.example .env
```

Start the database and apply migrations:

```bash
docker compose up -d db
npx prisma migrate deploy
```

Seeded development data (500 users, 5000 tasks plus proposals, reviews, and sessions, in under 10 seconds):

```bash
npm run db:seed
```

Known seed logins (password `Password123!`): `seed.password@example.com` for the link-required path, `seed.both@example.com` for a linked account (it also carries an expired and a revoked token row for inspecting rotation), and `seed.google@example.com` for a Google-only account.

Run the server and the suite:

```bash
npm run dev
npm test
```

## Environment variables

Copy `.env.example` to `.env`. Railway takes the same values as service variables.

```env
DATABASE_URL=
PORT=
ACCESS_TOKEN_SECRET=
REFRESH_TOKEN_SECRET=
FRONTEND_URL=        # comma-separated origins allowed; localhost:5173 is always allowed
GOOGLE_CLIENT_ID=    # required for Google login
GOOGLE_ALLOWED_DOMAINS=  # optional allowlist
```

`npm start` runs `prisma migrate deploy` before booting, so Railway deploys migrate on their own. `FRONTEND_URL` must include the Vercel origin or the front end's cookies and event stream will be rejected by CORS.

## Design notes

- Keyset cursors keep infinite scroll stable across sorts.
- Guarded `updateMany` writes make state transitions atomic under concurrency.
- Review creation and rating updates share one transaction.
- Zod validates at the API boundary and its issues are returned on 400s; the OpenAPI spec is generated from Zod schemas, so the served docs track the code.

## License

MIT
