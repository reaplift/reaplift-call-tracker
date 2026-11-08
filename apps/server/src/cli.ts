/**
 * Operator commands: `pnpm --filter @reaplift/calls-server cli <command> [--flag value ...]`.
 *
 *   create-user --email <e> --name <n> [--role admin|manager]
 *       Prompts for the password (not echoed). Reads it from stdin when not run in a terminal.
 *   unlock-user --email <e>
 *       Opens a login locked by wrong passwords.
 *   seed-dev
 *       Local development only: admin `admin@reaplift.local` and M1's worked-example employee, password `calls-dev-1`.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { sql } from 'kysely';
import { loadConfig } from './config.js';
import { createDb, createPool } from './lib/db.js';
import { createUser, UserInputError, USER_ROLES, type UserRole } from './modules/auth/users.js';

const DEV_PASSWORD = 'calls-dev-1';

function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!key?.startsWith('--') || args[i + 1] === undefined) throw new UserInputError(`expected --flag value at "${key}"`);
    out[key.slice(2)] = args[i + 1]!;
  }
  return out;
}

/** Reads a secret without echoing it, asking twice in a terminal. */
async function readSecret(label: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
  const ask = (q: string) =>
    new Promise<string>((resolve) => {
      rl.question(q, (a) => {
        if (process.stdin.isTTY) process.stdout.write('\n');
        resolve(a);
      });
      muted = true;
    });
  const first = await ask(`${label}: `);
  muted = false;
  const second = process.stdin.isTTY ? await ask(`Repeat ${label.toLowerCase()}: `) : first;
  rl.close();
  if (first !== second) throw new UserInputError(`${label.toLowerCase()}s do not match`);
  return first;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const config = loadConfig(process.env, []);
  const db = createDb(createPool(config.DATABASE_URL));
  try {
    switch (command) {
      case 'create-user': {
        const f = flags(rest);
        const role = (f.role ?? 'admin') as UserRole;
        if (!f.email || !f.name || !USER_ROLES.includes(role))
          throw new UserInputError('usage: create-user --email <e> --name <n> [--role admin|manager]');
        const { id } = await createUser(db, { email: f.email, name: f.name, role, password: await readSecret('Password') });
        console.log(`created ${role} ${f.email} (${id})`);
        break;
      }
      case 'unlock-user': {
        const f = flags(rest);
        const done = await sql`
          update users set login_locked_at = null, failed_login_count = null where email = ${(f.email ?? '').toLowerCase()} returning id
        `.execute(db);
        if (!done.rows.length) throw new UserInputError(`no login for ${f.email}`);
        console.log(`unlocked ${f.email}`);
        break;
      }
      case 'seed-dev': {
        if (process.env.NODE_ENV === 'production') throw new UserInputError('seed-dev is for local development only');
        const exists = await sql`select 1 from users where email = 'admin@reaplift.local'`.execute(db);
        if (!exists.rows.length) {
          await createUser(db, { email: 'admin@reaplift.local', name: 'Nikhila (admin)', role: 'admin', password: DEV_PASSWORD });
        }
        await sql`
          insert into employees (name, emp_code, company_number) values ('Ravi Kumar', 'E-1042', '919812345678')
          on conflict do nothing
        `.execute(db);
        console.log(`seeded admin@reaplift.local (password ${DEV_PASSWORD}) and employee Ravi Kumar`);
        break;
      }
      default:
        throw new UserInputError('commands: create-user, unlock-user, seed-dev');
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err instanceof UserInputError ? err.message : err);
  process.exit(1);
});
