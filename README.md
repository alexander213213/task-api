# Task Marketplace API

A REST API for a local task marketplace where users can post tasks, submit proposals, assign workers, and leave reviews.

This project demonstrates:

* Cursor-based pagination
* Atomic state transitions using guarded updates
* Transactional review + rating updates
* Role-based authorization
* Input validation with Zod

---

## 🧱 Tech Stack

* **Runtime:** Node.js + Express
* **Database:** PostgreSQL
* **ORM:** Prisma
* **Validation:** Zod
* **Auth:** JWT

---

## 🔄 Task Lifecycle

```
OPEN → ASSIGNED → SUBMITTED → COMPLETED
```

Other transitions:

* `OPEN → CANCELLED` (owner cancels)
* `ASSIGNED/SUBMITTED → OPEN` (owner unassigns)
* Review allowed only when task is `COMPLETED`

---

## 🚀 Getting Started

### Prerequisites

* Node.js 18+
* PostgreSQL

### Installation

```bash
npm install
cp .env.example .env
```

### Database setup

```bash
npx prisma migrate dev
npm run db:seed
```

### Run the server

```bash
npm run dev
```

Server runs at:

```
http://localhost:3000
```

---

## 🔐 Authentication

Most endpoints require auth via the `access_token` cookie (set by login/refresh; browsers send it automatically).

Interactive API docs (Scalar) are served by the API itself:

* UI: `GET /openapi`
* Spec: `GET /openapi.json`

---

# 📡 API Reference

---

## Tasks

---

### Create Task

**POST** `/tasks`
🔒 Auth required

**Body**

```json
{
  "title": "string",
  "description": "string (optional)",
  "reward": 100,
  "deadline": "ISO datetime"
}
```

**Success**

```json
{
  "ok": true,
  "message": "Task Created Successfully"
}
```

---

### List Open Tasks (Feed)

**GET** `/tasks`
🔒 Auth required

**Query params**

| param   | type   | default | description                          |
| ------- | ------ | ------- | ------------------------------------ |
| cursor  | string | —       | pagination cursor                    |
| limit   | number | 20      | page size                            |
| sort_by | enum   | newest  | newest | reward_desc | deadline_soon |

**Response**

```json
{
  "ok": true,
  "tasks": [],
  "nextCursor": "string | null",
  "hasNextPage": true
}
```

---

### Get Task

**GET** `/tasks/:taskId`
🔒 Auth required

---

### Update Task (Patch)

**PATCH** `/tasks/:taskId`
🔒 Owner only

Supports JSON-patch style operations:

* replace `/title`
* replace `/deadline`
* replace `/description`
* replace `/reward`
* remove `/description`

---

### Cancel Task

**POST** `/tasks/:taskId/cancel`
🔒 Owner only
✅ Only when status = `OPEN`

---

### Unassign Tasker

**POST** `/tasks/:taskId/unassign`
🔒 Owner only
✅ Only when status = `ASSIGNED` or `SUBMITTED`

---

## Proposals

---

### Create Proposal

**POST** `/tasks/:taskId/proposals`
🔒 Auth required
🚫 Owner cannot propose
✅ Task must be `OPEN`
⚠️ One proposal per user per task

---

### List Proposals

**GET** `/tasks/:taskId/proposals`
🔒 Owner only

Returns proposer info (username + ratings).

---

## Assignment Flow

---

### Assign Tasker

**POST** `/tasks/:taskId/assign`
🔒 Owner only
✅ Task must be `OPEN`
✅ Selected user must have proposed

---

### Submit Work

**POST** `/tasks/:taskId/submit`
🔒 Tasker only
✅ Only when status = `ASSIGNED`

Transition:

```
ASSIGNED → SUBMITTED
```

---

### Confirm Completion

**POST** `/tasks/:taskId/confirm`
🔒 Owner only
✅ Only when status = `SUBMITTED`

Transition:

```
SUBMITTED → COMPLETED
```

---

## Reviews

---

### Create Review

**POST** `/tasks/:taskId/review`
🔒 Owner only
✅ Only when task is `COMPLETED`
✅ Only once per task

**Body**

```json
{
  "stars": 1-5,
  "comment": "string"
}
```

This endpoint uses a database transaction to ensure:

* review creation
* tasker rating update

are atomic.

---

# 📄 Pagination

The task feed uses **cursor-based pagination**.

**Query**

```
GET /tasks?cursor=<id>&limit=20
```

**Response**

```json
{
  "tasks": [...],
  "nextCursor": "string | null",
  "hasNextPage": boolean
}
```

---

# ❗ Error Handling

Common status codes:

* **400** — validation error
* **401** — unauthorized
* **403** — forbidden
* **404** — not found
* **409** — invalid state transition

---

# ⚙️ Environment Variables

Create `.env`:

```env
DATABASE_URL=
JWT_SECRET=
```

---

# 🧠 Design Notes

* **Cursor pagination** is used for stable infinite scrolling.
* **Guarded `updateMany` writes** ensure atomic state transitions.
* **Transactions** are used where multiple tables must update together (reviews).
* **Zod** provides runtime validation at the API boundary.

---

# 🔮 Future Improvements

* Task expiration worker
* Proposal editing
* Notifications
* Payment escrow
* Admin dispute flow

---

## 📜 License

MIT
