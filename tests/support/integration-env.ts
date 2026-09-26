import { testDatabaseUrl } from './test-db-url';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.APP_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret-000';
process.env.EMAIL_TRANSPORT = 'console';
process.env.LOG_LEVEL = 'error';
