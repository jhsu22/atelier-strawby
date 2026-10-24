import type { CSSProperties } from "react";
import { useState } from "react";
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
  const names = cd ? entry.artists : entry.authors;
  return (
    <div
      aria-hidden="true"
      style={mediaStyle(entry.title)}
      className={`media-art ${cd ? "jewel-case" : "book-cover"} ${compact ? "art-compact" : ""}`}
    >
      {artwork && artwork.url !== failedUrl && (
        <img
          className="resolved-artwork"
          src={artwork.url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(artwork.url)}
        />
      )}
      {artwork &&
        artwork.url !== failedUrl &&
        artwork.scope === "representative" && (
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
  return (
    <button
      type="button"
      className={`media-spine ${cd ? "cd-spine" : ""}`}
      style={mediaStyle(entry.title)}
      onClick={onOpen}
      aria-label={`Open ${entry.title}${copy.volume ? `, volume ${copy.volume}, ${copy.language}` : ", CD"}`}
      data-copy-id={copy.id}
    >
      <span className="spine-top">{cd ? "CD" : copy.language}</span>
      <span className="spine-title">{entry.title}</span>
      <span className="spine-publisher">
        {cd
          ? entry.kind === "cd" && entry.copies.every((c) => c.isSample)
            ? "SAMPLE"
            : entry.labels.join(" · ") || "CD"
          : copy.publisher}
      </span>
      <span className="spine-number">
        {cd ? "◉" : copy.volume?.padStart(2, "0")}
      </span>
    </button>
  );
}
