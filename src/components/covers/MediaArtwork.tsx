import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import type { LibraryEntry, MangaCopy } from "../../domain/library.ts";

const palettes = [
  ["#c8d2bc", "#253b30"],
  ["#e2b9a3", "#442b24"],
  ["#d7c4a7", "#493829"],
  ["#d7bdc2", "#493039"],
  ["#bfccda", "#263848"],
  ["#dfd3a9", "#403b25"],
  ["#c9c1d5", "#3e314e"],
  ["#b8cdcb", "#243d3e"],
  ["#344f42", "#f5efdc"],
  ["#3c4b5d", "#f5efdc"],
  ["#76505d", "#fff0e5"],
  ["#c4b8a5", "#342f29"],
];
export function mediaStyle(title: string): CSSProperties {
  const index =
    [...title].reduce(
      (hash, character) => (hash * 31 + character.codePointAt(0)!) >>> 0,
      7,
    ) % palettes.length;
  const palette = palettes[index]!;
  return {
    "--cover-paper": palette[0],
    "--cover-ink": palette[1],
    "--spine-width": `${46 + (index % 4) * 6}px`,
  } as CSSProperties;
}
export function MediaArtwork({
  entry,
  compact = false,
}: {
  entry: LibraryEntry;
  compact?: boolean;
}) {
  const cd = entry.kind === "cd";
  const artwork = cd
    ? entry.artwork
    : entry.copies.find((copy) => copy.artwork)?.artwork;
  const [failedUrl, setFailedUrl] = useState("");
  const [loadedUrl, setLoadedUrl] = useState("");
  const image = useRef<HTMLImageElement>(null);
  const shown = artwork && artwork.url !== failedUrl ? artwork : null;
  // An image can finish loading or fail before hydration attaches handlers.
  useEffect(() => {
    const node = image.current;
    if (!shown || !node?.complete) return;
    if (node.naturalWidth > 0) setLoadedUrl(shown.url);
    else setFailedUrl(shown.url);
  }, [shown?.url]);
  const loaded = Boolean(shown && loadedUrl === shown.url);
  const names = cd ? entry.artists : entry.authors;
  // The typographic cover is only a placeholder: once real artwork loads it
  // fills the same space on its own.
  return (
    <div
      aria-hidden="true"
      style={mediaStyle(entry.title)}
      className={`media-art ${cd ? "jewel-case" : "book-cover"} ${compact ? "art-compact" : ""} ${loaded ? "has-artwork" : ""}`}
    >
      {shown && (
        <img
          ref={image}
          className="resolved-artwork"
          src={shown.url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedUrl(shown.url)}
          onError={() => setFailedUrl(shown.url)}
        />
      )}
      {loaded && shown?.scope === "representative" && (
        <span className="artwork-fallback-label">Representative</span>
      )}
      <div className="cover-print">
        <span
          className={`cover-title ${entry.title.length > 34 ? "cover-title-long" : ""}`}
        >
          {entry.title}
        </span>
        <span className="cover-ornament">
          {cd ? (
            <span className="record-disc" />
          ) : (
            <>
              <i />
              <i />
              <i />
            </>
          )}
        </span>
        <span className="cover-author">
          {names.join(" · ") || (cd ? "Artist unresolved" : "Author unknown")}
        </span>
      </div>
      {cd && <span className="jewel-hinge" />}
    </div>
  );
}
export function Spine({
  entry,
  copy,
  onOpen,
}: {
  entry: LibraryEntry;
  copy: { id: string } & Partial<MangaCopy>;
  onOpen: () => void;
}) {
  const cd = entry.kind === "cd";
  const by = (names: string[]) =>
    names.length ? ` by ${names.join(", ")}` : "";
  // Standalone books (a single "1") show no series number.
  const numbered =
    entry.kind !== "book" || entry.copies.some((c) => c.volume && (c.volume !== "1" || c.bookTitle));
  return (
    <button
      type="button"
      className={`media-spine ${cd ? "cd-spine" : entry.kind === "book" ? "book-spine" : ""}`}
      style={mediaStyle(entry.title)}
      onClick={onOpen}
      aria-label={`Open ${entry.title}${
        entry.kind === "cd"
          ? `${by(entry.artists)}, CD`
          : entry.kind === "book"
            ? `${by(entry.authors)}, book${numbered && copy.volume ? ` ${copy.volume}` : ""}${copy.bookTitle ? `, ${copy.bookTitle}` : ""}, ${copy.language}`
            : `, volume ${copy.volume}, ${copy.language}${copy.medium === "light_novel" ? ", light novel" : ""}`
      }`}
      data-copy-id={copy.id}
    >
      <span className="spine-top">
        {cd ? "CD" : copy.language}
        {copy.medium === "light_novel" && (
          <span className="spine-medium">LN</span>
        )}
      </span>
      <span className="spine-title">{entry.kind === "book" && copy.bookTitle ? copy.bookTitle : entry.title}</span>
      <span className="spine-publisher">
        {entry.kind === "cd"
          ? [
              entry.copies.every((c) => c.isSample) && "SAMPLE",
              entry.artists.join(" · ") || entry.labels.join(" · "),
            ]
              .filter(Boolean)
              .join(" · ") || "CD"
          : entry.kind === "book"
            ? entry.authors.join(" · ") || copy.publisher
            : copy.publisher}
      </span>
      <span className="spine-number">
        {cd ? "◉" : numbered ? copy.volume?.padStart(2, "0") : "◆"}
      </span>
    </button>
  );
}
