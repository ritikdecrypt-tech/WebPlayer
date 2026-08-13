const APP_STORE_URL = "https://apps.apple.com/app/id6787054301";
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.hellokinora.kinora";

type Props = {
  childName: string;
};

export default function EndCard({ childName }: Props) {
  const name = childName.trim() || "A";

  return (
    <div className="end-card" role="dialog" aria-label="Story finished">
      <div className="endcard-content">
        <div className="endcard-art art-wash rose" aria-hidden>
          <div className="art-silhouette">
            <svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid slice">
              <ellipse
                cx="50"
                cy="55"
                rx="22"
                ry="2.5"
                fill="rgba(44,37,32,0.15)"
              />
              <ellipse
                cx="50"
                cy="36"
                rx="17"
                ry="14"
                fill="rgba(255,252,246,0.85)"
                stroke="rgba(199,106,63,0.5)"
                strokeWidth="0.5"
              />
              <path
                d="M 38 38 Q 50 32 62 38"
                stroke="rgba(199,106,63,0.45)"
                strokeWidth="0.6"
                fill="none"
              />
              <circle cx="44" cy="34" r="0.9" fill="rgba(44,37,32,0.6)" />
              <circle cx="56" cy="34" r="0.9" fill="rgba(44,37,32,0.6)" />
              <path
                d="M 46 40 Q 50 42 54 40"
                stroke="rgba(44,37,32,0.5)"
                strokeWidth="0.5"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
        <h2 className="endcard-headline">{name} can make her own.</h2>
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
