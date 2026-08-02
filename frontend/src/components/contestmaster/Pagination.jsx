import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const Pagination = React.memo(function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 rounded-b-2xl">
      <span className="text-xs font-semibold text-slate-400">
        Page <span className="font-bold text-slate-700 dark:text-slate-200">{currentPage}</span> of{' '}
        <span className="font-bold text-slate-700 dark:text-slate-200">{totalPages}</span> ({totalItems} total contests)
      </span>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-750 text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-750 text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
});
