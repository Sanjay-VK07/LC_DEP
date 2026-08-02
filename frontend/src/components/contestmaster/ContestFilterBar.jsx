import React from 'react';
import { Filter, Search, Download, RefreshCw } from 'lucide-react';

export const ContestFilterBar = React.memo(function ContestFilterBar({
  selectedBatch,
  setSelectedBatch,
  availableBatches,
  selectedStudentId,
  setSelectedStudentId,
  students,
  filterType,
  setFilterType,
  filterStatus,
  setFilterStatus,
  activePlatform,
  handleSyncPlatformData,
  syncingPlatform,
  handleExportReport
}) {
  const contestTypes = activePlatform === 'leetcode'
    ? ['weekly', 'biweekly']
    : activePlatform === 'codechef'
    ? ['starters', 'cook-off', 'lunchtime', 'long challenge']
    : ['div1', 'div2', 'div3', 'div4', 'educational', 'global'];

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 p-4 border border-slate-200/60 dark:border-slate-850 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2.5 flex-1">
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-500 text-xs font-bold shrink-0">
          <Filter className="h-3.5 w-3.5" /> Filters
        </div>

        {/* Batch Selector */}
        <select
          value={selectedBatch}
          onChange={(e) => setSelectedBatch(e.target.value)}
          className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-700 dark:text-slate-300 focus:outline-none"
        >
          <option value="">All Academic Batches</option>
          {availableBatches.map(b => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>

        {/* Student Selector */}
        <select
          value={selectedStudentId}
          onChange={(e) => setSelectedStudentId(e.target.value)}
          className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-700 dark:text-slate-300 focus:outline-none max-w-[200px]"
        >
          <option value="all">All Active Students</option>
          {students.map(s => (
            <option key={s.id} value={s.id}>{s.name} ({s.roll_no})</option>
          ))}
        </select>

        {/* Type Filter */}
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-700 dark:text-slate-300 focus:outline-none capitalize"
        >
          <option value="">All Contest Types</option>
          {contestTypes.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* Status Filter */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-slate-700 dark:text-slate-300 focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="upcoming">Upcoming</option>
          <option value="ongoing">Ongoing</option>
          <option value="unrated">Unrated</option>
        </select>
      </div>

      <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
        <button
          onClick={handleSyncPlatformData}
          disabled={syncingPlatform}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-750 transition-all border border-slate-200 dark:border-slate-700"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncingPlatform ? 'animate-spin' : ''}`} />
          {syncingPlatform ? 'Syncing...' : 'Sync Platform'}
        </button>

        <button
          onClick={handleExportReport}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 hover:bg-emerald-100 transition-all border border-emerald-200 dark:border-emerald-900/40"
        >
          <Download className="h-3.5 w-3.5" /> Export Excel
        </button>
      </div>
    </div>
  );
});
