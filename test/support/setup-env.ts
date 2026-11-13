// Test environment. Points at the LOCAL test database only.
process.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:54322/fsa_test";
process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
process.env.EMAIL_TRANSPORT ??= "capture";
process.env.EMAIL_FROM ??= "Estimates <estimates@example.test>";
