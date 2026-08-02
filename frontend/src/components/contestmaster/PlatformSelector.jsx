import React from 'react';

export const PlatformSelector = React.memo(function PlatformSelector({
  activePlatform,
  setActivePlatform
}) {
  const platforms = [
    { id: 'leetcode', label: 'LeetCode', icon: '🟠', activeClass: 'bg-orange-500 text-white shadow-md shadow-orange-500/20' },
    { id: 'codechef', label: 'CodeChef', icon: '🟤', activeClass: 'bg-amber-800 text-white shadow-md shadow-amber-800/20' },
    { id: 'codeforces', label: 'Codeforces', icon: '🔴', activeClass: 'bg-rose-600 text-white shadow-md shadow-rose-500/20' }
  ];

  return (
    <div className="flex rounded-2xl bg-white dark:bg-slate-900 p-1.5 border border-slate-200/60 dark:border-slate-850 shadow-sm gap-2">
      {platforms.map(platform => {
        const isActive = activePlatform === platform.id;
        const btnClass = isActive
          ? platform.activeClass
          : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50";
        
        return (
          <button
            key={platform.id}
            onClick={() => setActivePlatform(platform.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black transition-all ${btnClass}`}
          >
            <span className="text-sm leading-none">{platform.icon}</span>
            {platform.label}
          </button>
        );
      })}
    </div>
  );
});
