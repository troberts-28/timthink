function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? [...value].map((char) => char + char).join("") : value;
  const number = Number.parseInt(full, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function mix(foreground: string, background: string, amount: number): string {
  const [fr, fg, fb] = hexToRgb(foreground);
  const [br, bg, bb] = hexToRgb(background);
  const channel = (f: number, b: number) => Math.round(f * amount + b * (1 - amount));
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(channel(fr, br))}${toHex(channel(fg, bg))}${toHex(channel(fb, bb))}`;
}

export function mermaidThemeVariables(isDark: boolean): Record<string, string | boolean> {
  const ink = readToken("--ink");
  const surface = readToken("--surface");
  const bg = readToken("--bg");
  const sunken = readToken("--bg-sunken");
  const accent = readToken("--accent");
  const accentSoft = readToken("--accent-soft");
  const border = mix(ink, surface, 0.3);
  const muted = mix(ink, surface, 0.64);
  return {
    darkMode: isDark,
    background: surface,
    fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
    fontSize: "14px",
    textColor: ink,
    primaryColor: surface,
    primaryTextColor: ink,
    primaryBorderColor: border,
    secondaryColor: accentSoft,
    secondaryTextColor: ink,
    secondaryBorderColor: accent,
    tertiaryColor: sunken,
    tertiaryTextColor: ink,
    tertiaryBorderColor: mix(ink, surface, 0.16),
    mainBkg: surface,
    nodeBorder: border,
    nodeTextColor: ink,
    lineColor: muted,
    defaultLinkColor: muted,
    clusterBkg: bg,
    clusterBorder: mix(ink, surface, 0.16),
    titleColor: ink,
    edgeLabelBackground: surface,
    noteBkgColor: accentSoft,
    noteTextColor: ink,
    noteBorderColor: accent,
    actorBkg: surface,
    actorBorder: border,
    actorTextColor: ink,
    actorLineColor: muted,
    signalColor: ink,
    signalTextColor: ink,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: border,
    labelTextColor: ink,
    loopTextColor: ink,
    activationBkgColor: accentSoft,
    activationBorderColor: accent,
    sequenceNumberColor: surface,
  };
}
