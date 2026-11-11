import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import QRCode from 'qrcode';
import { EmployeeInput, EmployeePatch, type Employee, type PairingCodeResponse } from '@reaplift/calls-shared';
import { isUniqueViolation, type Database } from '../../lib/db.js';
import { audit } from '../../lib/audit.js';
import { sendError } from '../../lib/errors.js';
import { normalizeCompanyNumber } from '../../lib/phone.js';
import { createPairingCode } from './pairing.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  name: string;
  emp_code: string | null;
  company_number: string;
  status: Employee['status'];
  created_at: Date;
  brand: string | null;
  model: string | null;
  android_version: string | null;
  app_version: string | null;
  sim_slot: number | null;
  sim_carrier: string | null;
  paired_at: Date | null;
  last_sync_at: Date | null;
}

const toEmployee = (r: Row): Employee => ({
  id: r.id,
  name: r.name,
  empCode: r.emp_code,
  companyNumber: r.company_number,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  device: r.paired_at
    ? {
        brand: r.brand,
        model: r.model,
        androidVersion: r.android_version,
        appVersion: r.app_version,
        simSlot: r.sim_slot,
        simCarrier: r.sim_carrier,
        pairedAt: r.paired_at.toISOString(),
        lastSyncAt: r.last_sync_at?.toISOString() ?? null,
      }
    : null,
});

const SELECT = sql`
  select e.id, e.name, e.emp_code, e.company_number, e.status, e.created_at,
         d.brand, d.model, d.android_version, d.app_version, d.sim_slot, d.sim_carrier, d.paired_at, d.last_sync_at
  from employees e left join devices d on d.employee_id = e.id and d.company_id = e.company_id and d.revoked_at is null
`;

/** A company SIM number belongs to one active employee in one company (D11), so the clash may be in another company. */
const NUMBER_IN_USE = 'This company SIM number or employee code already belongs to another active employee';

export function registerEmployeeRoutes(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; now: () => Date; publicBaseUrl: string; pairingCodeHours: number },
) {
  const { db, now, publicBaseUrl, pairingCodeHours } = deps;

  /** Another company's employee is "not found", never "forbidden": its existence is not revealed. */
  const readOne = async (companyId: number, id: string) =>
    UUID.test(id)
      ? (await sql<Row>`${SELECT} where e.company_id = ${companyId} and e.id = ${id}`.execute(db)).rows[0]
      : undefined;

  app.get('/api/employees', async (req, reply) => {
    const rows = (await sql<Row>`${SELECT} where e.company_id = ${req.scope!.companyId} order by e.status, e.name`.execute(db)).rows;
    return reply.code(200).send({ items: rows.map(toEmployee) });
  });

  app.post('/api/employees', async (req, reply) => {
    const { companyId } = req.scope!;
    const parsed = EmployeeInput.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Name and company SIM number are required');
    const number = normalizeCompanyNumber(parsed.data.companyNumber);
    if (!number) return sendError(reply, 400, 'INVALID_REQUEST', 'The company SIM number must be an Indian mobile number');
    try {
      const id = (
        await sql<{ id: string }>`
          insert into employees (company_id, name, emp_code, company_number)
          values (${companyId}, ${parsed.data.name}, ${parsed.data.empCode || null}, ${number}) returning id
        `.execute(db)
      ).rows[0]!.id;
      await audit(db, { companyId, userId: req.auth!.userId, action: 'employee.created', targetType: 'employee', targetId: id });
      return reply.code(201).send(toEmployee((await readOne(companyId, id))!));
    } catch (err) {
      if (isUniqueViolation(err)) return sendError(reply, 409, 'NUMBER_IN_USE', NUMBER_IN_USE);
      throw err;
    }
  });

  app.patch('/api/employees/:id', async (req, reply) => {
    const { companyId } = req.scope!;
    const { id } = req.params as { id: string };
    const existing = await readOne(companyId, id);
    if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const parsed = EmployeePatch.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Check the fields');
    const p = parsed.data;
    let number = existing.company_number;
    if (p.companyNumber !== undefined) {
      const n = normalizeCompanyNumber(p.companyNumber);
      if (!n) return sendError(reply, 400, 'INVALID_REQUEST', 'The company SIM number must be an Indian mobile number');
      number = n;
    }
    const at = now();
    const leaving = p.status === 'left' && existing.status === 'active';
    try {
      await db.transaction().execute(async (trx) => {
        await sql`
          update employees set
            name = ${p.name ?? existing.name},
            emp_code = ${p.empCode === undefined ? existing.emp_code : p.empCode || null},
            company_number = ${number},
            status = ${p.status ?? existing.status},
            left_at = ${leaving ? at : p.status === 'active' ? null : sql`left_at`}
          where company_id = ${companyId} and id = ${id}
        `.execute(trx);
        // Someone who leaves stops syncing at once.
        if (leaving)
          await sql`
            update devices set revoked_at = ${at}
            where company_id = ${companyId} and employee_id = ${id} and revoked_at is null
          `.execute(trx);
        await audit(trx, {
          companyId,
          userId: req.auth!.userId,
          action: leaving ? 'employee.left' : 'employee.updated',
          targetType: 'employee',
          targetId: id,
          details: p,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) return sendError(reply, 409, 'NUMBER_IN_USE', NUMBER_IN_USE);
      throw err;
    }
    return reply.code(200).send(toEmployee((await readOne(companyId, id))!));
  });

  app.post('/api/employees/:id/pairing-code', async (req, reply) => {
    const { companyId } = req.scope!;
    const { id } = req.params as { id: string };
    const existing = await readOne(companyId, id);
    if (!existing || existing.status !== 'active') return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const { code, expiresAt } = await createPairingCode(db, {
      companyId,
      employeeId: id,
      createdBy: req.auth!.userId,
      hours: pairingCodeHours,
      now: now(),
    });
    await audit(db, { companyId, userId: req.auth!.userId, action: 'pairing_code.created', targetType: 'employee', targetId: id });
    const installUrl = `${publicBaseUrl.replace(/\/$/, '')}/i/${code}`;
    const body: PairingCodeResponse = {
      code,
      expiresAt: expiresAt.toISOString(),
      installUrl,
      qrSvg: await QRCode.toString(installUrl, { type: 'svg', margin: 1, width: 240 }),
    };
    return reply.code(201).send(body);
  });

  app.post('/api/employees/:id/revoke-device', async (req, reply) => {
    const { companyId } = req.scope!;
    const { id } = req.params as { id: string };
    if (!(await readOne(companyId, id))) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const revoked = await sql`
      update devices set revoked_at = ${now()} where company_id = ${companyId} and employee_id = ${id} and revoked_at is null
    `.execute(db);
    if (Number(revoked.numAffectedRows ?? 0) > 0) {
      await audit(db, { companyId, userId: req.auth!.userId, action: 'device.revoked', targetType: 'employee', targetId: id });
    }
    return reply.code(204).send();
  });
}
