import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Sidebar } from "@/components/shell/sidebar";
import { SIDEBAR_KEY } from "@/components/shell/sidebar-key";
import { TopBar } from "@/components/shell/top-bar";
import "./globals.css";

const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Treza AI",
  description:
    "Autonomous multi-tenant banking copilot on Airwallex: spend control, seller settlement and dispute defense in one closed loop.",
};

/** Applies the saved sidebar state before first paint. Narrow screens start collapsed. */
const sidebarScript = `(function(){try{var s=localStorage.getItem("${SIDEBAR_KEY}");if(s==="collapsed"||(!s&&innerWidth<1024))document.documentElement.dataset.sidebar="collapsed"}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: sidebarScript }} />
      </head>
      <body className="min-h-full bg-page font-sans text-body text-ink">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
