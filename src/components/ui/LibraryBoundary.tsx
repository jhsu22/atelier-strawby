import { Component } from "react";
import type { ReactNode } from "react";
import { LibraryIsland } from "../shelf/LibraryIsland.tsx";
import type { BrowseState, LibraryData } from "../../domain/library.ts";

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main id="main" className="unavailable-page">
      <h1>The shelf could not be displayed</h1>
      <p role="alert">Your saved collection is still in the database. Reload to try again. Unsaved changes may need to be entered again.</p>
      <a href="/" className="button button-primary">Reload the shelf</a>
    </main>;
    return this.props.children;
  }
}

export function LibraryBoundary(props: { initialData: LibraryData; initialState: BrowseState; canEdit?: boolean; renderedAt?: number }) {
  return <ErrorBoundary><LibraryIsland {...props} /></ErrorBoundary>;
}
