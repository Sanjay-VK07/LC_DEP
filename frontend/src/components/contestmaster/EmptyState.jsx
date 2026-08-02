import React from 'react';
import { Trophy } from 'lucide-react';

export const EmptyState = React.memo(function EmptyState({ title = 'No Contests Found', description = 'Try adjusting your filters or active platform selection.' }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-850 p-12 text-center flex flex-col items-center justify-center space-y-3">
      <div className="h-12 w-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
        <Trophy className="h-6 w-6" />
      </div>
      <h3 className="text-sm font-black text-slate-700 dark:text-slate-200">{title}</h3>
      <p className="text-xs text-slate-400 max-w-sm">{description}</p>
    </div>
  );
});
