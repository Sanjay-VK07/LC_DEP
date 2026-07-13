import React from 'react';
import { usePlatformData } from '../../hooks/usePlatformData';
import { platformConfig } from '../../config/platformConfig';
import { logger } from '../../utils/logger';
import ProgressCard from './ProgressCard';
import ProgressStat from './ProgressStat';
import { RatingTrendChart } from './ProgressChart';
import { RefreshCw, Code2, Award, Users, Star } from 'lucide-react';

export default function CodeforcesProgress() {
  const { data, loading, error, refresh, retry } = usePlatformData('codeforces');
  const config = platformConfig.codeforces;

  // Unconditionally calculate lowest rating at the top level
  const lowestRating = React.useMemo(() => {
    const contestHistory = data?.contestHistory;
    if (!contestHistory || contestHistory.length === 0) return 0;
    const ratings = contestHistory.map(c => c.newRating || c.rating || 0).filter(r => r > 0);
    return ratings.length > 0 ? Math.min(...ratings) : 0;
  }, [data]);

  React.useEffect(() => {
    if (data) {
      logger.info(`[Codeforces] Loaded metrics for user: ${data.profile?.username}`);
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
    logger.error('[Codeforces] Progress card encountered fetch error', error);
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

  const { profile, solvedStats, contestHistory, ratingHistory } = data;

  const handleRefresh = async () => {
    logger.info('[Codeforces] Triggering manual refresh...');
    logger.time('codeforces-refresh');
    try {
      await refresh();
      logger.timeEnd('codeforces-refresh');
    } catch (e) {
      logger.error('[Codeforces] Manual refresh failed', e);
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
        {/* Profile Card & Solve Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <ProgressStat 
            label="Current Rating" 
            value={profile.rating || 0} 
            icon={<Award className="h-5 w-5" />} 
            color="primary" 
            subtext={`Highest: ${profile.maxRating || profile.rating || 0}`}
          />
          <ProgressStat 
            label="Current Rank" 
            value={profile.rank ? (profile.rank.charAt(0).toUpperCase() + profile.rank.slice(1)) : 'Unrated'} 
            icon={<Star className="h-5 w-5" />} 
            color="amber" 
            subtext={`Max: ${profile.maxRank || profile.rank || 'Unrated'}`}
          />
          <ProgressStat 
            label="Problem Solved" 
            value={solvedStats?.totalSolved || 0} 
            icon={<Code2 className="h-5 w-5" />} 
            color="emerald" 
          />
          <ProgressStat 
            label="Contribution / Friends" 
            value="+10 / 4" 
            icon={<Users className="h-5 w-5" />} 
            color="indigo" 
          />
        </div>

        {/* Difficulty stats */}
        <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-4 bg-slate-50/20 dark:bg-slate-950/10">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Problems Solved by Index</h4>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block">Index A-B (Easy)</span>
              <span className="text-base font-bold text-slate-700 dark:text-slate-300">{solvedStats?.easySolved || 0}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block">Index C-D (Med)</span>
              <span className="text-base font-bold text-slate-700 dark:text-slate-300">{solvedStats?.mediumSolved || 0}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider block">Index E+ (Hard)</span>
              <span className="text-base font-bold text-slate-700 dark:text-slate-300">{solvedStats?.hardSolved || 0}</span>
            </div>
          </div>
        </div>

        {/* Charts: Rating Trend & Contest Performance */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-4 h-48">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Rating Graph</h4>
            <div className="h-32">
              <RatingTrendChart data={ratingHistory} color={config.themeColor} label="Rating" />
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-5 flex flex-col justify-between bg-slate-50/20 dark:bg-slate-950/10 h-48">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Contest Performance</h4>
            <div className="grid grid-cols-2 gap-4 text-center my-auto">
              <div>
                <span className="text-[9px] text-slate-400 block font-semibold">Highest Rating</span>
                <span className="text-sm font-bold text-slate-700 dark:text-white">
                  {profile.maxRating || profile.rating || 0}
                </span>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 block font-semibold">Lowest Rating</span>
                <span className="text-sm font-bold text-slate-700 dark:text-white">
                  {lowestRating > 0 && lowestRating < 9999 ? lowestRating : profile.rating || 0}
                </span>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 block font-semibold">Total Contests</span>
                <span className="text-sm font-bold text-slate-700 dark:text-white">
                  {contestHistory.length || 0}
                </span>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 block font-semibold">Current Rank</span>
                <span className="text-sm font-bold text-slate-700 dark:text-white">
                  {profile.rank ? (profile.rank.charAt(0).toUpperCase() + profile.rank.slice(1)) : 'Unrated'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Contests list */}
        {contestHistory.length > 0 && (
          <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-4">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Recent Contests</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {contestHistory.map((c, idx) => (
                <div key={`${c.contestId || 'c'}_${idx}`} className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/10 text-xs">
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300 block">{c.contestName || 'Contest Name Unavailable'}</span>
                    <span className="text-[10px] text-slate-400">{c.contestDate ? new Date(c.contestDate).toLocaleDateString() : ''}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-teal-600 block">Rank: {c.rank || '-'}</span>
                    <span className={`text-[10px] font-bold ${c.ratingChange >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {c.ratingChange >= 0 ? `+${c.ratingChange}` : c.ratingChange}
                    </span>
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
