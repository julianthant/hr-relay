import { z } from "zod";
import {
schemaError
} from "../errors.js";


export function parseOrThrow<Schema extends z.ZodType>(schema: Schema, context: string, body: unknown): z.output<Schema> {
  try {
    return schema.parse(body);
  } catch (error) {
    throw schemaError(context, error);
  }
}
