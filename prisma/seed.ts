import { Prisma } from "../generated/prisma/client";
import { AuthProvider, TaskStatus } from "../generated/prisma/enums";
import { prisma } from "../src/services/db";
import { faker } from "@faker-js/faker";
import bcrypt from "bcrypt";
import { createHash } from "crypto";

const SEED = 1337;
const USER_COUNT = 500;
const TASK_COUNT = 5000;
const MAX_PROPOSALS_PER_TASK = 8;
const REFRESH_TOKENS_PER_USER = { min: 0, max: 3 };
const CHUNK = 1000;

/** Dev fixtures with known credentials (password is "Password123!"). */
const FIXTURE_PASSWORD_EMAIL = "seed.password@example.com";
const FIXTURE_BOTH_EMAIL = "seed.both@example.com";
const FIXTURE_GOOGLE_EMAIL = "seed.google@example.com";

function pickStatus(): TaskStatus {
  return faker.helpers.weightedArrayElement<TaskStatus>([
    { weight: 50, value: TaskStatus.OPEN },
    { weight: 15, value: TaskStatus.ASSIGNED },
    { weight: 10, value: TaskStatus.SUBMITTED },
    { weight: 15, value: TaskStatus.COMPLETED },
    { weight: 10, value: TaskStatus.CANCELLED },
  ]);
}

function weightedReward(): number {
  return faker.helpers.weightedArrayElement<number>([
    { weight: 60, value: faker.number.int({ min: 50, max: 200 }) },
    { weight: 30, value: faker.number.int({ min: 200, max: 500 }) },
    { weight: 10, value: faker.number.int({ min: 500, max: 1500 }) },
  ]);
}

function safeUsername(base: string) {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
  return `${slug}${faker.number.int({ min: 10, max: 9999 })}`;
}

function proposalTitle(): string {
  return faker.helpers.weightedArrayElement([
    { weight: 50, value: "I can do this today" },
    { weight: 30, value: "Experienced and ready to help" },
    { weight: 20, value: "Fast and reliable service" },
  ]);
}

function reviewComment(): string {
  return faker.helpers.weightedArrayElement([
    { weight: 45, value: "Good work and finished on time." },
    { weight: 35, value: "Great communication and very reliable." },
    { weight: 20, value: faker.lorem.sentence() },
  ]);
}

function pickStars(): number {
  return faker.helpers.weightedArrayElement<number>([
    { weight: 5, value: 1 },
    { weight: 8, value: 2 },
    { weight: 17, value: 3 },
    { weight: 35, value: 4 },
    { weight: 35, value: 5 },
  ]);
}

/** Fast stand-in hash for seed sessions (dev data only; never verified). */
function fakeTokenHash(): string {
  return createHash("sha256").update(faker.string.uuid()).digest("hex");
}

async function createManyInChunks<T>(
  rows: T[],
  create: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await create(rows.slice(i, i + CHUNK));
  }
}

