/**
 * Operator commands: `pnpm --filter @reaplift/calls-server cli <command> [--flag value ...]`.
 *
 *   create-company --id <CRM company number> --name <n>
 *       Adds a client company (D11). The id must be the CRM's company number.
 *   create-user --email <e> --name <n> [--role super_admin|admin|manager] [--company <id>]
 *       Prompts for the password (not echoed). Reads it from stdin when not run in a terminal.
 *       Admins and managers need --company; a super admin has none.
 *   unlock-user --email <e>
 *       Opens a login locked by wrong passwords.
 *   seed-dev
 *       Local development only: company 1 "ReapLift (dev)", super admin `super@reaplift.local`, admin
 *       `admin@reaplift.local` and M1's worked-example employee; password `calls-dev-1`.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { sql } from 'kysely';
import { loadConfig } from './config.js';
import { createDb, createPool } from './lib/db.js';
import { createUser, UserInputError, USER_ROLES, type UserRole } from './modules/auth/users.js';
import { seedOutcomes } from './modules/outcomes/defaults.js';

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
      case 'create-company': {
        const f = flags(rest);
        const id = Number(f.id);
        if (!Number.isSafeInteger(id) || id <= 0 || !f.name?.trim())
          throw new UserInputError('usage: create-company --id <CRM company number> --name <n>');
        await sql`insert into companies (id, name) values (${id}, ${f.name.trim()})`.execute(db);
        await seedOutcomes(db, id);
        console.log(`created company ${id} ${f.name.trim()}`);
        break;
      }
      case 'create-user': {
        const f = flags(rest);
        const role = (f.role ?? 'admin') as UserRole;
        const companyId = f.company ? Number(f.company) : null;
        if (!f.email || !f.name || !USER_ROLES.includes(role) || (companyId !== null && !Number.isSafeInteger(companyId)))
          throw new UserInputError('usage: create-user --email <e> --name <n> [--role super_admin|admin|manager] [--company <id>]');
        const { id } = await createUser(db, { email: f.email, name: f.name, role, companyId, password: await readSecret('Password') });
        console.log(`created ${role} ${f.email} (${id})`);
        break;
      }
      case 'unlock-user': {
        const f = flags(rest);
        const done = await sql`
          update users set login_locked_at = null, failed_login_count = null where email = ${(f.email ?? '').toLowerCase()}
        `.execute(db);
        if (Number(done.numAffectedRows ?? 0) === 0) throw new UserInputError(`no login for ${f.email}`);
        console.log(`unlocked ${f.email}`);
        break;
      }
      case 'seed-dev': {
        if (process.env.NODE_ENV === 'production') throw new UserInputError('seed-dev is for local development only');
        await sql`insert ignore into companies (id, name) values (1, 'ReapLift (dev)')`.execute(db);
        await seedOutcomes(db, 1);
        for (const u of [
          { email: 'super@reaplift.local', name: 'ReapLift super admin', role: 'super_admin' as const, companyId: null },
          { email: 'admin@reaplift.local', name: 'Dev admin', role: 'admin' as const, companyId: 1 },
        ]) {
          const exists = await sql`select 1 from users where email = ${u.email}`.execute(db);
          if (!exists.rows.length) await createUser(db, { ...u, password: DEV_PASSWORD });
        }
        await sql`
          insert ignore into employees (company_id, name, emp_code, company_number) values (1, 'Ravi Kumar', 'E-1042', '919812345678')
        `.execute(db);
        console.log(`seeded company 1, super@reaplift.local and admin@reaplift.local (password ${DEV_PASSWORD}), employee Ravi Kumar`);
        break;
      }
      default:
        throw new UserInputError('commands: create-company, create-user, unlock-user, seed-dev');
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err instanceof UserInputError ? err.message : err);
  process.exit(1);
});
