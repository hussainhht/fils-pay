type IconName =
  | "transactions" | "links" | "webhooks" | "settlement" | "reconciliation"
  | "overview" | "merchants" | "credits" | "import" | "logout" | "arrow";

const paths: Record<IconName, string> = {
  transactions: "M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4",
  links: "m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  webhooks: "M8 12h8M8 5v14m8-14v14M4 5h4m8 0h4M4 19h4m8 0h4",
  settlement: "M3 9h18L12 3 3 9Zm2 4v5m7-5v5m7-5v5M3 21h18",
  reconciliation: "M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 14l2 2 5-5",
  overview: "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z",
  merchants: "M3 10h18l-2-6H5l-2 6Zm2 0v10h14V10M9 20v-6h6v6",
  credits: "M3 6h18v14H3V6Zm0 4h18M7 16h4",
  import: "M4 16v5h16v-5M12 3v13m-5-5 5 5 5-5",
  logout: "M9 4H4v16h5m6-12 4 4-4 4m-6-4h10",
  arrow: "M5 12h14m-5-5 5 5-5 5",
};

/** Decorative only: link and button text supplies the accessible name. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="fp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
