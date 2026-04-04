import { NextRequest, NextResponse } from "next/server"
import { runHeartbeatAgent } from "@/lib/heartbeat-agent"

export async function POST(req: NextRequest) {
  // Verify cron secret
  const secret = req.headers.get("x-cron-secret")
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    console.log("[Heartbeat] Starting agent...")
    const result = await runHeartbeatAgent()
    console.log("[Heartbeat] Done.", result.actionsPerformed)
    return NextResponse.json({
      ok: true,
      actionsPerformed: result.actionsPerformed,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[Heartbeat] Error:", err)
    return NextResponse.json(
      { error: "Agent failed", details: String(err) },
      { status: 500 }
    )
  }
}

// Allow GET for manual testing
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret")
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return POST(req)
}
