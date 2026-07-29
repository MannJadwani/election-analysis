import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getUser, isAdmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * Issues short-lived client-upload tokens so the browser can PUT an electoral
 * roll PDF straight to Vercel Blob, bypassing the ~4.5 MB serverless request
 * body limit that a multipart POST to /api/ingest hits (FUNCTION_PAYLOAD_TOO_LARGE).
 * Admin only. The client then calls /api/ingest with just the returned blob URL.
 */
export async function POST(req: Request): Promise<NextResponse> {
  // Auth must be resolved before handleUpload consumes the body: the token
  // callback runs inside handleUpload and getSession needs the request headers.
  const user = await getUser(req.headers);
  const body = (await req.json()) as HandleUploadBody;

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        if (!isAdmin(user)) {
          throw new Error("Admin access required");
        }
        return {
          allowedContentTypes: ["application/pdf"],
          // Rolls can be large scanned PDFs; well under Blob's 5 TB ceiling.
          maximumSizeInBytes: 200 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      // Nothing to do on completion — ingestion is kicked off separately by the
      // client once it has the blob URL.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    console.error("[blob/upload] failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
