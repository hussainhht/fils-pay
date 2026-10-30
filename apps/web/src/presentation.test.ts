import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageHeading } from "../../ui/PageHeading.js";
import { Brand } from "../../ui/Brand.js";
import { Icon } from "../../ui/Icon.js";
import { CheckoutFrame } from "./pages/checkout/CheckoutFrame.js";

test("page headings preserve action links and their destination", () => {
  const html = renderToStaticMarkup(createElement(PageHeading, {
    title: "Payment links",
    actions: createElement("a", { href: "/dashboard/payment-links/new" }, "New payment link"),
  }));
  assert.match(html, /<h1>Payment links<\/h1>/);
  assert.match(html, /href="\/dashboard\/payment-links\/new">New payment link<\/a>/);
  assert.doesNotMatch(html, /<button/);
});

test("page headings without actions render no empty action container", () => {
  const html = renderToStaticMarkup(createElement(PageHeading, { title: "Transaction" }));
  assert.doesNotMatch(html, /fp-heading-actions/);
});

test("checkout presentation preserves its form, payment amount and submit state", () => {
  const form = createElement("form", { action: "/existing-action" },
    createElement("p", null, "1.001 BHD"),
    createElement("button", { type: "submit", disabled: true }, "Processing..."),
  );
  const html = renderToStaticMarkup(createElement(CheckoutFrame, { children: form }));
  assert.match(html, /<main class="checkout-page">/);
  assert.match(html, /<form action="\/existing-action">/);
  assert.match(html, /1\.001 BHD/);
  assert.match(html, /<button type="submit" disabled="">Processing\.\.\.<\/button>/);
  assert.doesNotMatch(html, /checkout-result-symbol/);
});

test("checkout receipt decoration preserves the supplied result text", () => {
  const html = renderToStaticMarkup(createElement(CheckoutFrame, {
    result: "success",
    children: createElement("h1", null, "Payment successful"),
  }));
  assert.match(html, /checkout-result-success" aria-hidden="true"/);
  assert.match(html, /<h1>Payment successful<\/h1>/);
});

test("brand decoration is hidden from assistive technology and its text remains readable", () => {
  const html = renderToStaticMarkup(createElement(Brand));
  assert.match(html, /<svg[^>]+aria-hidden="true"/);
  assert.match(html, /<span>FilsPay<\/span>/);
});

test("navigation icons cannot create an extra keyboard stop or replace the link name", () => {
  const html = renderToStaticMarkup(createElement("a", { href: "/dashboard/transactions" },
    createElement(Icon, { name: "transactions" }), "Transactions",
  ));
  assert.match(html, /<svg[^>]+aria-hidden="true" focusable="false"/);
  assert.match(html, /<\/svg>Transactions<\/a>/);
});
