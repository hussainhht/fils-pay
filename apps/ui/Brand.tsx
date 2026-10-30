import React from "react";

export function Brand() {
  return (
    <span className="fp-brand">
      <svg className="fp-brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
        <rect width="32" height="32" rx="8" fill="currentColor" />
        <path d="M11 23V9h11M11 15h8" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>FilsPay</span>
    </span>
  );
}
