import React from 'react';
import { Target, CheckCircle2, AlertCircle, TrendingUp, Zap } from 'lucide-react';

function StatCard({ icon: Icon, label, value, sub, colorClass, bgClass }) {
  return (
    <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-4 shadow-sm flex items-center gap-3.5 hover:shadow-md transition-all duration-200">
      <div className={`p-2.5 rounded-xl ${bgClass} shrink-0`}>
        <Icon className={`h-5 w-5 ${colorClass}`} />
      </div>
      <div>
        <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">{label}</span>
        <span className="text-lg font-black text-slate-850 dark:text-white mt-0.5 block">{value}</span>
        <span className="text-[10px] text-slate-400 mt-0.5 block">{sub}</span>
      </div>
    </div>
  );
}

export const ContestSummaryCards = React.memo(function ContestSummaryCards({ metrics }) {
  const { eligible = 0, attended = 0, missed = 0, rate = 0.0, ongoing = 0 } = metrics || {};

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
      <StatCard
        icon={Target}
        label="Eligible Contests"
        value={eligible}
        sub="Scheduled contests"
        colorClass="text-blue-500"
        bgClass="bg-blue-50 dark:bg-blue-950/40"
      />
      <StatCard
        icon={CheckCircle2}
        label="Attended"
        value={attended}
        sub="Verified participation"
        colorClass="text-emerald-500"
        bgClass="bg-emerald-50 dark:bg-emerald-950/40"
      />
      <StatCard
        icon={AlertCircle}
        label="Missed"
        value={missed}
        sub="Absences recorded"
        colorClass="text-rose-500"
        bgClass="bg-rose-50 dark:bg-rose-950/40"
      />
      <StatCard
        icon={TrendingUp}
        label="Attendance Rate"
        value={`${rate}%`}
        sub="Overall compliance"
        colorClass="text-amber-500"
        bgClass="bg-amber-50 dark:bg-amber-950/40"
      />
      <StatCard
        icon={Zap}
        label="Ongoing / Active"
        value={ongoing}
        sub="Currently running"
        colorClass="text-violet-500"
        bgClass="bg-violet-50 dark:bg-violet-950/40"
      />
    </div>
  );
});
