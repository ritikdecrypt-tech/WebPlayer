import type { Metadata } from "next";
import StoryPlayer from "@/components/StoryPlayer";
import {
  errorMessageFor,
  fetchSharedStory,
  isValidShortCode,
  StoryPlayerFetchError,
} from "@/lib/storyPlayer";

type PageProps = {
  params: Promise<{ code: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  if (!isValidShortCode(code)) {
    return { title: "Story player" };
  }

  try {
    const story = await fetchSharedStory(code);
    const title = story.title || `${story.child_name}'s story`;
    return {
      title,
      description: `Play ${title}`,
    };
  } catch {
    return { title: "Story not found" };
  }
}

export default async function SharedStoryPage({ params }: PageProps) {
  const { code } = await params;

  if (!isValidShortCode(code)) {
    return <ErrorState message="Open a shared story link to play." />;
  }

  try {
    const story = await fetchSharedStory(code);
    return <StoryPlayer story={story} />;
  } catch (err) {
    const codeName =
      err instanceof StoryPlayerFetchError ? err.code : "server_error";
    return <ErrorState message={errorMessageFor(codeName)} />;
  }
}

function ErrorState({ message }: { message: string }) {
  return (
    <main className="error-panel">
      <div className="error-card">
        <p>{message}</p>
      </div>
    </main>
  );
}
