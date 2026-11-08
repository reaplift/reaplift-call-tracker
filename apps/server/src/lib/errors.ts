import type { FastifyReply } from 'fastify';

/** Every error answer: `{ error, message }` (data-model-and-api.md). */
export function sendError(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.code(status).send({ error, message });
}
