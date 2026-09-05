import type { Metadata } from "next";
import { Nav } from "../components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "InferGate Console",
  description: "Production AI inference gateway console",
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="en">
      <body className="min-h-screen bg-void font-sans text-white antialiased">
        <div className="flex min-h-screen">
          <Nav />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
