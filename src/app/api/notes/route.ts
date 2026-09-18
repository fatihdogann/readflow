import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { createNote, listNotes } from "@/lib/db/repo/notes";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20_000),
  folderId: z.number().int().positive().nullable(),
});

export async function GET(): Promise<Response> {
  try {
    return Response.json({ notes: listNotes(getDb()) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = createSchema.parse(await readJsonBody(request));
    return Response.json({ note: createNote(getDb(), body) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
