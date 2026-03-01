"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../generated/prisma/client");
const enums_1 = require("../generated/prisma/enums");
const db_1 = require("../src/services/db");
const faker_1 = require("@faker-js/faker");
const bcrypt_1 = __importDefault(require("bcrypt"));
const SEED = 1337;
const USER_COUNT = 500;
const TASK_COUNT = 5000;
const MAX_PROPOSALS_PER_TASK = 8;
const REFRESH_TOKENS_PER_USER = { min: 0, max: 3 };
function pickStatus() {
    return faker_1.faker.helpers.weightedArrayElement([
        { weight: 55, value: enums_1.TaskStatus.OPEN },
        { weight: 15, value: enums_1.TaskStatus.ASSIGNED },
        { weight: 20, value: enums_1.TaskStatus.COMPLETED },
        { weight: 10, value: enums_1.TaskStatus.CANCELLED },
    ]);
}
function weightedReward() {
    const amount = faker_1.faker.helpers.weightedArrayElement([
        { weight: 60, value: faker_1.faker.number.int({ min: 50, max: 200 }) },
        { weight: 30, value: faker_1.faker.number.int({ min: 200, max: 500 }) },
        { weight: 10, value: faker_1.faker.number.int({ min: 500, max: 1500 }) },
    ]);
    return new client_1.Prisma.Decimal(amount);
}
function safeUsername(base) {
    const slug = base
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 12);
    return `${slug}${faker_1.faker.number.int({ min: 10, max: 9999 })}`;
}
async function main() {
    faker_1.faker.seed(SEED);
    await db_1.prisma.review.deleteMany();
    await db_1.prisma.proposal.deleteMany();
    await db_1.prisma.refreshToken.deleteMany();
    await db_1.prisma.task.deleteMany();
    await db_1.prisma.user.deleteMany();
    const passwordHash = await bcrypt_1.default.hash("Password123!", 10);
    const users = await Promise.all(Array.from({ length: USER_COUNT }).map(async () => {
        const firstName = faker_1.faker.person.firstName();
        const lastName = faker_1.faker.person.lastName();
        const username = safeUsername(`${firstName}${lastName}`);
        return db_1.prisma.user.create({
            data: {
                username,
                email: faker_1.faker.internet.email({ firstName, lastName }).toLowerCase(),
                firstName,
                lastName,
                middleName: faker_1.faker.helpers.maybe(() => faker_1.faker.person.middleName(), { probability: 0.25 }) ?? null,
                passwordHash,
            },
        });
    }));
    const userIds = users.map((u) => u.id);
    const tasks = [];
    for (let i = 0; i < TASK_COUNT; i++) {
        const ownerId = faker_1.faker.helpers.arrayElement(userIds);
        const status = pickStatus();
        const createdAt = faker_1.faker.date.recent({ days: 30 });
        const deadline = faker_1.faker.date.soon({
            days: faker_1.faker.helpers.weightedArrayElement([
                { weight: 50, value: 3 },
                { weight: 30, value: 7 },
                { weight: 20, value: 14 },
            ]),
            refDate: createdAt,
        });
        let taskerId = null;
        if (status === enums_1.TaskStatus.ASSIGNED || status === enums_1.TaskStatus.COMPLETED) {
            taskerId = faker_1.faker.helpers.arrayElement(userIds.filter((id) => id !== ownerId));
        }
        const task = await db_1.prisma.task.create({
            data: {
                title: faker_1.faker.helpers.weightedArrayElement([
                    { weight: 35, value: `Need help with ${faker_1.faker.hacker.noun()}` },
                    { weight: 35, value: `${faker_1.faker.company.buzzVerb()} ${faker_1.faker.company.buzzNoun()} task` },
                    { weight: 30, value: faker_1.faker.lorem.words({ min: 3, max: 6 }) },
                ]),
                description: faker_1.faker.helpers.maybe(() => faker_1.faker.lorem.paragraph(), { probability: 0.75 }) ?? null,
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
        const proposalCount = t.status === enums_1.TaskStatus.OPEN
            ? faker_1.faker.number.int({ min: 0, max: MAX_PROPOSALS_PER_TASK })
            : faker_1.faker.number.int({ min: 1, max: Math.max(2, Math.floor(MAX_PROPOSALS_PER_TASK / 2)) });
        const candidates = userIds.filter((id) => id !== t.ownerId);
        const proposers = faker_1.faker.helpers.arrayElements(candidates, Math.min(proposalCount, candidates.length));
        if (t.taskerId && !proposers.includes(t.taskerId)) {
            proposers.pop();
            proposers.push(t.taskerId);
        }
        for (const userId of proposers) {
            await db_1.prisma.proposal.create({
                data: {
                    taskId: t.id,
                    userId,
                    title: faker_1.faker.helpers.weightedArrayElement([
                        { weight: 50, value: "I can do this today" },
                        { weight: 30, value: "Experienced and ready to help" },
                        { weight: 20, value: "Fast and reliable service" },
                    ]),
                    body: faker_1.faker.lorem.sentences({ min: 1, max: 3 }),
                },
            });
        }
    }
    const reviewsCreated = [];
    for (const t of tasks) {
        if (t.status !== enums_1.TaskStatus.COMPLETED)
            continue;
        if (!t.taskerId)
            continue;
        const stars = faker_1.faker.helpers.weightedArrayElement([
            { weight: 5, value: 1 },
            { weight: 8, value: 2 },
            { weight: 17, value: 3 },
            { weight: 35, value: 4 },
            { weight: 35, value: 5 },
        ]);
        await db_1.prisma.review.create({
            data: {
                taskId: t.id,
                reviewerId: t.ownerId,
                revieweeId: t.taskerId,
                stars,
                comment: faker_1.faker.helpers.weightedArrayElement([
                    { weight: 45, value: "Good work and finished on time." },
                    { weight: 35, value: "Great communication and very reliable." },
                    { weight: 20, value: faker_1.faker.lorem.sentence() },
                ]),
            },
        });
        reviewsCreated.push({ revieweeId: t.taskerId, stars });
    }
    for (const u of users) {
        const tokenCount = faker_1.faker.number.int(REFRESH_TOKENS_PER_USER);
        for (let i = 0; i < tokenCount; i++) {
            await db_1.prisma.refreshToken.create({
                data: {
                    userId: u.id,
                    tokenHash: await bcrypt_1.default.hash(faker_1.faker.string.uuid(), 8),
                },
            });
        }
    }
    for (const u of users) {
        const agg = await db_1.prisma.review.aggregate({
            where: { revieweeId: u.id },
            _avg: { stars: true },
            _count: { stars: true },
        });
        const ratingCount = agg._count.stars ?? 0;
        const ratingAvg = agg._avg.stars ?? 0;
        await db_1.prisma.user.update({
            where: { id: u.id },
            data: {
                ratingCount,
                ratingAvg,
            },
        });
    }
    console.log(`Seeded: ${users.length} users, ${tasks.length} tasks, proposals, reviews, refresh tokens.`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await db_1.prisma.$disconnect();
});