async function main() {
  faker.seed(SEED);

  await prisma.review.deleteMany();
  await prisma.proposal.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.task.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("Password123!", 10);

  // ---- Users (batched; ids generated client-side so later rows can link) ----
  type UserRow = {
    id: string;
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    middleName: string | null;
    passwordHash: string | null;
    googleId: string | null;
    provider: AuthProvider;
    emailVerifiedAt: Date | null;
  };

  const userRows: UserRow[] = Array.from({ length: USER_COUNT }).map(() => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    return {
      id: faker.string.uuid(),
      username: safeUsername(`${firstName}${lastName}`),
      email: faker.internet.email({ firstName, lastName }).toLowerCase(),
      firstName,
      lastName,
      middleName: faker.helpers.maybe(() => faker.person.middleName(), { probability: 0.25 }) ?? null,
      passwordHash,
      googleId: null,
      provider: AuthProvider.PASSWORD,
      emailVerifiedAt: null,
    };
  });

  // Fixed fixtures for exercising auth flows in dev.
  userRows.push(
    {
      id: faker.string.uuid(),
      username: "seedpassword",
      email: FIXTURE_PASSWORD_EMAIL,
      firstName: "Seed",
      lastName: "Password",
      middleName: null,
      passwordHash,
      googleId: null,
      provider: AuthProvider.PASSWORD,
      emailVerifiedAt: null,
    },
    {
      id: faker.string.uuid(),
      username: "seedboth",
      email: FIXTURE_BOTH_EMAIL,
      firstName: "Seed",
      lastName: "Both",
      middleName: null,
      passwordHash,
      googleId: "seed-google-sub-both",
      provider: AuthProvider.BOTH,
      emailVerifiedAt: new Date(),
    },
    {
      id: faker.string.uuid(),
      username: "seedgoogle",
      email: FIXTURE_GOOGLE_EMAIL,
      firstName: "Seed",
      lastName: "Google",
      middleName: null,
      passwordHash: null,
      googleId: "seed-google-sub-1",
      provider: AuthProvider.GOOGLE,
      emailVerifiedAt: new Date(),
    },
  );

  await createManyInChunks(userRows, (chunk) => prisma.user.createMany({ data: chunk }));
  const userIds = userRows.map((u) => u.id);

  // ---- Tasks (batched) ----
  type TaskRow = {
    id: string;
    title: string;
    description: string | null;
    reward: number;
    createdAt: Date;
    deadline: Date;
    ownerId: string;
    taskerId: string | null;
    status: TaskStatus;
  };

  const taskRows: TaskRow[] = Array.from({ length: TASK_COUNT }).map(() => {
    const ownerId = faker.helpers.arrayElement(userIds);
    const status = pickStatus();
    const createdAt = faker.date.recent({ days: 30 });
    const deadline = faker.date.soon({
      days: faker.helpers.weightedArrayElement([
        { weight: 50, value: 30 },
        { weight: 30, value: 80 },
        { weight: 20, value: 200 },
      ]),
      refDate: createdAt,
    });
    const taskerId =
      status === TaskStatus.ASSIGNED ||
      status === TaskStatus.SUBMITTED ||
      status === TaskStatus.COMPLETED
        ? faker.helpers.arrayElement(userIds.filter((id) => id !== ownerId))
        : null;
    return {
      id: faker.string.uuid(),
      title: faker.helpers.weightedArrayElement([
        { weight: 35, value: `Need help with ${faker.hacker.noun()}` },
        { weight: 35, value: `${faker.company.buzzVerb()} ${faker.company.buzzNoun()} task` },
        { weight: 30, value: faker.lorem.words({ min: 3, max: 6 }) },
      ]),
      description: faker.helpers.maybe(() => faker.lorem.paragraph(), { probability: 0.75 }) ?? null,
      reward: weightedReward(),
      createdAt,
      deadline,
      ownerId,
      taskerId,
      status,
    };
  });

  await createManyInChunks(taskRows, (chunk) => prisma.task.createMany({ data: chunk }));

  // ---- Proposals (batched) ----
  type ProposalRow = { taskId: string; userId: string; title: string; body: string };

  const proposalRows: ProposalRow[] = [];
  for (const t of taskRows) {
    const proposalCount =
      t.status === TaskStatus.OPEN
        ? faker.number.int({ min: 0, max: MAX_PROPOSALS_PER_TASK })
        : faker.number.int({ min: 1, max: Math.max(2, Math.floor(MAX_PROPOSALS_PER_TASK / 2)) });

    const candidates = userIds.filter((id) => id !== t.ownerId);
    const proposers = faker.helpers.arrayElements(candidates, Math.min(proposalCount, candidates.length));

    if (t.taskerId && !proposers.includes(t.taskerId)) {
      proposers.pop();
      proposers.push(t.taskerId);
    }

    for (const userId of proposers) {
      proposalRows.push({
        taskId: t.id,
        userId,
        title: proposalTitle(),
        body: faker.lorem.sentences({ min: 1, max: 3 }),
      });
    }
  }

  await createManyInChunks(proposalRows, (chunk) => prisma.proposal.createMany({ data: chunk }));

  // ---- Reviews (batched) + in-memory rating rollup ----
  type ReviewRow = {
    taskId: string;
    reviewerId: string;
    revieweeId: string;
    stars: number;
    comment: string;
  };

  const reviewRows: ReviewRow[] = [];
  for (const t of taskRows) {
    if (t.status !== TaskStatus.COMPLETED || !t.taskerId) continue;
    reviewRows.push({
      taskId: t.id,
      reviewerId: t.ownerId,
      revieweeId: t.taskerId,
      stars: pickStars(),
      comment: reviewComment(),
    });
  }

  await createManyInChunks(reviewRows, (chunk) => prisma.review.createMany({ data: chunk }));

  // ---- Refresh tokens (batched; cheap fake hashes — dev data only) ----
  type TokenRow = {
    userId: string;
    tokenHash: string;
    jti: string;
    expiresAt: Date;
    revokedAt: Date | null;
  };

  const tokenRows: TokenRow[] = [];
  const fixtureBoth = userRows.find((u) => u.email === FIXTURE_BOTH_EMAIL)!;
  for (const u of userRows) {
    const tokenCount = faker.number.int(REFRESH_TOKENS_PER_USER);
    for (let i = 0; i < tokenCount; i++) {
      tokenRows.push({
        userId: u.id,
        tokenHash: fakeTokenHash(),
        jti: faker.string.uuid(),
        expiresAt: faker.date.future(),
        revokedAt: null,
      });
    }
    // Deterministic rotation/reuse fixtures on the BOTH account for dev inspection.
    if (u.id === fixtureBoth.id) {
      tokenRows.push(
        {
          userId: u.id,
          tokenHash: fakeTokenHash(),
          jti: "seed-expired-jti-1",
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
          revokedAt: null,
        },
        {
          userId: u.id,
          tokenHash: fakeTokenHash(),
          jti: "seed-revoked-jti-1",
          expiresAt: faker.date.future(),
          revokedAt: new Date(),
        },
      );
    }
  }

  await createManyInChunks(tokenRows, (chunk) => prisma.refreshToken.createMany({ data: chunk }));

  // ---- Ratings from the in-memory review list (one transaction, no N+1) ----
  const sums = new Map<string, { sum: number; count: number }>();
  for (const r of reviewRows) {
    const agg = sums.get(r.revieweeId) ?? { sum: 0, count: 0 };
    agg.sum += r.stars;
    agg.count += 1;
    sums.set(r.revieweeId, agg);
  }

  await prisma.$transaction(
    [...sums.entries()].map(([id, agg]) =>
      prisma.user.update({
        where: { id },
        data: { ratingCount: agg.count, ratingAvg: agg.sum / agg.count },
      }),
    ),
  );

  const counts = await Promise.all([
    prisma.user.count(),
    prisma.task.count(),
    prisma.proposal.count(),
    prisma.review.count(),
    prisma.refreshToken.count(),
  ]);

  console.log(
    `Seeded: ${counts[0]} users, ${counts[1]} tasks, ${counts[2]} proposals, ${counts[3]} reviews, ${counts[4]} refresh tokens.`,
  );
  console.log(
    `Fixtures (password "Password123!"): ${FIXTURE_PASSWORD_EMAIL}, ${FIXTURE_BOTH_EMAIL} (+ expired/revoked token rows), ${FIXTURE_GOOGLE_EMAIL} (Google-only).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
