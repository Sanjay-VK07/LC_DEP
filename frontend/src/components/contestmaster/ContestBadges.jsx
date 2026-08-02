import React from 'react';
import { Zap, Calendar } from 'lucide-react';
import { normalizeAttendanceStatus } from '../../utils/attendance';

export function getContestTiming(dateStr, durationSeconds = 5400) {
  const now = new Date();
  const startTime = new Date(dateStr);
  if (isNaN(startTime.getTime())) return 'past';
  const endTime = new Date(startTime.getTime() + durationSeconds * 1000);
  if (startTime > now) return 'upcoming';
  if (startTime <= now && endTime > now) return 'active';
  return 'past';
}

export const TypeBadge = React.memo(function TypeBadge({ type }) {
  const t = type ? type.toLowerCase() : '';

  if (t === 'weekly') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30">
        <Zap className="h-3 w-3" /> Weekly
      </span>
    );
  }
  if (t === 'biweekly') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400 border border-violet-100 dark:border-violet-900/30">
        <Calendar className="h-3 w-3" /> Biweekly
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
      {type}
    </span>
  );
});

export const SyncSourceBadge = React.memo(function SyncSourceBadge({ source, status }) {
  if (status === 'BLOCKED_UPSTREAM') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-extrabold bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-200 dark:border-rose-900/30">
        ⚠ Upstream Blocked
      </span>
    );
  }
  if (source === 'CSV_IMPORT' || source === 'CSV') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-extrabold bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400 border border-violet-200 dark:border-violet-900/30">
        📁 CSV Imported
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-extrabold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/30">
      ✓ GraphQL Synced
    </span>
  );
});

export const AttendanceBadge = React.memo(function AttendanceBadge({ contest }) {
  const timing = getContestTiming(contest.date, contest.duration || 5400);
  const isOngoing = timing === 'active';
  const isPresent = contest.is_joined || normalizeAttendanceStatus(contest.attendance_status) === 'PRESENT';

  if (isOngoing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-extrabold bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" /> Ongoing
      </span>
    );
  }

  if (isPresent) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-extrabold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Present
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-extrabold bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Absent
    </span>
  );
});

export const TimingBadge = React.memo(function TimingBadge({ timing }) {
  const map = {
    active: 'bg-amber-400 text-white animate-pulse',
    upcoming: 'bg-sky-500 text-white',
    past: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  };
  return (
    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[10px] font-extrabold capitalize ${map[timing] || map.past}`}>
      {timing}
    </span>
  );
});
