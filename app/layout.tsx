import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { SwRegister } from "@/components/sw-register";
import { BRAND } from "@/lib/brand";
import { Providers } from "./providers";
import "./globals.css";

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: { default: "LendLoop", template: "%s | LendLoop" },
  description: "Borrow what you need. Lend what you don't. A tool-lending board for your neighborhood.",
  applicationName: "LendLoop",
  appleWebApp: { capable: true, title: "LendLoop", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: BRAND.paper,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${schibsted.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <ClerkProvider
          // Clerk's dev-instance telemetry is off: no third-party beacon from this app.
          telemetry={false}
          signInFallbackRedirectUrl="/tools"
          signUpFallbackRedirectUrl="/tools"
          afterSignOutUrl="/"
          appearance={{
            variables: {
              colorPrimary: BRAND.loop,
              colorForeground: BRAND.ink,
              fontFamily: "var(--font-schibsted), system-ui, sans-serif",
              borderRadius: "0.625rem",
            },
          }}
        >
          <Providers>{children}</Providers>
        </ClerkProvider>
        <SwRegister />
      </body>
    </html>
  );
}
