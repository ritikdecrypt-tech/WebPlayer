import { createClient } from "@supabase/supabase-js";
import type { PlayerScene, PlayerShot, SharedStory, ShotType } from "./types";
import { StoryPlayerFetchError, isValidShortCode } from "./storyPlayer";

const ILLUSTRATIONS_BUCKET = "illustrations";
const NARRATIONS_BUCKET = "narrations";
const MUSIC_BUCKET = "music_library";
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const SHOT_TYPE_ORDER: ShotType[] = ["wide", "medium", "close"];

function titleFromNarration(text: string): string {
  const first = text.split(/[.!?]/)[0]?.trim() ?? text;
  return first.length > 48 ? `${first.slice(0, 45)}…` : first;
}

/**
 * Loads a shared story directly from Supabase (service role).
 * Used when the remote `story-player` edge function hasn't been redeployed yet.
 * Server-only — never import this into a client component.
 */
export async function loadSharedStoryDirect(shortCode: string): Promise<SharedStory> {
  if (!isValidShortCode(shortCode)) {
    throw new StoryPlayerFetchError("invalid_short_code", 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new StoryPlayerFetchError("config_missing", 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: link, error: linkError } = await supabase
    .from("share_links")
    .select("story_id, parent_id, is_active, show_watermark, show_trial_cta, view_count")
    .eq("short_code", shortCode)
    .maybeSingle();

  if (linkError || !link) {
    throw new StoryPlayerFetchError("not_found", 404);
  }
  if (!link.is_active) {
    throw new StoryPlayerFetchError("link_expired", 410);
  }

  const { data: story, error: storyError } = await supabase
    .from("stories")
    .select(`
      id, title, target_length, music_mood, music_track_id, status,
      child_profiles!inner(display_name)
    `)
    .eq("id", link.story_id)
    .eq("status", "complete")
    .maybeSingle();

  if (storyError || !story) {
    throw new StoryPlayerFetchError("content_unavailable", 404);
  }

  const { data: pages, error: pagesError } = await supabase
    .from("story_pages")
    .select(`
      id, page_number, narrative_text, mood, image_url, motion_video_path,
      illustrations(storage_path, thumbnail_path, status, shots),
      narrations(storage_path)
    `)
    .eq("story_id", story.id)
    .order("page_number", { ascending: true });

  if (pagesError || !pages) {
    throw new StoryPlayerFetchError("content_unavailable", 404);
  }

  let musicUrl: string | null = null;
  if (story.music_track_id) {
    const { data: track } = await supabase
      .from("music_tracks")
      .select("storage_path")
      .eq("id", story.music_track_id)
      .maybeSingle();
    if (track?.storage_path) {
      const filePath = String(track.storage_path).replace(`${MUSIC_BUCKET}/`, "");
      musicUrl = supabase.storage.from(MUSIC_BUCKET).getPublicUrl(filePath).data.publicUrl;
    }
  }

  type RawScene = {
    pageNumber: number;
    text: string;
    mood: string | null;
    shotPaths: { type: ShotType; path: string }[];
    motionPath: string | null;
    narrationPath: string | null;
  };

  const rawScenes: RawScene[] = pages.map((p: Record<string, unknown>) => {
    const illRaw = p.illustrations;
    const ill = Array.isArray(illRaw) ? illRaw[0] : illRaw;
    const illObj =
      ill && typeof ill === "object" ? (ill as Record<string, unknown>) : null;

    const shotsJson =
      illObj?.shots && typeof illObj.shots === "object"
        ? (illObj.shots as Record<string, { storage_path?: string }>)
        : null;

    let shotPaths: { type: ShotType; path: string }[] = [];
    if (shotsJson) {
      shotPaths = SHOT_TYPE_ORDER.map((type) => {
        const path = shotsJson[type]?.storage_path;
        return typeof path === "string" ? { type, path } : null;
      }).filter((s): s is { type: ShotType; path: string } => !!s);
    }

    if (shotPaths.length === 0) {
      let path: string | null = typeof p.image_url === "string" ? p.image_url : null;
      if (path && path.startsWith("http")) path = null;
      if (!path && illObj?.status === "complete") {
        path =
          (typeof illObj.storage_path === "string" ? illObj.storage_path : null) ??
          (typeof illObj.thumbnail_path === "string" ? illObj.thumbnail_path : null);
      }
      if (path) shotPaths = [{ type: "wide", path }];
    }

    const motionPath =
      typeof p.motion_video_path === "string" && p.motion_video_path
        ? p.motion_video_path
        : null;

    const narrationRaw = p.narrations;
    const narrationRow = Array.isArray(narrationRaw) ? narrationRaw[0] : narrationRaw;
    const narrationObj =
      narrationRow && typeof narrationRow === "object"
        ? (narrationRow as Record<string, unknown>)
        : null;
    const narrationPath =
      typeof narrationObj?.storage_path === "string"
        ? narrationObj.storage_path
        : null;

    return {
      pageNumber: p.page_number as number,
      text: (p.narrative_text as string) ?? "",
      mood: (p.mood as string | null) ?? null,
      shotPaths,
      motionPath,
      narrationPath,
    };
  });

  const illustrationPaths = [
    ...rawScenes.flatMap((s) => s.shotPaths.map((shot) => shot.path)),
    ...rawScenes.map((s) => s.motionPath),
  ].filter((p): p is string => !!p);
  const narrationPaths = rawScenes
    .map((s) => s.narrationPath)
    .filter((p): p is string => !!p);

  const [illustrationSigning, narrationSigning] = await Promise.all([
    illustrationPaths.length > 0
      ? supabase.storage
          .from(ILLUSTRATIONS_BUCKET)
          .createSignedUrls(illustrationPaths, SIGNED_URL_TTL_SECONDS)
      : Promise.resolve({ data: null, error: null }),
    narrationPaths.length > 0
      ? supabase.storage
          .from(NARRATIONS_BUCKET)
          .createSignedUrls(narrationPaths, SIGNED_URL_TTL_SECONDS)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const signedByPath: Record<string, string> = {};
  illustrationSigning.data?.forEach((s) => {
    if (s.path && s.signedUrl) signedByPath[s.path] = s.signedUrl;
  });
  const signedNarrationByPath: Record<string, string> = {};
  narrationSigning.data?.forEach((s) => {
    if (s.path && s.signedUrl) signedNarrationByPath[s.path] = s.signedUrl;
  });

  const scenes: PlayerScene[] = rawScenes.map((s) => {
    const shots: PlayerShot[] = s.shotPaths
      .map((shot) => {
        const url = signedByPath[shot.path];
        return url ? { type: shot.type, url } : null;
      })
      .filter((shot): shot is PlayerShot => !!shot);

    return {
      scene_index: s.pageNumber,
      title: titleFromNarration(s.text),
      text: s.text,
      mood: s.mood,
      image_url: shots[0]?.url ?? null,
      shots,
      motion_video_url: s.motionPath ? signedByPath[s.motionPath] ?? null : null,
      audio_url: s.narrationPath
        ? signedNarrationByPath[s.narrationPath] ?? null
        : null,
    };
  });

  void supabase
    .from("share_links")
    .update({ view_count: (link.view_count ?? 0) + 1 })
    .eq("short_code", shortCode);

  const childProfileRaw = story.child_profiles as
    | { display_name: string }
    | { display_name: string }[]
    | null;
  const childProfile = Array.isArray(childProfileRaw)
    ? childProfileRaw[0]
    : childProfileRaw;
  const childName = childProfile?.display_name ?? "a child";

  // Free always shows the Kinora watermark during playback. Family never
  // gets that Free-tier mark. Explorer only gets it if the stored share-link
  // setting already requires a watermark.
  let showWatermark = link.show_watermark === true;
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("tier")
    .eq("parent_id", link.parent_id)
    .maybeSingle();
  if (sub?.tier === "free") showWatermark = true;
  else if (sub?.tier === "family") showWatermark = false;
  else if (sub?.tier === "explorer") showWatermark = link.show_watermark === true;

  return {
    story_id: story.id,
    title: story.title,
    child_name: childName,
    length: story.target_length,
    music_mood: story.music_mood,
    music_url: musicUrl,
    show_watermark: showWatermark,
    show_trial_cta: link.show_trial_cta,
    referral_slug: shortCode,
    scenes,
  };
}
