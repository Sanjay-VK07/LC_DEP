import React from 'react';

export const AttendanceBar = React.memo(function AttendanceBar({ attended, total }) {
  const percentage = total > 0 ? Math.min(100, Math.round((attended / total) * 100)) : 0;
  
  let color = 'bg-rose-500';
  if (percentage >= 75) color = 'bg-emerald-500';
  else if (percentage >= 50) color = 'bg-amber-500';

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
        <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{percentage}%</span>
    </div>
  );
});
