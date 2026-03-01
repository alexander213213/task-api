"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertNever = assertNever;
function assertNever(x) {
    throw new Error("This case never throws");
}
