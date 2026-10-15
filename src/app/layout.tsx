import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wicky Chat",
  description: "The Chadwick chat app by Output Club",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
