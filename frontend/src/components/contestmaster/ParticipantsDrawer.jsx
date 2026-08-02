import React from 'react';
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

export const ParticipantsDrawer = React.memo(function ParticipantsDrawer({
  contestId,
  participantData,
  isLoading
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-slate-400 gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-blue-500" /> Loading contest participants...
      </div>
    );
  }

  if (!participantData) {
    return (
      <div className="text-xs text-slate-400 py-2">No participant data available for contest {contestId}.</div>
    );
  }

  const { attended = [], missed = [], validationStatus, validationIssues = [] } = participantData;

  return (
    <div className="space-y-3 animate-fade-in">
      {validationStatus && validationStatus !== 'PASSED' && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 text-xs font-semibold border border-amber-200 dark:border-amber-900/30">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <span>Validation Warning: {validationIssues.join(', ') || 'Attendance data disparity detected.'}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Attended Students */}
        <div className="rounded-xl border border-emerald-100 dark:border-emerald-950 bg-emerald-50/30 dark:bg-emerald-950/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Attended ({attended.length})
            </span>
          </div>
          {attended.length === 0 ? (
            <span className="text-[11px] text-slate-400">No students attended.</span>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {attended.map((st, i) => (
                <div key={st.student_id || i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                  <span className="font-bold text-slate-700 dark:text-slate-300">{st.name || st.username}</span>
                  <span className="text-[10px] text-slate-400">Rank: #{st.rank || 'N/A'} | Solved: {st.solved !== undefined ? st.solved : 'N/A'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Missed Students */}
        <div className="rounded-xl border border-rose-100 dark:border-rose-950 bg-rose-50/30 dark:bg-rose-950/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5" /> Missed / Absent ({missed.length})
            </span>
          </div>
          {missed.length === 0 ? (
            <span className="text-[11px] text-slate-400">No absences recorded.</span>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {missed.map((st, i) => (
                <div key={st.student_id || i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                  <span className="font-bold text-slate-700 dark:text-slate-300">{st.name || st.username}</span>
                  <span className="text-[10px] text-rose-400 font-semibold">Absent</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
