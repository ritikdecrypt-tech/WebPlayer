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
              viewBox="0 0 48 48"
              fill="none"
            >
              <path
                d="M40 24a16 16 0 1 1-4.69-11.31"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
              <path
                d="M40 8.8v9.4h-9.4"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M19.6 16.2c0-.7.76-1.14 1.37-.79l12.05 6.8a.9.9 0 0 1 0 1.58l-12.05 6.8a.9.9 0 0 1-1.37-.79V16.2Z"
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
