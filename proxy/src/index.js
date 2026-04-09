/**
 * nnnBLAST CORS Proxy — Cloudflare Worker
 *
 * Forwards requests to NCBI APIs and adds CORS headers.
 * Only allows requests to ncbi.nlm.nih.gov domains.
 *
 * Usage: fetch("https://your-worker.workers.dev/?url=https://blast.ncbi.nlm.nih.gov/...")
 *
 * Deploy: npx wrangler deploy
 */

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const target = url.searchParams.get("url");

    if (!target) {
      return new Response(
        JSON.stringify({ error: "Missing ?url= parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Only allow NCBI domains
    const targetUrl = new URL(target);
    if (!targetUrl.hostname.endsWith("ncbi.nlm.nih.gov")) {
      return new Response(
        JSON.stringify({ error: "Only NCBI URLs are allowed" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      // Forward the request to NCBI
      const ncbiResponse = await fetch(target, {
        method: request.method,
        body: request.method === "POST" ? await request.text() : undefined,
        headers: {
          "Content-Type": request.headers.get("Content-Type") || "application/x-www-form-urlencoded",
        },
      });

      // Add CORS headers to response
      const headers = new Headers(ncbiResponse.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

      return new Response(ncbiResponse.body, {
        status: ncbiResponse.status,
        headers,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Proxy error: ${err.message}` }),
        { status: 502, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }
  },
};
