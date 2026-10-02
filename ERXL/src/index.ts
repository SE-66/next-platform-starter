import { analyzeWorkbook } from "./engine";
import { persistAnalysis, type SupabaseEnv } from "./supabase";

interface Env extends SupabaseEnv {
  ASSETS: Fetcher;
}

function applySecurityHeaders(headers: Headers): Headers {
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  );
  headers.set(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  );
  return headers;
}

function json(data: unknown, status = 200): Response {
  const headers = applySecurityHeaders(new Headers());
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");

  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers
  });
}

function looksLikeZip(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 4) return false;
  const header = new Uint8Array(bytes, 0, 4);
  return header[0] === 0x50 && header[1] === 0x4b;
}

async function securedAsset(
  request: Request,
  env: Env
): Promise<Response> {
  const asset = await env.ASSETS.fetch(request);
  const headers = applySecurityHeaders(new Headers(asset.headers));

  return new Response(asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "ERXL", version: "0.4.0" });
    }

    if (url.pathname === "/api/analyze" && request.method === "POST") {
      try {
        const form = await request.formData();
        const upload = form.get("file");

        if (!(upload instanceof File)) {
          return json(
            { error: "Upload an .xlsx file using field name 'file'." },
            400
          );
        }

        if (!upload.name.toLowerCase().endsWith(".xlsx")) {
          return json(
            { error: "ERXL accepts .xlsx files only." },
            415
          );
        }

        const maxBytes = 12 * 1024 * 1024;
        if (upload.size > maxBytes) {
          return json(
            { error: "Workbook exceeds the 12 MB MVP limit." },
            413
          );
        }

        const bytes = await upload.arrayBuffer();
        if (!looksLikeZip(bytes)) {
          return json(
            { error: "The uploaded file does not appear to be a valid .xlsx container." },
            415
          );
        }

        const result = analyzeWorkbook(bytes, upload.name);

        let persistence: "saved" | "not_configured" | "failed" =
          "not_configured";

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

    return securedAsset(request, env);
  }
} satisfies ExportedHandler<Env>;
