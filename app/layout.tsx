import type { Metadata, Viewport } from "next"
import { Inter, Geist } from "next/font/google"
import { SessionProvider } from "next-auth/react"
import "./globals.css"
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
})

export const metadata: Metadata = {
  title: "Baby Monitor",
  description: "Monitorowanie i logowanie aktywności niemowlaka",
  manifest: "/manifest.json",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#3b82f6",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pl" className={cn("h-full", inter.variable, "font-sans", geist.variable)}>
      <body className="min-h-full bg-gray-50 font-sans antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
