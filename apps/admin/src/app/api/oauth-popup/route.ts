import { NextRequest } from "next/server";

/**
 * OAuth landing page for the popup sign-in flow. Better Auth redirects the
 * popup here (callbackURL and errorCallbackURL in sign-in-view.tsx); the
 * page hands the outcome to the opener and closes itself.
 *
 * Lives under /api on purpose: proxy.ts passes /api/* through untouched,
 * while an app route would be caught by the auth/protected redirect logic
 * in both the success and the error state and never render.
 */
export function GET(request: NextRequest) {
    const raw = new URL(request.url).searchParams.get("error");

    // Whitelisted before being embedded in markup — the param is
    // attacker-reachable and must never be interpolated raw
    const error = raw === null ? null : /^[\w-]+$/.test(raw) ? raw : "unknown";

    const html = `<!doctype html>
<html>
  <body style="font-family:sans-serif;padding:24px;text-align:center;color:#6b7280;">
    <p>You can close this window. / Pode fechar esta janela.</p>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: "appload:oauth", error: ${JSON.stringify(error)} }, window.location.origin);
      }
      window.close();
    </script>
  </body>
</html>`;

    return new Response(html, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}
