import 'dotenv/config';
import { z } from 'zod';

// Define the schema for environment variables
const envSchema = z.object ({
    DATABASE_URL: z.url(),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),
    JWT_SECRET: z.string().min(1, "JWT_SECRET is required")
});

// Parse and validate the environment variables
const parsed = envSchema.safeParse(process.env);

// If parsing fails, log the errors and exit the process
if(!parsed.success){
    console.error("Missing or invalid environment variables");
    // Log each validation issue
    for (const issue of parsed.error.issues) {
        console.error(`- ${issue.path.join('.')} : ${issue.message}`);
    }
    process.exit(1);
}

export const env = parsed.data;