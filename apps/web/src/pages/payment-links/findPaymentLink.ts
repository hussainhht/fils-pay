export interface PaymentLinkPage<T> {
  paymentLinks: T[];
  nextCursor: string | null;
}

/**
 * Finds `id` by following keyset pages. Stops when the server sends no
 * further cursor or repeats one, so a stuck token cannot loop, and does not
 * stop at a fixed row count.
 */
export async function findPaymentLinkById<T extends { id: string }>(
  id: string,
  fetchPage: (cursor: string | undefined) => Promise<PaymentLinkPage<T>>,
): Promise<T | null> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (;;) {
    const page = await fetchPage(cursor);
    const found = page.paymentLinks.find((link) => link.id === id);
    if (found) return found;
    if (!page.nextCursor || seen.has(page.nextCursor)) return null;
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
