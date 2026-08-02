import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  AreaChart,
  Area
} from 'recharts';
import { TrendingUp, BarChart3 } from 'lucide-react';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 shadow-xl text-white text-xs">
      <p className="font-bold text-slate-300 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: <span className="font-black">{p.value}%</span></p>
      ))}
    </div>
  );
};

export const AnalyticsPanel = React.memo(function AnalyticsPanel({
  monthlyTrendData,
  semesterAnalyticsData,
  batchComparisonData,
  platformStyle
}) {
  const [activeTab, setActiveTab] = useState('trend');

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 p-4 border border-slate-200/60 dark:border-slate-850 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-blue-500" />
          <h2 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider">Performance Analytics</h2>
        </div>

        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('trend')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'trend' ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500'
            }`}
          >
            Monthly Trend
          </button>
          <button
            onClick={() => setActiveTab('batch')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'batch' ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500'
            }`}
          >
            Batch Comparison
          </button>
        </div>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {activeTab === 'trend' ? (
            <AreaChart data={monthlyTrendData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#33415520" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <RechartsTooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="rate" stroke={platformStyle.chartColor} fill={platformStyle.chartColor} fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          ) : (
            <BarChart data={batchComparisonData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#33415520" />
              <XAxis dataKey="batch" tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <RechartsTooltip content={<CustomTooltip />} />
              <Bar dataKey="rate" fill={platformStyle.chartColor} radius={[6, 6, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
});
