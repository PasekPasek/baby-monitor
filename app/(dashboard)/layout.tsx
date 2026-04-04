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
      <main className="pb-20">{children}</main>
      <Navigation />
    </div>
  )
}
