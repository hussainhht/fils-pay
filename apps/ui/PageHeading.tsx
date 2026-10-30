import React, { type ReactNode } from "react";

export function PageHeading({ title, description, actions }: {
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="fp-page-heading">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="fp-heading-actions">{actions}</div> : null}
    </header>
  );
}
