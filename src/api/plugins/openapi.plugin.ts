import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

const openapiPluginCallback: FastifyPluginAsync = async (app) => {
  await app.register(swagger, {
    transform: jsonSchemaTransform,
    transformObject: (document) => {
      const swaggerObject =
        "openapiObject" in document
          ? (document as any).openapiObject
          : (document as any).swaggerObject;
      const operation = swaggerObject.paths?.["/v1/voices"]?.post;
      if (operation) {
        Object.assign(operation, {
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["name", "audio"],
                  properties: {
                    name: { type: "string", maxLength: 100 },
                    audio: { type: "string", format: "binary" },
                    voice_settings: {
                      type: "string",
                      description:
                        "Optional JSON object with speed, volume, paragraph_pause_ms and seed",
                    },
                  },
                },
              },
            },
          },
        });
      }
      return swaggerObject;
    },
    openapi: {
      info: {
        title: "Self Hosted TTS",
        version: "0.1.0",
        description:
          "Private asynchronous Spanish TTS. Jobs require both audio and alignment to succeed.",
      },
      components: {
        securitySchemes: { apiKey: { type: "http", scheme: "bearer" } },
      },
      security: [{ apiKey: [] }],
    },
  });

  await app.register(swaggerUI, { routePrefix: "/docs" });
};

export const openapiPlugin = fp(openapiPluginCallback, {
  name: "openapi-plugin",
});
