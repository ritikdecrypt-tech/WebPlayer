import type { SharedStory, StoryPlayerErrorCode } from "./types";
import { loadSharedStoryDirect } from "./loadSharedStoryDirect";

const SHORT_CODE_RE = /^[a-z0-9]{6}$/;

export class StoryPlayerFetchError extends Error {
  code: StoryPlayerErrorCode;
  status: number;

  constructor(code: StoryPlayerErrorCode, status = 400) {
    super(code);
    this.name = "StoryPlayerFetchError";
    this.code = code;
    this.status = status;
  }
}

export function isValidShortCode(value: string): boolean {
  return SHORT_CODE_RE.test(value);
}

/**
 * Loads a shared story for `/s/[code]`.
 * Prefers direct Supabase access (service role) so local/dev works even when
 * the remote `story-player` edge function is outdated; falls back to the
 * edge function when no service role key is configured.
 */
export async function fetchSharedStory(shortCode: string): Promise<SharedStory> {
  if (!isValidShortCode(shortCode)) {
    throw new StoryPlayerFetchError("invalid_short_code", 400);
  }

  // Local playback requires the service role until the remote story-player
  // edge function is redeployed with the current schema.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new StoryPlayerFetchError("config_missing", 500);
  }

  return loadSharedStoryDirect(shortCode);
}

export function errorMessageFor(code: StoryPlayerErrorCode): string {
  switch (code) {
    case "invalid_short_code":
      return "That link doesn’t look right. Check the 6-character code in the URL.";
    case "not_found":
      return "We couldn’t find a story for this link.";
    case "link_expired":
      return "This share link is no longer active.";
    case "content_unavailable":
      return "This story isn’t ready to watch yet — or the story-player API needs updating.";
    case "network_error":
      return "Couldn’t reach Kinora. Check your connection and try again.";
    case "config_missing":
      return "Add SUPABASE_SERVICE_ROLE_KEY to web-player/.env.local, then restart npm run dev.";
    default:
      return "Something went wrong loading this story.";
  }
}
