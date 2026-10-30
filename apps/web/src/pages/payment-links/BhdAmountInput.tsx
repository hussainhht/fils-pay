import { useLayoutEffect, useRef } from "react";
import { isBhdAmountDraft, normalizeBhdAmount } from "./bhdAmount.js";

export function BhdAmountInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selection = useRef({ start: 0, end: 0, direction: "none" as "forward" | "backward" | "none" });
  function rememberSelection(input: HTMLInputElement) {
    selection.current = {
      start: input.selectionStart ?? 0,
      end: input.selectionEnd ?? 0,
      direction: input.selectionDirection ?? "none",
    };
  }

  useLayoutEffect(() => {
    const input = inputRef.current!;
    // Native beforeinput also covers mobile keyboards. Reject before the DOM changes
    // where possible, so invalid edits retain the original selection and undo history.
    const beforeInput = (event: InputEvent) => {
      rememberSelection(input);
      if (event.data !== null && event.inputType.startsWith("insert")) {
        const { start, end } = selection.current;
        const next = input.value.slice(0, start) + event.data + input.value.slice(end);
        if (!isBhdAmountDraft(next)) event.preventDefault();
      }
    };
    input.addEventListener("beforeinput", beforeInput);
    return () => input.removeEventListener("beforeinput", beforeInput);
  }, []);

  return (
    <input
      ref={inputRef}
      id="payment-link-amount"
      type="text"
      inputMode="decimal"
      required
      aria-describedby="payment-link-amount-hint"
      value={value}
      onSelect={(event) => rememberSelection(event.currentTarget)}
      onKeyDown={(event) => rememberSelection(event.currentTarget)}
      onPaste={(event) => {
        const input = event.currentTarget;
        rememberSelection(input);
        const { start, end } = selection.current;
        const next = value.slice(0, start) + event.clipboardData.getData("text") + value.slice(end);
        if (!isBhdAmountDraft(next)) event.preventDefault();
      }}
      onChange={(event) => {
        const input = event.currentTarget;
        if (isBhdAmountDraft(input.value)) {
          // Keeping accepted text byte-for-byte lets the browser retain its caret.
          onChange(input.value);
          rememberSelection(input);
        } else {
          // Autofill/input-only events may bypass a cancellable beforeinput.
          const { start, end, direction } = selection.current;
          input.value = value;
          input.setSelectionRange(start, end, direction);
        }
      }}
      onBlur={() => onChange(normalizeBhdAmount(value))}
    />
  );
}
