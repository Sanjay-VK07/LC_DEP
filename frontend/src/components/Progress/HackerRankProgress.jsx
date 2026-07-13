import React from 'react';
import { usePlatformData } from '../../hooks/usePlatformData';
import { platformConfig } from '../../config/platformConfig';
import { logger } from '../../utils/logger';
import ProgressCard from './ProgressCard';
import ProgressStat from './ProgressStat';
import { RefreshCw, Code2, Award, Star, CheckCircle } from 'lucide-react';

export default function HackerRankProgress() {
  const { data, loading, error, refresh, retry } = usePlatformData('hackerrank');
  const config = platformConfig.hackerrank;

  React.useEffect(() => {
    if (data) {
      logger.info(`[HackerRank] Loaded metrics for user: ${data.profile?.username}`);
    }
  }, [data]);

  if (loading) {
    return (
      <ProgressCard title={`${config.displayName} Progress`}>
        <div className="animate-pulse space-y-5">
          <div className="flex gap-4">
            <div className="h-12 w-12 bg-slate-200 dark:bg-slate-800 rounded-xl" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-xl w-1/3" />
              <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-xl w-1/4" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-20 bg-slate-200 dark:bg-slate-800 rounded-xl" />
            <div className="h-20 bg-slate-200 dark:bg-slate-800 rounded-xl" />
          </div>
          <div className="h-32 bg-slate-200 dark:bg-slate-800 rounded-xl" />
        </div>
      </ProgressCard>
    );
  }

  if (error) {
    logger.error('[HackerRank] Progress card encountered fetch error', error);
    return (
      <ProgressCard title={`${config.displayName} Progress`}>
        <div className="py-8 text-center space-y-4">
          <p className="text-sm text-rose-500">{error}</p>
          <button 
            onClick={retry}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      </ProgressCard>
    );
  }

  if (!data || !data.profile) {
    return (
      <ProgressCard title={`${config.displayName} Progress`}>
        <div className="py-12 text-center text-slate-400 text-xs">
          No {config.displayName} profile linked or verified for this student.
        </div>
      </ProgressCard>
    );
  }

  const { profile, solvedStats } = data;

  const handleRefresh = async () => {
    logger.info('[HackerRank] Triggering manual refresh...');
    logger.time('hackerrank-refresh');
    try {
      await refresh();
      logger.timeEnd('hackerrank-refresh');
    } catch (e) {
      logger.error('[HackerRank] Manual refresh failed', e);
    }
  };

  return (
    <ProgressCard 
      title={
        <div className="flex items-center gap-2">
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg shadow-sm font-bold ${config.logoBgColor}`}>
            {config.logoText}
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-slate-800 dark:text-white">{profile.username}</span>
              <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 uppercase">
                Verified
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-normal">{config.displayName} Metrics</p>
          </div>
        </div>
      }
      headerRight={
        <button
          onClick={handleRefresh}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500"
          title={`Refresh ${config.displayName} Data`}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      }
    >
      <div className="space-y-6">
        {/* Profile Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <ProgressStat 
            label="Star Rating" 
            value={profile.stars ? `${profile.stars}★` : '0★'} 
            icon={<Star className="h-5 w-5 text-amber-400" />} 
            color="primary" 
          />
          <ProgressStat 
            label="Total Solved" 
            value={solvedStats?.totalSolved || 0} 
            icon={<Code2 className="h-5 w-5" />} 
            color="emerald" 
          />
          <ProgressStat 
            label="Certificates" 
            value={Array.isArray(profile.certificates) ? profile.certificates.length : 0} 
            icon={<Award className="h-5 w-5" />} 
            color="blue" 
          />
        </div>

        {/* Domain Scores */}
        <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-4 bg-slate-50/20 dark:bg-slate-950/10">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Domain Solved Distribution</h4>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block">Algorithms</span>
              <span className="text-base font-bold text-slate-700 dark:text-slate-300">{solvedStats?.algorithms || 0}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider block">SQL</span>
              <span className="text-base font-bold text-slate-700 dark:text-slate-300">{solvedStats?.sql || 0}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-purple-500 uppercase tracking-wider block">Languages</span>
              <span className="text-base font-bold text-slate-700 dark:text-slate-300">{solvedStats?.languages || 0}</span>
            </div>
          </div>
        </div>

        {/* Badges */}
        {Array.isArray(profile.badges) && profile.badges.length > 0 && (
          <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-4">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Earned Skill Badges</h4>
            <div className="flex flex-wrap gap-3">
              {profile.badges.map((badge, idx) => (
                <div key={`${badge.name || badge}_${idx}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 text-xs">
                  <span className="text-base">⭐</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{badge.name || badge}</span>
                  {badge.stars && <span className="font-bold text-amber-500 text-[10px]">{badge.stars}★</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Certificates */}
        {Array.isArray(profile.certificates) && profile.certificates.length > 0 && (
          <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-4">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Verified Certificates</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {profile.certificates.map((cert, idx) => (
                <div key={`${cert.name || cert}_${idx}`} className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/10 text-xs">
                  <CheckCircle className="h-4.5 w-4.5 text-emerald-500 shrink-0" />
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300 block">{cert.name || cert}</span>
                    <span className="text-[10px] text-slate-400">Verified by HackerRank</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ProgressCard>
  );
}
