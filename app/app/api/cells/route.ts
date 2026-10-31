import { loadCells } from "@/lib/cells";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await loadCells());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not read road data." }, { status: 500 });
  }
}
