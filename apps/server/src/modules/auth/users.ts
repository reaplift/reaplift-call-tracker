import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';
import { hashPassword } from '../../lib/auth.js';

export const USER_ROLES = ['admin', 'manager'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const MIN_PASSWORD_LENGTH = 10;

export class UserInputError extends Error {}

/** Creates a panel login with an argon2id password hash. The plain password is never stored or logged. */
export async function createUser(
  db: Kysely<Database>,
  input: { email: string; name: string; role: UserRole; password: string },
): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!USER_ROLES.includes(input.role)) throw new UserInputError(`role must be one of ${USER_ROLES.join(', ')}`);
  if (!email.includes('@')) throw new UserInputError('email is not valid');
  if (!name) throw new UserInputError('name is required');
  if (input.password.length < MIN_PASSWORD_LENGTH)
    throw new UserInputError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  try {
    const result = await sql<{ id: string }>`
      insert into users (email, name, role, password_hash)
      values (${email}, ${name}, ${input.role}, ${await hashPassword(input.password)})
      returning id
    `.execute(db);
    return { id: result.rows[0]!.id };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new UserInputError(`${email} already has a login`);
    throw err;
  }
}
