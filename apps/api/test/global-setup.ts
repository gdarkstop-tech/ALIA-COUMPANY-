import { dropAll, runMigrations } from '../src/db/migrate';

/** Rebuilds the test database schema from the SQL migrations before the suite runs. */
export default async function setup() {
  const owner = process.env.TEST_DATABASE_URL_OWNER ?? `postgres://ghayarly_owner:ghayarly_owner_dev@${process.env.TEST_DATABASE_HOST ?? 'localhost:5432'}/${process.env.TEST_DATABASE_NAME ?? 'ghayarly_test'}`;
  await dropAll(owner);
  await runMigrations(owner, () => undefined);
}
