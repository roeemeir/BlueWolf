import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import "./v04.css";
import "./v04-fixes.css";
import "./v05.css";
import "./v08.css";

export const metadata: Metadata = {
  title: "זאב כחול | ניטור סנכרון רכבים",
  description: "מערכת מבצעית לניטור נתיבים, קבוצות וציוני סנכרון בזמן אמת ובתחקור לאחור",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="he" dir="rtl" suppressHydrationWarning><body><ThemeProvider>{children}<Toaster position="bottom-left" richColors /></ThemeProvider></body></html>;
}
