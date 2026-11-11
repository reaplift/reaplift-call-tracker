import { sql, type Kysely } from 'kysely';
import { USER_ROLES, type UserRole } from '@reaplift/calls-shared';
import { isForeignKeyViolation, isUniqueViolation, type Database } from '../../lib/db.js';
import { hashPassword } from '../../lib/auth.js';

export { USER_ROLES, type UserRole };
export const MIN_PASSWORD_LENGTH = 10;

export class UserInputError extends Error {}

/**
 * Creates a panel login with an argon2id password hash. The plain password is never stored or logged.
 * A super admin has no company; an admin or manager must have one (D11).
 */
export async function createUser(
  db: Kysely<Database>,
  input: { email: string; name: string; role: UserRole; password: string; companyId: number | null },
): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!USER_ROLES.includes(input.role)) throw new UserInputError(`role must be one of ${USER_ROLES.join(', ')}`);
  if (input.role === 'super_admin' && input.companyId !== null)
    throw new UserInputError('a super admin belongs to no company');
  if (input.role !== 'super_admin' && input.companyId === null)
    throw new UserInputError(`a ${input.role} needs a company`);
  if (!email.includes('@')) throw new UserInputError('email is not valid');
  if (!name) throw new UserInputError('name is required');
  if (input.password.length < MIN_PASSWORD_LENGTH)
    throw new UserInputError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  try {
    const result = await sql<{ id: string }>`
      insert into users (company_id, email, name, role, password_hash)
      values (${input.companyId}, ${email}, ${name}, ${input.role}, ${await hashPassword(input.password)})
      returning id
    `.execute(db);
    return { id: result.rows[0]!.id };
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserInputError(`${email} already has a login`);
    if (isForeignKeyViolation(err)) throw new UserInputError(`company ${input.companyId} does not exist`);
    throw err;
  }
}
