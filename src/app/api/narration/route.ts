import { NextRequest, NextResponse } from "next/server";

function isAllowedNarrationSrc(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    }
    if (parsed.protocol !== "https:") return false;
    if (host.endsWith(".supabase.co") || host.endsWith(".supabase.in")) return true;
    const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (configured) {
      try {
        return host === new URL(configured).hostname.toLowerCase();
      } catch {
        return false;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Same-origin proxy so Safari can decode narration with Web Audio.
 * Signed Supabase URLs often cannot be fetch()'d from the browser (CORS).
 */
export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src");
  if (!src || !isAllowedNarrationSrc(src)) {
    return NextResponse.json({ error: "invalid src" }, { status: 400 });
  }

  const upstream = await fetch(src);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "upstream failed" },
      { status: upstream.status || 502 },
    );
  }

  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
    },
  });
}
