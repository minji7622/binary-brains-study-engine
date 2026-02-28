import { NextResponse } from "next/server";

type TimeBlock = {
  label: string;
  minutes: number;
  task: string;
  deliverable?: string;
};

type PlanDay = {
  day: number;
  focus_title?: string;
  time_blocks?: TimeBlock[];
  // Legacy: hours + focus for fallback single event per day
  hours?: number;
  focus?: string;
};

const CRLF = "\r\n";

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function formatIcsLocal(date: Date, hours: number, minutes: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(hours).padStart(2, "0");
  const min = String(minutes).padStart(2, "0");
  const sec = "00";
  return `${y}${m}${d}T${h}${min}${sec}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const planDays: PlanDay[] = Array.isArray(body.planDays) ? body.planDays : [];
    const timezone = typeof body.timezone === "string" ? body.timezone : undefined;

    if (planDays.length === 0) {
      return NextResponse.json(
        { error: "planDays is required and must be a non-empty array" },
        { status: 400 }
      );
    }

    const now = new Date();
    const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const ts = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//NeuroPlan//Study Plan//EN",
      "CALSCALE:GREGORIAN",
    ];

    for (const planDay of planDays) {
      const dayIndex = Math.max(0, (planDay.day ?? 1) - 1);
      const eventDate = new Date(baseDate);
      eventDate.setDate(baseDate.getDate() + dayIndex);

      const blocks = planDay.time_blocks && planDay.time_blocks.length > 0
        ? planDay.time_blocks
        : [{ label: planDay.focus_title || planDay.focus || "Study", minutes: Math.round((planDay.hours ?? 1) * 60), task: planDay.focus || "Study block", deliverable: "" }];

      let startHour = 9;
      let startMin = 0;

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const mins = Math.max(1, Number(block.minutes) || 30);
        const endMin = startMin + mins;
        const endHour = startHour + Math.floor(endMin / 60);
        const endMinRem = endMin % 60;

        const dtStart = formatIcsLocal(eventDate, startHour, startMin);
        const dtEnd = formatIcsLocal(eventDate, endHour, endMinRem);
        const uid = `neuroplan-${planDay.day}-${i}-${Date.now()}@neuroplan`;

        const summary = escapeIcsText(block.label || "Study");
        const desc = escapeIcsText([block.task, block.deliverable].filter(Boolean).join("\\n\\n"));

        lines.push("BEGIN:VEVENT");
        lines.push(`UID:${uid}`);
        lines.push(`DTSTAMP:${ts}`);
        lines.push(`DTSTART:${dtStart}`);
        lines.push(`DTEND:${dtEnd}`);
        lines.push(`SUMMARY:${summary}`);
        if (desc) lines.push(`DESCRIPTION:${desc}`);
        lines.push("END:VEVENT");

        startMin = endMinRem;
        startHour = endHour;
      }
    }

    lines.push("END:VCALENDAR");
    const icsString = lines.join(CRLF);

    return new Response(icsString, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="neuroplan.ics"',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to generate calendar" },
      { status: 500 }
    );
  }
}
