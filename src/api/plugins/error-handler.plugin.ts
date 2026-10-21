import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { Fault } from "../../shared/errors/fault.js";

const errorHandlerCallback: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((e, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(e)) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request",
          issues: e.validation,
        },
      });
    }
    if (e instanceof z.ZodError) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request",
          issues: e.issues,
        },
      });
    }
    if (e instanceof Fault) {
      return reply
        .code(e.status)
        .send({ error: { code: e.code, message: e.message } });
    }
    const status = (e as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({
        error: {
          code: "INVALID_REQUEST",
          message:
            status === 413 ? "Upload or request too large" : "Invalid request",
        },
      });
    }
    req.log.error({ err: e }, "API failure");
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error" },
    });
  });
};

export const errorHandlerPlugin = fp(errorHandlerCallback, {
  name: "error-handler-plugin",
});
