type IconName =
  | "grid"
  | "scan"
  | "arrow"
  | "shield"
  | "upload"
  | "check"
  | "alert"
  | "camera";

const paths: Record<IconName, string> = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  scan: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 12h10M12 7v10",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  shield: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm-4 9 3 3 5-6",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  check: "m5 12 4 4L19 6",
  alert: "M12 8v5m0 3v.1M10 3h4l9 17H1L10 3Z",
  camera: "M3 6h4l2-3h6l2 3h4v15H3V6Zm13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
};

export function Icon({
  name,
  className = "h-5 w-5",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
