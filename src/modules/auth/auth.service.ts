import bcrypt from "bcryptjs";
import * as authRepository from "./auth.repository.js";
import { withCache } from "../../plugins/cache.js";

const cacheKeys = {
  user: (userId: string) => `cache:user:${userId}`,
};

// REGISTER
export async function register(fastify: any, data: any) {
    const existing = await authRepository.findUserByEmail(data.email);
    if (existing) throw new Error("EMAIL_EXISTS");

    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await authRepository.createUser(
        data.name,
        data.email,
        passwordHash
    );

    if (!user) throw new Error("CREATE_FAILED");

    const token = fastify.jwt.sign({
        sub: user.id,
        email: user.email
    });

    return { user, token };
}

// LOGIN
export async function login(fastify: any, data: any) {
    const user = await authRepository.findUserByEmail(data.email);
    if (!user) throw new Error("INVALID_CREDENTIALS");

    const validPassword = await bcrypt.compare(data.password, user.password_hash);
    if (!validPassword) throw new Error("INVALID_CREDENTIALS");

    const token = fastify.jwt.sign({
        sub: user.id,
        email: user.email
    });

    return {
        user: {
            id: user.id,
            name: user.name,
            email: user.email
        },
        token
    };
}

// GET CURRENT USER
export async function getMe(userId: string) {
    const user = await withCache(
        cacheKeys.user(userId),
        60, // TTL
        () => authRepository.getUserById(userId)
    )
    if (!user) throw new Error("NOT_FOUND");
    return user;
}