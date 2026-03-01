"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeUser = authorizeUser;
const jsonwebtoken_1 = require("jsonwebtoken");
const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET;
function authorizeUser(req, res, next) {
    const accessToken = req.cookies?.access_token;
    if (!accessToken) {
        return res.status(401).json({ ok: false, message: "Invalid Credentials" });
    }
    let payload;
    try {
        payload = (0, jsonwebtoken_1.verify)(accessToken, accessTokenSecret);
        res.locals.userId = payload.userId;
        return next();
    }
    catch {
        return res.status(401).json({ ok: false, message: "Invalid Credentials" });
    }
}
