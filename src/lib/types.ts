export type ShotType = "wide" | "medium" | "close";

export type PlayerShot = {
  type: ShotType;
  url: string;
};

export type PlayerScene = {
  scene_index: number;
  title: string;
  text: string;
  mood: string | null;
  image_url: string | null;
  shots: PlayerShot[];
  motion_video_url: string | null;
  audio_url: string | null;
};

export type SharedStory = {
  story_id: string;
  title: string | null;
  child_name: string;
  length: string;
  music_mood: string | null;
  music_url: string | null;
  show_watermark: boolean;
  show_trial_cta: boolean;
  /** Share-link short_code — also the referral slug for EndCard / track-referral. */
  referral_slug: string;
  scenes: PlayerScene[];
};

export type StoryPlayerErrorCode =
  | "invalid_short_code"
  | "not_found"
  | "link_expired"
  | "content_unavailable"
  | "method_not_allowed"
  | "server_error"
  | "config_missing"
  | "network_error";
