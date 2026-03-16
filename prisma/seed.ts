import { Prisma } from "../generated/prisma/client";
import { TaskStatus } from "../generated/prisma/enums";
import { prisma } from "../src/services/db";
import { faker } from "@faker-js/faker";
import bcrypt from "bcrypt";


const SEED = 1337;
const USER_COUNT = 500;
const TASK_COUNT = 5000;
const MAX_PROPOSALS_PER_TASK = 8;
const REFRESH_TOKENS_PER_USER = { min: 0, max: 3 };

function pickStatus(): TaskStatus {
  return faker.helpers.weightedArrayElement<TaskStatus>([
    { weight: 55, value: TaskStatus.OPEN },
    { weight: 15, value: TaskStatus.ASSIGNED },
    { weight: 20, value: TaskStatus.COMPLETED },
    { weight: 10, value: TaskStatus.CANCELLED },
  ]);
}

function weightedReward(): Prisma.Decimal {
  const amount = faker.helpers.weightedArrayElement<number>([
    { weight: 60, value: faker.number.int({ min: 50, max: 200 }) },
    { weight: 30, value: faker.number.int({ min: 200, max: 500 }) },
    { weight: 10, value: faker.number.int({ min: 500, max: 1500 }) },
  ]);

  return new Prisma.Decimal(amount);
}

function safeUsername(base: string) {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
  return `${slug}${faker.number.int({ min: 10, max: 9999 })}`;
}

async function main() {
  faker.seed(SEED);

  await prisma.review.deleteMany();
  await prisma.proposal.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.task.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("Password123!", 10);

  const users = await Promise.all(
    Array.from({ length: USER_COUNT }).map(async () => {
      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();
      const username = safeUsername(`${firstName}${lastName}`);

      return prisma.user.create({
        data: {
          username,
          email: faker.internet.email({ firstName, lastName }).toLowerCase(),
          firstName,
          lastName,
          middleName: faker.helpers.maybe(() => faker.person.middleName(), { probability: 0.25 }) ?? null,
          passwordHash,
        },
      });
    })
  );

  const userIds = users.map((u) => u.id);

  const tasks: Array<{ id: string; ownerId: string; taskerId: string | null; status: TaskStatus }> = [];

  for (let i = 0; i < TASK_COUNT; i++) {
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

    let taskerId: string | null = null;
    if (status === TaskStatus.ASSIGNED || status === TaskStatus.COMPLETED) {
      taskerId = faker.helpers.arrayElement(userIds.filter((id) => id !== ownerId));
    }

    const task = await prisma.task.create({
      data: {
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
      },
      select: { id: true, ownerId: true, taskerId: true, status: true },
    });

    tasks.push({ id: task.id, ownerId: task.ownerId, taskerId: task.taskerId ?? null, status: task.status });
  }

  for (const t of tasks) {
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
      await prisma.proposal.create({
        data: {
          taskId: t.id,
          userId,
          title: faker.helpers.weightedArrayElement([
            { weight: 50, value: "I can do this today" },
            { weight: 30, value: "Experienced and ready to help" },
            { weight: 20, value: "Fast and reliable service" },
          ]),
          body: faker.lorem.sentences({ min: 1, max: 3 }),
        },
      });
    }
  }

  const reviewsCreated: Array<{ revieweeId: string; stars: number }> = [];

  for (const t of tasks) {
    if (t.status !== TaskStatus.COMPLETED) continue;
    if (!t.taskerId) continue;

    const stars = faker.helpers.weightedArrayElement<number>([
      { weight: 5, value: 1 },
      { weight: 8, value: 2 },
      { weight: 17, value: 3 },
      { weight: 35, value: 4 },
      { weight: 35, value: 5 },
    ]);

    await prisma.review.create({
      data: {
        taskId: t.id,
        reviewerId: t.ownerId,
        revieweeId: t.taskerId,
        stars,
        comment: faker.helpers.weightedArrayElement([
          { weight: 45, value: "Good work and finished on time." },
          { weight: 35, value: "Great communication and very reliable." },
          { weight: 20, value: faker.lorem.sentence() },
        ]),
      },
    });

    reviewsCreated.push({ revieweeId: t.taskerId, stars });
  }

  for (const u of users) {
    const tokenCount = faker.number.int(REFRESH_TOKENS_PER_USER);
    for (let i = 0; i < tokenCount; i++) {
      await prisma.refreshToken.create({
        data: {
          userId: u.id,
          tokenHash: await bcrypt.hash(faker.string.uuid(), 8),
        },
      });
    }
  }

  for (const u of users) {
    const agg = await prisma.review.aggregate({
      where: { revieweeId: u.id },
      _avg: { stars: true },
      _count: { stars: true },
    });

    const ratingCount = agg._count.stars ?? 0;
    const ratingAvg = agg._avg.stars ?? 0;

    await prisma.user.update({
      where: { id: u.id },
      data: {
        ratingCount,
        ratingAvg,
      },
    });
  }

  console.log(
    `Seeded: ${users.length} users, ${tasks.length} tasks, proposals, reviews, refresh tokens.`
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