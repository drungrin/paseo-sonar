// The places an agent's work goes to. The icon paths are the design's own, drawn on a 24×24 grid.

export type StationId =
  | "you"
  | "model"
  | "memory"
  | "files"
  | "shell"
  | "network"
  | "browser"
  | "agents"
  | "skills";

export const STATIONS: readonly StationId[] = [
  "you",
  "model",
  "memory",
  "files",
  "shell",
  "network",
  "browser",
  "agents",
  "skills",
];

export const STATION_NAMES: Record<StationId, string> = {
  you: "You",
  model: "Model",
  memory: "Memory",
  files: "Files",
  shell: "Shell",
  network: "Network",
  browser: "Browser",
  agents: "Agents",
  skills: "Skills",
};

const PATHS: Record<StationId | "context" | "hooks", string> = {
  you: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  model:
    "M9 9h6v6H9zM6 6h12v12H6zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4",
  memory:
    "M14 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM21 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM11 7l-5 9M13 7l5 9M7 18h10",
  files: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  shell: "M4 17l6-5-6-5M12 19h8",
  network:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z",
  browser: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18",
  agents:
    "M14 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM12 9v3l-5 4M12 12l5 4",
  skills: "M13 2L4 14h7l-1 8 9-12h-7z",
  context: "M12 21a9 9 0 1 1 9-9M12 12l4-4M21 12h-3",
  hooks: "M10 3h4M12 3v11a4 4 0 0 1-8 0v-1",
};

/** Inline SVG for a station, stroked in `currentColor` so the icon takes the color it is drawn with. */
export function stationSvg(id: StationId | "context" | "hooks", strokeWidth = 1.9): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[id]}"/></svg>`;
}

/** The plugin's mark: a dot and the rings a ping sends out. */
export const SONAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.6"/><path d="M15.5 8.5a5 5 0 0 1 0 7M8.5 15.5a5 5 0 0 1 0-7M18.4 5.6a9 9 0 0 1 0 12.8M5.6 18.4a9 9 0 0 1 0-12.8"/></svg>';
