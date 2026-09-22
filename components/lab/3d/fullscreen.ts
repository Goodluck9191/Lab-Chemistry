"use client";

/**
 * Fullscreen presentation for the immersive laboratory.
 *
 * The Browser Fullscreen API is optional chrome, never a gate: when the API is
 * missing (or the user denies it) the laboratory simply stays maximised in the
 * page, which the caller detects through the returned status. Dependencies are
 * injected so the fallback paths are unit-testable without a DOM.
 */

export type FullscreenStatus = "entered" | "exited" | "unsupported";

interface FullscreenElement {
  requestFullscreen?: () => Promise<void>;
}

interface FullscreenDocument {
  fullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void>;
}

/** Enter or exit fullscreen on `element`, or report that it is unavailable. */
export async function toggleFullscreen(
  element: FullscreenElement | null,
  doc: FullscreenDocument | null,
): Promise<FullscreenStatus> {
  if (!element || !doc) return "unsupported";
  try {
    if (doc.fullscreenElement) {
      if (typeof doc.exitFullscreen !== "function") return "unsupported";
      await doc.exitFullscreen();
      return "exited";
    }
    if (typeof element.requestFullscreen !== "function") return "unsupported";
    await element.requestFullscreen();
    return "entered";
  } catch {
    return "unsupported";
  }
}

/** True while any element holds the fullscreen lock. */
export function isFullscreen(doc: FullscreenDocument | null): boolean {
  return doc?.fullscreenElement != null && doc.fullscreenElement !== false;
}
