import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { Children, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckoutIcon, CheckoutSummary, CheckoutTestInfo } from "./CheckoutDetails.js";
import { CheckoutPaymentForm } from "./CheckoutPaymentForm.js";
import { CheckoutFrame } from "./CheckoutFrame.js";
import type { PaymentLinkPublicDto } from "../../types.js";

const link: PaymentLinkPublicDto = {
  token: "fixture", merchantDisplayName: "Dynamic Store <Bahrain>", amountFils: 10001,
  currency: "BHD", reference: "ORDER-7", description: "Invoice <7>",
  status: "active", expiresAt: "2030-12-31T00:00:00Z",
};
const props = {
  card: { pan: "", expiryMonth: 1, expiryYear: 2030, cvv: "" },
  setCard: () => {}, setBrandHint: () => {}, brandHint: null,
  submitting: false, amount: "10.001", declined: false, onSubmit: async () => {},
};

test("checkout icons retain intrinsic dimensions when their stylesheet is unavailable", () => {
  for (const name of ["lock", "shield", "lab", "card"] as const) {
    const html = renderToStaticMarkup(createElement(CheckoutIcon, { name }));
    assert.match(html, /width="20"/);
    assert.match(html, /height="20"/);
  }
});

test("order summary uses escaped API data and exact three-decimal fils formatting", () => {
  const html = renderToStaticMarkup(createElement(CheckoutSummary, { link }));
  for (const text of ["Dynamic Store &lt;Bahrain&gt;", "10.001 BHD", "ORDER-7", "Invoice &lt;7&gt;"]) assert.ok(html.includes(text));
  assert.match(html, /<aside[^>]+aria-labelledby="order-summary-title"/);
  assert.doesNotMatch(html, /Alpha Retail|certified|bank-grade|guaranteed encryption/);
});

test("card form preserves four input values, required semantics, month/year bounds and submit amount", () => {
  const html = renderToStaticMarkup(createElement(CheckoutPaymentForm, props));
  assert.equal((html.match(/<input /g) ?? []).length, 4);
  assert.equal((html.match(/required=""/g) ?? []).length, 4);
  assert.match(html, /min="1" max="12"/);
  assert.match(html, new RegExp(`min="${new Date().getFullYear()}"`));
  assert.match(html, /value="2030"/);
  assert.match(html, /Pay 10\.001 BHD/);
  assert.match(html, /<fieldset[^>]*><legend>Expiry date<\/legend>/);
  assert.equal((html.match(/<label>/g) ?? []).length, 4);
});

test("submitting exposes busy status, disables submit and preserves the form", () => {
  const html = renderToStaticMarkup(createElement(CheckoutPaymentForm, { ...props, submitting: true }));
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /<button type="submit" disabled=""/);
  assert.match(html, /role="status">Processing\.\.\./);
  assert.match(html, /checkout-spinner/);
  assert.equal((html.match(/<input /g) ?? []).length, 4);
});

test("declined form references its alert and preserves existing brand hint display", () => {
  const html = renderToStaticMarkup(createElement(CheckoutPaymentForm, { ...props, declined: true, brandHint: "visa" }));
  assert.match(html, /aria-describedby="checkout-payment-error"/);
  assert.match(html, /checkout-brand-hint">visa/);
  assert.doesNotMatch(html, /disabled=""/);
});

test("sandbox instructions remain expanded, keyboard-native and retain every magic suffix", () => {
  const html = renderToStaticMarkup(createElement(CheckoutTestInfo));
  assert.match(html, /<details[^>]+open=""/);
  for (const text of ["0002", "0119", "0069", "do not honor", "insufficient funds", "always errors", "any other number approves"]) assert.ok(html.includes(text));
});

test("result and summary coexist with a single page main and real receipt content", () => {
  const html = renderToStaticMarkup(createElement(CheckoutFrame, {
    result: "success", summary: createElement(CheckoutSummary, { link }),
    children: createElement("h1", null, "Payment successful"),
  }));
  assert.match(html, /checkout-result-success/);
  assert.match(html, /Payment successful/);
  assert.match(html, /Order summary/);
  assert.equal((html.match(/<main/g) ?? []).length, 1);
});

test("presentation forwards submit and edits to the existing card shape without formatting PAN", () => {
  const changes: unknown[] = [];
  const tree = CheckoutPaymentForm({ ...props, setCard: (value) => { changes.push(value); } });
  assert.equal(tree.props.onSubmit, props.onSubmit);
  const inputs: Array<{ value: unknown; onChange: (event: { target: { value: string } }) => void }> = [];
  function visit(node: unknown): void {
    if (!isValidElement<{ children?: React.ReactNode; value: unknown; onChange: (event: { target: { value: string } }) => void }>(node)) return;
    if (node.type === "input") inputs.push(node.props);
    Children.forEach(node.props.children, visit);
  }
  visit(tree);
  // Short synthetic input avoids asynchronous brand detection in this shape test.
  inputs[0]!.onChange({ target: { value: "1 2" } });
  inputs[1]!.onChange({ target: { value: "12" } });
  inputs[2]!.onChange({ target: { value: "2031" } });
  inputs[3]!.onChange({ target: { value: "" } });
  assert.deepEqual(changes, [
    { ...props.card, pan: "1 2" }, { ...props.card, expiryMonth: 12 },
    { ...props.card, expiryYear: 2031 }, { ...props.card, cvv: "" },
  ]);
});
