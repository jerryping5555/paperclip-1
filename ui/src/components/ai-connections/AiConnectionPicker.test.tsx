// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiConnectionPicker } from "./AiConnectionPicker";
import type { AiConnectionSummary } from "./model";

const connections: AiConnectionSummary[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    grantId: "22222222-2222-4222-8222-222222222222",
    companyId: "co",
    provider: "openrouter",
    method: "api_key",
    name: "Team OpenRouter",
    ownership: "shared",
    ownerName: "Ops",
    isDefault: false,
    status: "connected",
  },
];

let root: Root | undefined;
afterEach(() => {
  if (root) flushSync(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
function mount(overrides: Partial<Parameters<typeof AiConnectionPicker>[0]> = {}) {
  const props: Parameters<typeof AiConnectionPicker>[0] = {
    requirement: { companyId: "co", provider: "openrouter" },
    connections,
    value: undefined,
    currentUserId: "u1",
    agentId: "a1",
    agentName: "Woo Product Agent",
    allowNone: true,
    onChange: vi.fn(),
    onClear: vi.fn(),
    onConnect: vi.fn(),
    ...overrides,
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root!.render(<AiConnectionPicker {...props} />));
  return { props, container };
}
function choiceButton(container: HTMLElement, label: string) {
  return container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )!;
}

describe("AiConnectionPicker optional managed connection", () => {
  it("selects the harness sign-in by default when no managed connection is chosen", () => {
    const { container } = mount();
    expect(
      choiceButton(container, "No managed connection").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      choiceButton(container, "Responsible user’s connection").getAttribute("aria-pressed"),
    ).toBe("false");
  });
  it("clears the binding instead of selecting an account when the harness sign-in is chosen", () => {
    const { container, props } = mount({
      value: { provider: "openrouter", method: "api_key", mode: "responsible_user" },
    });
    expect(
      choiceButton(container, "No managed connection").getAttribute("aria-pressed"),
    ).toBe("false");
    flushSync(() => choiceButton(container, "No managed connection").click());
    expect(props.onClear).toHaveBeenCalledOnce();
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("still emits a managed binding when an account choice is picked", () => {
    const { container, props } = mount();
    flushSync(() =>
      choiceButton(container, "Responsible user’s connection").click(),
    );
    expect(props.onChange).toHaveBeenCalledWith({
      provider: "openrouter",
      method: "api_key",
      mode: "responsible_user",
    });
    expect(props.onClear).not.toHaveBeenCalled();
  });
  it("offers no none-choice unless the adapter allows running without a managed connection", () => {
    const { container } = mount({ allowNone: false });
    expect(
      container.querySelector('button[aria-label="No managed connection"]'),
    ).toBeNull();
  });
});
