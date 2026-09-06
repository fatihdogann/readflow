import { z } from "zod";
import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { createFolder, listFolders } from "@/lib/db/repo/folders";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(80),
});

export async function GET(): Promise<Response> {
  try {
    return Response.json({ folders: listFolders(getDb()) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = createSchema.parse(await readJsonBody(request));
    const folder = createFolder(getDb(), body.name);
    return Response.json({ folder }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
