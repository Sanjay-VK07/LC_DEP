import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export const ErrorState = React.memo(function ErrorState({ message, onRetry }) {
  return (
    <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/30 p-4 flex items-center justify-between">
      <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 text-xs font-semibold">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{message || 'An error occurred while loading Contest Master.'}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-500"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      )}
    </div>
  );
});
