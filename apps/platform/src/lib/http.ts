import { ZodError } from "zod";
import { ApiError } from "./auth";

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return Response.json({ error: "Invalid request", issues: error.issues }, { status: 422 });
  console.error(error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
