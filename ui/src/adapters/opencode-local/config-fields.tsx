import { useState } from "react";
import { configFieldsForSection } from "../config-sections";
import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  ToggleField,
  DraftInput,
  help,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Injected into the system prompt at runtime.";

export function OpenCodeLocalConfigFields({
  section,
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
  hideInstructionsFile,
}: AdapterConfigFieldsProps) {
  // Fallback rotation is an edit-time concern: creation flows (wizard, hire
  // API) don't offer it, and the server keeps the primary on every new run.
  const savedFallbacks = !isCreate ? eff("adapterConfig", "fallbackModels", config.fallbackModels) : [];
  const savedFallbackList = Array.isArray(savedFallbacks)
    ? savedFallbacks.filter((entry): entry is string => typeof entry === "string")
    : [];
  const [fallbackDraft, setFallbackDraft] = useState<string | null>(null);
  const commitFallbacks = (text: string) => {
    const ids = text.split("\n").map((line) => line.trim()).filter(Boolean);
    mark("adapterConfig", "fallbackModels", ids.length > 0 ? ids : undefined);
    setFallbackDraft(null);
  };
  return configFieldsForSection(section, (
    <>
      {!hideInstructionsFile && (
        <Field label="Agent instructions file" hint={instructionsFileHint}>
          <div className="flex items-center gap-2">
            <DraftInput
              value={
                isCreate
                  ? values!.instructionsFilePath ?? ""
                  : eff(
                      "adapterConfig",
                      "instructionsFilePath",
                      String(config.instructionsFilePath ?? ""),
                    )
              }
              onCommit={(v) =>
                isCreate
                  ? set!({ instructionsFilePath: v })
                  : mark("adapterConfig", "instructionsFilePath", v || undefined)
              }
              immediate
              className={inputClass}
              placeholder="/absolute/path/to/AGENTS.md"
            />
            <ChoosePathButton />
          </div>
        </Field>
      )}
      <ToggleField
        label="Skip permissions"
        hint={help.dangerouslySkipPermissions}
        checked={
          isCreate
            ? values!.dangerouslySkipPermissions
            : eff(
                "adapterConfig",
                "dangerouslySkipPermissions",
                config.dangerouslySkipPermissions !== false,
              )
        }
        onChange={(v) =>
          isCreate
            ? set!({ dangerouslySkipPermissions: v })
            : mark("adapterConfig", "dangerouslySkipPermissions", v)
        }
      />
      {!isCreate && (
        <Field
          label="Fallback models"
          hint="Provider/model ids (one per line) the agent rotates to — in the same session — when the configured model is exhausted (rate limits, depleted credits). Every run still starts on the primary model, so recovery is automatic. Auth and config errors never rotate."
          configSection="advanced"
        >
          <textarea
            aria-label="Fallback models"
            className={inputClass}
            rows={3}
            placeholder={"opencode/muse-spark-1.3-contributor-free"}
            value={fallbackDraft ?? savedFallbackList.join("\n")}
            onChange={(event) => setFallbackDraft(event.target.value)}
            onBlur={(event) => commitFallbacks(event.target.value)}
          />
        </Field>
      )}
    </>
  ));
}
