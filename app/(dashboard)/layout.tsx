import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import Navigation from "@/components/Navigation"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      {/* Mobile: pb-20 for bottom nav | Desktop: pt-14 for top nav */}
      <main className="pb-20 md:pb-8 md:pt-14">
        {children}
      </main>
    </div>
  )
}
