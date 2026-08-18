export interface ThisoneRuntimeConfig {
  hotkey?: string;
}

export function buildInjectionScript(
  cfg: ThisoneRuntimeConfig,
  clientBundle: string,
): string {
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  return `window.__THISONE_CFG__=${json};\n${clientBundle}`;
}
