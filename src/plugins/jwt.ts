import fp from "fastify-plugin";
import FastifyJwt from "@fastify/jwt";
import { type FastifyInstance } from "fastify";
import { env } from "../config/env.js";

export default fp(async (app: FastifyInstance) => {
    await app.register(FastifyJwt, {
        secret: env.JWT_SECRET
    });
});
