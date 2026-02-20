import { Request, Response, NextFunction } from "express";
import { verify } from "jsonwebtoken";



const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET!

export function authorizeUser(req: Request, res:Response, next: NextFunction) {
    const accessToken: string | undefined= req.cookies?.access_token
    if (!accessToken) {
        return res.status(401).json({ok: false, message: "Invalid Credentials"})
    }
    
    let payload: {userId: string}
    try {
        payload = verify(accessToken, accessTokenSecret) as {userId: string}
        res.locals.userId = payload.userId
        return next()
    } catch {
        return res.status(401).json({ok: false, message: "Invalid Credentials"})
    }
}
