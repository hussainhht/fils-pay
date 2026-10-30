import { PageHeading } from "../../../../ui/PageHeading.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { cancelPaymentLink, listPaymentLinks } from "../../api/paymentLinks.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { bhd, dash, dateTime } from "../../format.js";
import type { PaymentLinkDto } from "../../types.js";
import { findPaymentLinkById } from "./findPaymentLink.js";

/** The list endpoint's own maximum page size. Pages after this one are loaded
 *  with `nextCursor` — the lookup does not stop at the first page. */
const LOOKUP_LIMIT = 100;

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; link: PaymentLinkDto };

/**
 * There is no merchant-authenticated `GET .../payment-links/:id`. This page
 * follows the list's keyset cursor until the id is found or the pages end,
 * so a link older than the first 100 rows can still be opened, copied, and
 * canceled.
 */
export function PaymentLinkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const idRef = useRef(id);
  idRef.current = id;
  const { me } = useDashboardAuth();
  const merchantId = me?.merchant.id;

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loadedFor, setLoadedFor] = useState(id);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (id !== loadedFor) {
    setLoadedFor(id);
    setState({ kind: "loading" });
    setActionError(null);
    setCopied(false);
    setSubmitting(false);
  }

  const load = useCallback(async () => {
    if (!merchantId || !id) return;
    const requestedId = id;
    try {
      const found = await findPaymentLinkById(requestedId, (cursor) =>
        listPaymentLinks(merchantId, { limit: LOOKUP_LIMIT, cursor }),
      );
      if (idRef.current !== requestedId) return;
      setState(found ? { kind: "loaded", link: found } : { kind: "not_found" });
    } catch (err) {
      if (idRef.current !== requestedId) return;
      setState({ kind: "error", message: describeError(err) });
    }
  }, [merchantId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCancel(): Promise<void> {
    if (!merchantId || !id || state.kind !== "loaded" || state.link.id !== id) return;
    if (!window.confirm("Cancel this payment link? It can no longer be paid.")) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await cancelPaymentLink(merchantId, id);
      await load();
    } catch (err) {
      // Includes `409 not_cancelable` for a link that is paid, already
      // canceled, or `reserved` mid-payment-attempt.
      setActionError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard permission (or no secure context) — the URL is already
      // on screen and selectable, so there is nothing to recover from.
      setCopied(false);
    }
  }

  if (state.kind === "loading") return <p className="fp-loading-state" role="status">Loading...</p>;
  if (state.kind === "error") {
    return (
      <section>
        <PageHeading title="Payment link" />
        <p className="dash-error">{state.message}</p>
      </section>
    );
  }
  if (state.kind === "not_found") {
    return (
      <section>
        <PageHeading title="Payment link not found" />
        <p>
          No payment link with this id exists on your account.{" "}
          <Link to="/dashboard/payment-links">Back to payment links</Link>
        </p>
      </section>
    );
  }

  const { link } = state;

  return (
    <section>
      <PageHeading title="Payment link" />
      <p className="dash-muted">
        <code>{link.id}</code>
      </p>

      <dl className="dash-dl">
        <dt>Amount</dt>
        <dd>{bhd(link.amountFils)}</dd>
        <dt>Currency</dt>
        <dd>{link.currency}</dd>
        <dt>Status</dt>
        <dd>
          <span className={`dash-status dash-status-${link.status}`}>{link.status}</span>
        </dd>
        <dt>Reference</dt>
        <dd>{dash(link.reference)}</dd>
        <dt>Description</dt>
        <dd>{dash(link.description)}</dd>
        <dt>Expires at</dt>
        <dd>{dateTime(link.expiresAt)}</dd>
        <dt>Created at</dt>
        <dd>{dateTime(link.createdAt)}</dd>
        <dt>Paid at</dt>
        <dd>{dateTime(link.paidAt)}</dd>
        <dt>Canceled at</dt>
        <dd>{dateTime(link.canceledAt)}</dd>
        <dt>Transaction</dt>
        <dd>
          {link.transactionId ? (
            <Link to={`/dashboard/transactions/${link.transactionId}`}>
              <code>{link.transactionId}</code>
            </Link>
          ) : (
            "—"
          )}
        </dd>
        <dt>Checkout link</dt>
        <dd>
          {/* Linked to, never duplicated — /pay/:token is the one checkout
              implementation, and there is no preview of it embedded here. */}
          <a href={link.url} target="_blank" rel="noreferrer">
            {link.url}
          </a>{" "}
          <button type="button" className="dash-button" onClick={() => void handleCopy(link.url)}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </dd>
      </dl>

      {actionError ? <p className="dash-error">{actionError}</p> : null}

      {link.status === "active" ? (
        <RequireRole allow={["owner", "finance"]}>
          <button
            type="button"
            className="dash-button fp-button-danger"
            disabled={submitting}
            onClick={() => void handleCancel()}
          >
            {submitting ? "Canceling..." : "Cancel payment link"}
          </button>
        </RequireRole>
      ) : null}

      <p>
        <Link to="/dashboard/payment-links">Back to payment links</Link>
      </p>
    </section>
  );
}
