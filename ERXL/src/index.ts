import { analyzeWorkbook } from "./engine";
import { persistAnalysis, type SupabaseEnv } from "./supabase";

interface Env extends SupabaseEnv {
  ASSETS: Fetcher;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "ERXL", version: "0.1.0" });
    }

    if (url.pathname === "/api/analyze" && request.method === "POST") {
      try {
        const form = await request.formData();
        const upload = form.get("file");

        if (!(upload instanceof File)) {
          return json({ error: "Upload an .xlsx file using field name 'file'." }, 400);
        }

        if (!upload.name.toLowerCase().endsWith(".xlsx")) {
          return json({ error: "ERXL v0.1 accepts .xlsx files only." }, 415);
        }

        const maxBytes = 12 * 1024 * 1024;
        if (upload.size > maxBytes) {
          return json({ error: "Workbook exceeds the 12 MB MVP limit." }, 413);
        }

        const result = analyzeWorkbook(await upload.arrayBuffer(), upload.name);

        let persistence: "saved" | "not_configured" | "failed" = "not_configured";
        if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
          try {
            await persistAnalysis(env, result);
            persistence = "saved";
          } catch (error) {
            persistence = "failed";
            console.error("Supabase persistence error", error);
          }
        }

        return json({ ...result, persistence });
      } catch (error) {
        console.error(error);
        return json(
          {
            error: "Analysis failed.",
            detail: error instanceof Error ? error.message : String(error)
          },
          500
        );
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
