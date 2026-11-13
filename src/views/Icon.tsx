const paths: Record<string, string> = {
  calculator:
    "M5 3h14v18H5Z M8 6h8v4H8Z M8 14h1 M12 14h1 M16 14h.01 M8 18h1 M12 18h1 M16 18h.01",
  stop: "M4 4h16v16H4Z M9 9h6v6H9Z",
  "panel-left": "M3 4h18v16H3Z M8 4v16 m8-12-4 4 4 4",
  "panel-right": "M3 4h18v16H3Z M16 4v16 m-8-12 4 4-4 4",
  restore: "M8 8H3V3 M3 8l6-6 M16 16h5v5 m0-5-6 6",
  fit: "M9 3H3v6 M15 3h6v6 M3 15v6h6 M21 15v6h-6 M8 8h8v8H8Z",
  shield: "M12 3 20 6v6c0 5-8 9-8 9S4 17 4 12V6Z M8 12l3 3 5-6",
  tree: "M5 4h5v5H5z M15 15h5v5h-5z M4 15h5v5H4z M7 9v3h11v3 M7 12v3",
  file: "M14 3H5v18h14V8Z M14 3v6h5 M8 13h8 M8 17h6",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-2 5 6",
  chevron: "m9 5 7 7-7 7",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  check: "m5 12 4 4L19 6",
  cases: "M5 5h14v16H5Z M9 5V3h6v2 M8 10h8 M8 14h5 M8 18h7",
  play: "m8 4 12 8-12 8Z",
  close: "m6 6 12 12 M6 18 18 6",
  link: "m10 14 4-4 M8 16l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 5 0 M16 8l2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-5 0",
  info: "M12 11v6 M12 7h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  compare: "M5 4v16 M19 4v16 M2 8h6m-3-3 3 3-3 3 M22 16h-6m3-3-3 3 3 3",
  expand: "M9 3H3v6 M15 3h6v6 M3 15v6h6 M21 15v6h-6",
  back: "m10 5-7 7 7 7 M3 12h18",
  download: "M12 3v12m-5-5 5 5 5-5 M4 16v5h16v-5",
  upload: "M12 15V3m-5 5 5-5 5 5 M4 16v5h16v-5",
  clock: "M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.info} />
    </svg>
  );
}
