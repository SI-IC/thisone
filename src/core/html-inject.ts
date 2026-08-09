export interface ThisoneRuntimeConfig {
  hotkey?: string;
}

export function buildInjectionScript(
  cfg: ThisoneRuntimeConfig,
  clientBundle: string,
): string {
  return `window.__THISONE_CFG__=${JSON.stringify(cfg)};\n${clientBundle}`;
}
