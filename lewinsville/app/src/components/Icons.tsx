// Tab-bar icons: one stroke weight, one size, drawn by hand so they sit on the same optical centre.
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const S = ({ children }: { children: React.ReactNode }) => <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden {...P}>{children}</svg>;

export const Icon = {
  home: () => <S><path d="M3.5 11 12 4l8.5 7" /><path d="M6 9.5V19h12V9.5" /><path d="M10 19v-5h4v5" /></S>,
  lounge: () => <S><path d="M9 17.5V6.5l10-2.5v11" /><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="16.5" cy="15" r="2.5" /></S>,
  rooms: () => <S><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></S>,
  energy: () => <S><path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z" /></S>,
  climate: () => <S><path d="M10 5a2 2 0 1 1 4 0v9.3a3.5 3.5 0 1 1-4 0z" /><path d="M12 10v5" /></S>,
  talk: () => <S><path d="M12 3.5l1.9 5.3 5.3 1.9-5.3 1.9L12 17.9l-1.9-5.3-5.3-1.9 5.3-1.9z" /><path d="M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z" /></S>,
};
export type IconName = keyof typeof Icon;
