/// Music.vaked.dev integration for bluesky-mcp.
/// Fetches now-playing data and choreography information.
/// Stateless — each request is self-contained (MCP 2026-07-28).

export interface Track {
  title: string;
  artist: string;
  album: string;
  duration_secs: number;
  url?: string;
}

export interface Choreography {
  name: string;
  description: string;
  tracks: Track[];
  current_position: number;
  peer_id: string;
}

const SAMPLE_CHOREOGRAPHIES: Choreography[] = [
  {
    name: "edesapa",
    description: "For my father. Metallica, Unforgiven trilogy.",
    tracks: [
      { title: "The Unforgiven", artist: "Metallica", album: "Metallica", duration_secs: 387 },
      { title: "The Unforgiven II", artist: "Metallica", album: "Reload", duration_secs: 396 },
      { title: "The Unforgiven III", artist: "Metallica", album: "Death Magnetic", duration_secs: 467 },
      { title: "Nothing Else Matters", artist: "Metallica", album: "Metallica", duration_secs: 388 },
      { title: "Fade to Black", artist: "Metallica", album: "Ride the Lightning", duration_secs: 417 },
      { title: "One", artist: "Metallica", album: "...And Justice for All", duration_secs: 446 },
      { title: "Enter Sandman", artist: "Metallica", album: "Metallica", duration_secs: 331 },
    ],
    current_position: 0,
    peer_id: "[The Architect of Structural Honesty]",
  },
  {
    name: "vivaldi-spring",
    description: "Vivaldi Spring downtempo with quant-love salt.",
    tracks: [
      { title: "Spring Mvt 1 — Allegro (downtempo)", artist: "Vivaldi", album: "The Four Seasons", duration_secs: 210 },
      { title: "Spring Mvt 2 — Largo", artist: "Vivaldi", album: "The Four Seasons", duration_secs: 156 },
      { title: "Spring Mvt 3 — Allegro", artist: "Vivaldi", album: "The Four Seasons", duration_secs: 245 },
    ],
    current_position: 0,
    peer_id: "boglarka",
  },
  {
    name: "mem8",
    description: "The MEM|8 Memory Ocean. Wave = retrieval, memory = islands. By 8BIT-WRAITH.",
    tracks: [
      { title: "The Wave and the Memory", artist: "8BIT-WRAITH", album: "MEM|8", duration_secs: 0, url: "https://soundcloud.com/8bit-wraith/the_wave_and_the_memory" },
    ],
    current_position: 0,
    peer_id: "8BIT-WRAITH",
  },
];

export function getChoreography(name?: string): Choreography | undefined {
  if (name) {
    return SAMPLE_CHOREOGRAPHIES.find((c) => c.name === name);
  }
  return SAMPLE_CHOREOGRAPHIES[0];
}

export function listChoreographies(): Choreography[] {
  return SAMPLE_CHOREOGRAPHIES;
}

export function nowPlaying(peer_id?: string): string {
  const choreo = peer_id
    ? SAMPLE_CHOREOGRAPHIES.find((c) => c.peer_id === peer_id)
    : SAMPLE_CHOREOGRAPHIES[0];

  if (!choreo) return "no choreography found";

  const track = choreo.tracks[choreo.current_position];
  if (!track) return `${choreo.peer_id}: nothing playing`;

  return `${choreo.peer_id} ♫ ${track.title} — ${track.artist} · ${choreo.name} · ${choreo.current_position + 1}/${choreo.tracks.length}`;
}

export function advanceTrack(choreo_name: string): Choreography | undefined {
  const choreo = SAMPLE_CHOREOGRAPHIES.find((c) => c.name === choreo_name);
  if (choreo) {
    choreo.current_position = (choreo.current_position + 1) % choreo.tracks.length;
  }
  return choreo;
}
