import React from 'react';
import { Trophy, Lock, Unlock, Plus } from 'lucide-react';

export const ContestHeader = React.memo(function ContestHeader({
  activePlatform,
  adminMode,
  setAdminMode,
  openAddModal,
  platformStyle
}) {
  const platformName = activePlatform === 'leetcode' ? 'LeetCode' : activePlatform === 'codechef' ? 'CodeChef' : 'Codeforces';

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <div className={`h-8 w-8 rounded-xl bg-gradient-to-br ${platformStyle.gradient} flex items-center justify-center shadow-md ${platformStyle.shadow}`}>
            <Trophy className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white tracking-tight">Contest Master</h1>
        </div>
        <p className="text-xs text-slate-400 ml-10">
          Track college-wide {platformName} contest participation · Analyze batch trends · Generate reports
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => setAdminMode(p => !p)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
            adminMode
              ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-450 dark:border-amber-800/40 shadow-inner'
              : 'bg-white text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800 shadow-sm'
          }`}
        >
          {adminMode ? <Unlock className="h-3.5 w-3.5 text-amber-500" /> : <Lock className="h-3.5 w-3.5" />}
          {adminMode ? 'Admin ON' : 'Admin OFF'}
        </button>
        {adminMode && (
          <button
            onClick={() => openAddModal(activePlatform)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r ${platformStyle.gradientButton} text-white text-xs font-bold transition-all shadow-md ${platformStyle.shadow}`}
          >
            <Plus className="h-3.5 w-3.5" /> Create Contest
          </button>
        )}
      </div>
    </div>
  );
});
