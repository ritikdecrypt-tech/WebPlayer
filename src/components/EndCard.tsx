const APP_STORE_URL = "https://apps.apple.com/app/id6787054301";
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.hellokinora.kinora";

type Props = {
  onReplay: () => void;
};

export default function EndCard({ onReplay }: Props) {
  return (
    <div className="end-card" role="dialog" aria-label="Story finished">
      <div className="endcard-content">
        <button
          type="button"
          className="endcard-replay"
          onClick={onReplay}
          aria-label="Play again"
        >
          <span className="endcard-art art-wash rose" aria-hidden>
            <svg
              className="endcard-replay-icon"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M7.2 7.2A6.8 6.8 0 1 1 5.4 12"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <path
                d="M7.2 3.6v4.2H3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9.4 12.1 15 8.8v6.6L9.4 12.1Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="endcard-headline">Play Again</span>
        </button>
        <p className="endcard-sub">
          Co-write illustrated stories with your child in your own words. Free
          to start.
        </p>
        <span className="endcard-trial-tag">
          14-day free trial · no card needed
        </span>
        <div className="endcard-buttons">
          <a
            className="app-store-btn"
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            ▼ App Store
          </a>
          <a
            className="app-store-btn"
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            ▶ Google Play
          </a>
        </div>
        <p className="endcard-fineprint">Cancel any time. Made for ages 3–12.</p>
      </div>
    </div>
  );
}
