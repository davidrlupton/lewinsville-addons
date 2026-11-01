import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lewinsville",
  description: "The house, in your hand.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Lewinsville" },
};
// The status bar takes its colour from theme-color: one per scheme, matching the page background, not the brand.
// page.tsx rewrites these when the person switches look.
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fff6e9" }, { media: "(prefers-color-scheme: dark)", color: "#15102b" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the remembered look before first paint so the page never flashes the other one. */}
        <script dangerouslySetInnerHTML={{ __html: 'try{var t=localStorage.getItem("lhh-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}' }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
