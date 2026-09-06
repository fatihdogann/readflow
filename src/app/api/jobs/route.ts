import { apiErrorResponse, readJsonBody } from "@/lib/api/http";
import { getDb } from "@/lib/db/connection";
import { createJobWithSnapshot, jobCreateSchema } from "@/lib/jobs/create";
import { listJobsByDocument } from "@/lib/db/repo/jobs";
import { InputError } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = jobCreateSchema.parse(await readJsonBody(request));
    // Snapshot burada sabitlenir: kaynak metin, notlar ve AI yapılandırması.
    const job = createJobWithSnapshot(getDb(), body);
    return Response.json({ job }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const documentId = Number(url.searchParams.get("documentId"));
    if (!Number.isInteger(documentId) || documentId <= 0) {
      throw new InputError("documentId gerekli");
    }
    return Response.json({ jobs: listJobsByDocument(getDb(), documentId, 10) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
