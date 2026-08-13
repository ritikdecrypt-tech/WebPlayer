type Props = {
  childName: string;
  recipients: string[];
  note: string | null;
  onBegin: () => void;
};

function formatNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export default function DedicationCard({
  childName,
  recipients,
  note,
  onBegin,
}: Props) {
  const name = childName.trim() || "a child";
  const madeFor = formatNames(recipients);

  return (
    <button
      type="button"
      className="dedication-card"
      onClick={onBegin}
      aria-label="Begin story"
    >
      <span className="dedication-mark" aria-hidden>
        ✦
      </span>
      <span className="dedication-kicker">A story by</span>
      <span className="dedication-name">{name}</span>
      {madeFor ? (
        <>
          <span className="dedication-for-label">Made for</span>
          <span className="dedication-for">{madeFor}</span>
        </>
      ) : (
        <span className="dedication-for-label">Made for {name}</span>
      )}
      {note ? <span className="dedication-note">{note}</span> : null}
      <span className="dedication-hint">Tap to begin</span>
    </button>
  );
}
