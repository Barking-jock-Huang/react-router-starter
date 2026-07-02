import { Link, useLoaderData } from "react-router";

import type { PublicTicketRadarLoaderData } from "./concert-intel.shared";
import { RadarTable } from "./concert-intel.ui";

export default function TicketRadarPage() {
  const { radar, stats } = useLoaderData<PublicTicketRadarLoaderData>();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ticket Radar</p>
          <h1 className="mt-1 text-3xl font-bold">買票雷達</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            這裡以啟售時間為主排序，演出日期只作為參考。低信心與缺少開賣時間會留在待確認狀態。
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
            <span className="rounded-md bg-white px-2 py-1 ring-1 ring-slate-200">Upcoming {stats.upcoming}</span>
            <span className="rounded-md bg-white px-2 py-1 ring-1 ring-slate-200">Low confidence {stats.low_confidence}</span>
            <span className="rounded-md bg-white px-2 py-1 ring-1 ring-slate-200">Missing time {stats.missing_sale_time}</span>
          </div>
          <Link to="/concert_events" className="mt-4 inline-block text-sm font-semibold text-slate-700 underline">
            查看原始活動列表
          </Link>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <RadarTable radar={radar} />
        </section>
      </div>
    </main>
  );
}
