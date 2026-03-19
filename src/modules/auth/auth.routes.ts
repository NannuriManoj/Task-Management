import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { dbPool } from "../../config/databases.js";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";

// Validation schema for registration
const registerSchema = z.object({
    name: z.string().min(3).max(20),
    email: z.email(),
    password: z.string().min(6).max(100),
});

// Validation schema for login
const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(6).max(100),
});

// Function to register authentication routes
export async function authRoutes(fastify: FastifyInstance): Promise<void> {

    // POST /auth/register
    // Route for user registration
    fastify.post< { Body: z.infer<typeof registerSchema> } >
        ("/register", async (request, reply) => {

        // Validate the request body against the schema
        const result = registerSchema.safeParse(request.body);
        if (!result.success) {
            return reply.status(400).send({
                error: "Invalid request data",
                details: z.treeifyError(result.error)
            }); 
        }

        // Extract validated data
        const { name, email, password } = result.data;

        // Check if the email is already in use
        const exisiting = await dbPool.query(
            "SELECT id FROM users WHERE email = $1",
             [email]
        );

        if (exisiting.rows.length > 0) {
            return reply.status(400).send({ error: "Email already in use" });
        }

        // Hash the password before storing it in the database
        const passwordHash = await bcrypt.hash(password, 12);

        // Insert the new user into the database and return the created user data
        const { rows } = await dbPool.query< { 
            id: string; 
            name: string; 
            email: string; 
            created_at: Date 
        } >(
            `INSERT INTO users (name, email, password_hash)
            VALUES ($1, $2, $3) 
            RETURNING id, name, email, created_at`,
            [name, email, passwordHash]
        );

        const user = rows[0];
        // If user creation failed, return an error response
        if (!user) {
            return reply.status(500).send({ error: "Failed to create user" });
        }

        // Generate a JWT token for the newly registered user
        const token = fastify.jwt.sign({ 
            sub: user.id, 
            email: user.email 
        });
        
        // Send the response with the created user data and the JWT token
        return reply.status(201).send({ user, token });
    });


    // POST /auth/login
    fastify.post< { Body: z.infer<typeof loginSchema> } >(
        "/login", async (request, reply) => {

            // Validate the request body against the login schema
            const result = loginSchema.safeParse(request.body);
            if (!result.success) {
                return reply.status(400).send({
                    error: "Invalid request data",
                    details: z.treeifyError(result.error)
                }); 
            }
            
            // Extract validated data
            const { email, password } = result.data;

            // Query the database for a user with the provided email
            const { rows } = await dbPool.query< { 
                id: string; 
                name: string; 
                email: string; 
                password_hash: string 
            } >(
                "SELECT id, name, email, password_hash FROM users WHERE email = $1",
                [email]
            );

            // If no user is found with the provided email, return an error response
            const user = rows[0];
            if (!user) {
                return reply.status(401).send({ error: "Invalid email or password" });
            }

            // Compare the provided password with the stored password hash
            const validPassword = await bcrypt.compare(password, user.password_hash);
            if(!validPassword) {
                return reply.status(401).send({ error: "Invalid email or password" });
            }

            // Generate a JWT token for the authenticated user
            const token = fastify.jwt.sign({ 
                sub: user.id, 
                email: user.email 
            });

            // Send the response with the authenticated user data and the JWT token
            return reply.send({ 
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email
                }, 
                token 
            });
        });
    
    fastify.get('/me', {preHandler: [authenticate], 
        handler: async (request, reply) => {
            const userId = request.user.sub;

            const { rows } = await dbPool.query< { 
                id: string; 
                name: string; 
                email: string; 
            } >(
                "SELECT id, name, email FROM users WHERE id = $1",
                [userId]
            );

            if(rows.length === 0) {
                return reply.status(404).send({ error: "User not found" });
            }

            return reply.send({ user: rows[0] });
        },
    });
}