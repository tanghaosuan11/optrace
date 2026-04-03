export type WindowMode = "normal" | "verify" | "whatif" | "cfg";

export function getWindowMode(): { mode: WindowMode; readonly: boolean } {
  const sp = new URLSearchParams(window.location.search);
  const modeRaw = (sp.get("mode") || "").toLowerCase();
  const readonlyRaw = (sp.get("readonly") || "").toLowerCase();

  const mode: WindowMode =
    modeRaw === "verify" ? "verify" :
    modeRaw === "whatif" ? "whatif" :
    modeRaw === "cfg" ? "cfg" :
    "normal";
  // canonical switch is `readonly`; keep `mode=verify` for backward compatibility
  const readonly = readonlyRaw === "1" || readonlyRaw === "true" || mode === "verify";
  return { mode, readonly };
}

