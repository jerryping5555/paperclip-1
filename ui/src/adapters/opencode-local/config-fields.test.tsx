// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OpenCodeLocalConfigFields } from "./config-fields";
import type { AdapterConfigFieldsProps } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function renderFields(overrides: Partial<AdapterConfigFieldsProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props: AdapterConfigFieldsProps = {
    mode: "edit",
    isCreate: false,
    adapterType: "opencode_local",
    values: null,
    set: null,
    config: {
      model: "zai/GLM-5.1_F",
      fallbackModels: ["opencode/muse-spark-1.3-contributor-free"],
    },
    eff: (_group, _field, original) => original,
    mark: vi.fn(),
    models: [],
    ...overrides,
  };
  act(() => {
    root!.render(
      <TooltipProvider>
        <OpenCodeLocalConfigFields {...props} section="advanced" />
      </TooltipProvider>,
    );
  });
  return { props, container };
}

function fallbackTextarea(container: HTMLElement) {
  return container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Fallback models"]',
  );
}

function typeTextarea(textarea: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("OpenCode fallback-models field", () => {
  it("shows the saved fallback list in the advanced section", () => {
    const { container } = renderFields();
    expect(fallbackTextarea(container)?.value).toBe(
      "opencode/muse-spark-1.3-contributor-free",
    );
  });
  it("commits one provider/model id per line on blur", () => {
    const { container, props } = renderFields({
      config: { model: "zai/GLM-5.1_F" },
    });
    const textarea = fallbackTextarea(container)!;
    typeTextarea(
      textarea,
      "opencode/muse-spark-1.3-contributor-free\n\n  openai/gpt-5.4-mini  \n",
    );
    act(() => {
      textarea.focus();
    });
    act(() => {
      textarea.blur();
    });
    expect(props.mark).toHaveBeenCalledWith("adapterConfig", "fallbackModels", [
      "opencode/muse-spark-1.3-contributor-free",
      "openai/gpt-5.4-mini",
    ]);
  });
  it("clears the binding when emptied", () => {
    const { container, props } = renderFields();
    const textarea = fallbackTextarea(container)!;
    typeTextarea(textarea, "   \n");
    act(() => {
      textarea.focus();
    });
    act(() => {
      textarea.blur();
    });
    expect(props.mark).toHaveBeenCalledWith(
      "adapterConfig",
      "fallbackModels",
      undefined,
    );
  });
  it("stays out of the configuration section and create mode", () => {
    const { container } = renderFields({ config: { model: "zai/GLM-5.1_F" } });
    // Rendered for the advanced section above; the configuration section must
    // not include it.
    const inConfiguration = document.createElement("div");
    document.body.appendChild(inConfiguration);
    const configRoot = createRoot(inConfiguration);
    act(() => {
      configRoot.render(
        <TooltipProvider>
          <OpenCodeLocalConfigFields
            mode="edit"
            isCreate={false}
            adapterType="opencode_local"
            values={null}
            set={null}
            config={{ model: "zai/GLM-5.1_F" }}
            eff={(_group, _field, original) => original}
            mark={vi.fn()}
            models={[]}
            section="configuration"
          />
        </TooltipProvider>,
      );
    });
    expect(
      inConfiguration.querySelector('textarea[aria-label="Fallback models"]'),
    ).toBeNull();
    act(() => configRoot.unmount());
    inConfiguration.remove();
    expect(container.querySelector("textarea")).not.toBeNull();
  });
});
