import { z } from "zod";
import { callingWindowInputSchema, connectMeTaskSchema } from "./connect-me";

/** Keep field-level runtime errors while describing the same wire variants. */
export function callInputJsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
    override({ zodSchema, jsonSchema }) {
      if (zodSchema === connectMeTaskSchema.shape.callingWindow) {
        const { $schema: _dialect, ...window } = z.toJSONSchema(
          callingWindowInputSchema,
          { io: "input" },
        );
        Object.assign(jsonSchema, window);
      }
    },
  });
}
