import React from 'react';
import { usePlatformData } from '../../hooks/usePlatformData';
import { platformConfig } from '../../config/platformConfig';
import { logger } from '../../utils/logger';
import ProgressCard from './ProgressCard';
import ProgressStat from './ProgressStat';
import { RatingTrendChart, TopicDistributionChart, LanguageDoughnutChart, SubmissionHeatmap } from './ProgressChart';
import { 
  RefreshCw, 
  Code2, 
  Award, 
  Percent, 
  Flame, 
  Trophy, 
  Activity, 
  Globe, 
  Target, 
  Calendar,
  Sparkles,
  ChevronRight
} from 'lucide-react';

export default function LeetCodeProgress() {
  const { data, loading, error, refresh, retry } = usePlatformData('leetcode');
  const config = platformConfig.leetcode;

  // Compute stats safely at the top level to adhere to the Rules of Hooks
  const bestContestRank = React.useMemo(() => {
    const contestHistory = data?.contestHistory;
    if (!contestHistory || contestHistory.length === 0) return 'N/A';
    const ranks = contestHistory.map(c => c.rank).filter(r => r > 0);
    return ranks.length > 0 ? `#${Math.min(...ranks)}` : 'N/A';
  }, [data]);

  const recentSubmissions = React.useMemo(() => {
    const recent = data?.profile?.recentSubmissions;
    return Array.isArray(recent) ? recent.slice(0, 10) : [];
  }, [data]);

  const topicData = React.useMemo(() => {
    const topicStats = data?.profile?.topicStats;
    return Array.isArray(topicStats) 
      ? topicStats.slice(0, 7).map(t => ({ name: t.tagName || t.name, value: t.problemsSolved || t.value }))
      : [];
  }, [data]);

  const langData = React.useMemo(() => {
    const languageStats = data?.profile?.languageStats;
    return Array.isArray(languageStats)
      ? languageStats.map(l => ({ name: l.languageName || l.name, value: l.problemsSolved || l.value }))
      : [];
  }, [data]);

  const activityStats = React.useMemo(() => {
    const calendar = data?.heatmap || {};
    if (Object.keys(calendar).length === 0) {
      return { activeDays: 0, streak: 0, totalSubmissions: 0 };
    }

    const entries = Object.entries(calendar)
      .map(([key, val]) => {
        const timestamp = Number(key);
        const date = !isNaN(timestamp) && timestamp > 1000000 
          ? new Date(timestamp * 1000) 
          : new Date(key);
        return { date, count: val };
      })
      .filter(e => !isNaN(e.date.getTime()) && e.count > 0)
      .sort((a, b) => a.date - b.date);

    const activeDays = entries.length;
    const totalSubmissions = entries.reduce((sum, e) => sum + e.count, 0);

    let maxStreak = 0;
    let currentStreak = 0;
    let prevDate = null;

    entries.forEach(e => {
      const currentDate = new Date(e.date.getFullYear(), e.date.getMonth(), e.date.getDate());
      if (prevDate === null) {
        currentStreak = 1;
      } else {
        const diffTime = Math.abs(currentDate - prevDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          currentStreak++;
        } else if (diffDays > 1) {
          if (currentStreak > maxStreak) {
            maxStreak = currentStreak;
          }
          currentStreak = 1;
        }
      }
      prevDate = currentDate;
    });

    if (currentStreak > maxStreak) {
      maxStreak = currentStreak;
    }

    return {
      activeDays,
      streak: maxStreak,
      totalSubmissions
    };
  }, [data]);

  React.useEffect(() => {
    if (data) {
      logger.info(`[LeetCode] Loaded metrics for user: ${data.profile?.username}`);
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="h-20 bg-slate-200 dark:bg-slate-800 rounded-xl" />
            <div className="h-20 bg-slate-200 dark:bg-slate-800 rounded-xl" />
            <div className="h-20 bg-slate-200 dark:bg-slate-800 rounded-xl" />
            <div className="h-20 bg-slate-200 dark:bg-slate-800 rounded-xl" />
          </div>
          <div className="h-32 bg-slate-200 dark:bg-slate-800 rounded-xl" />
        </div>
      </ProgressCard>
    );
  }

  if (error) {
    logger.error('[LeetCode] Progress card encountered fetch error', error);
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

  const { profile, contestHistory, solvedStats, heatmap, ratingHistory } = data;

  const easySolved = solvedStats?.easySolved;
  const mediumSolved = solvedStats?.mediumSolved;
  const hardSolved = solvedStats?.hardSolved;
  const acceptanceRate = solvedStats?.acceptanceRate;
  const totalSolved = solvedStats?.totalSolved;
  const rating = profile?.rating;

  console.log("API Response", profile);
  console.log("Mapped Data", solvedStats);
  console.log("Props", {});
  console.log("State", { data, loading, error });
  console.log("Before JSX Render:", {
    easySolved,
    mediumSolved,
    hardSolved,
    acceptanceRate,
    totalSolved,
    rating
  });



  const handleRefresh = async () => {
    logger.info('[LeetCode] Triggering manual refresh...');
    logger.time('leetcode-refresh');
    try {
      await refresh();
      logger.timeEnd('leetcode-refresh');
    } catch (e) {
      logger.error('[LeetCode] Manual refresh failed', e);
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
        {/* Section 1: Profile Header Overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <ProgressStat 
            label="Contest Rating" 
            value={profile.rating || 1500} 
            icon={<Award className="h-5 w-5" />} 
            color="primary" 
            subtext={`Highest: ${profile.maxRating || profile.rating || 1500}`}
          />
          <ProgressStat 
            label="Global Rank" 
            value={profile.globalRanking ? `#${Number(profile.globalRanking).toLocaleString()}` : 'Unranked'} 
            icon={<Globe className="h-5 w-5" />} 
            color="amber" 
          />
          <ProgressStat 
            label="Total Solved" 
            value={solvedStats?.totalSolved || 0} 
            icon={<Code2 className="h-5 w-5" />} 
            color="emerald" 
          />
          <ProgressStat 
            label="Acceptance Rate" 
            value={solvedStats?.acceptanceRate ? `${solvedStats.acceptanceRate}%` : '0%'} 
            icon={<Percent className="h-5 w-5" />} 
            color="blue" 
          />
        </div>

        {/* Section 2: Problems Solved breakdown with progression bars */}
        <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-5 bg-slate-50/20 dark:bg-slate-950/10 space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Solved Breakdown</h4>
            <span className="text-[10px] text-slate-400 font-semibold">Total Attempted: {solvedStats?.totalAttempted || 0}</span>
          </div>

          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block">Easy</span>
              <span className="text-lg font-bold text-slate-700 dark:text-slate-300">{solvedStats?.easySolved || 0}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block">Medium</span>
              <span className="text-lg font-bold text-slate-700 dark:text-slate-300">{solvedStats?.mediumSolved || 0}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider block">Hard</span>
              <span className="text-lg font-bold text-slate-700 dark:text-slate-300">{solvedStats?.hardSolved || 0}</span>
            </div>
          </div>

          {/* Simple relative visual breakdown bar */}
          <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
            {solvedStats?.totalSolved > 0 ? (
              <>
                <div 
                  className="bg-emerald-500 h-full" 
                  style={{ width: `${((solvedStats.easySolved || 0) / solvedStats.totalSolved) * 100}%` }} 
                  title={`Easy: ${Math.round(((solvedStats.easySolved || 0) / solvedStats.totalSolved) * 100)}%`}
                />
                <div 
                  className="bg-amber-500 h-full" 
                  style={{ width: `${((solvedStats.mediumSolved || 0) / solvedStats.totalSolved) * 100}%` }} 
                  title={`Medium: ${Math.round(((solvedStats.mediumSolved || 0) / solvedStats.totalSolved) * 100)}%`}
                />
                <div 
                  className="bg-rose-500 h-full" 
                  style={{ width: `${((solvedStats.hardSolved || 0) / solvedStats.totalSolved) * 100}%` }} 
                  title={`Hard: ${Math.round(((solvedStats.hardSolved || 0) / solvedStats.totalSolved) * 100)}%`}
                />
              </>
            ) : (
              <div className="bg-slate-200 dark:bg-slate-800 h-full w-full" />
            )}
          </div>
        </div>

        {/* Section 3: Contest Performance details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-5 h-64 flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Contest Performance</h4>
              <div className="grid grid-cols-3 gap-2 text-center py-2 bg-slate-50/40 dark:bg-slate-950/20 rounded-xl mb-4">
                <div>
                  <span className="text-[9px] text-slate-400 block font-semibold">Attended</span>
                  <span className="text-xs font-bold text-slate-700 dark:text-white">{profile.contests || 0}</span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 block font-semibold">Best Rank</span>
                  <span className="text-xs font-bold text-slate-700 dark:text-white">{bestContestRank}</span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 block font-semibold">Peak Rating</span>
                  <span className="text-xs font-bold text-slate-700 dark:text-white">{profile.maxRating || profile.rating || 1500}</span>
                </div>
              </div>
            </div>
            <div className="h-36">
              <RatingTrendChart data={ratingHistory} color={config.themeColor} />
            </div>
          </div>

          {/* Section 4: Activity overview (active days & heatmap) */}
          <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-5 h-64 flex flex-col justify-between">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Activity Overview</h4>
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 font-bold bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full">
                <Flame className="h-3 w-3 animate-pulse" /> {activityStats.activeDays} Active Days
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-center py-2 bg-slate-50/40 dark:bg-slate-950/20 rounded-xl mb-4">
              <div>
                <span className="text-[9px] text-slate-400 block font-semibold">Total Submissions</span>
                <span className="text-xs font-bold text-slate-700 dark:text-white">
                  {activityStats.totalSubmissions}
                </span>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 block font-semibold">Streak</span>
                <span className="text-xs font-bold text-slate-700 dark:text-white">
                  {activityStats.streak > 0 ? `${activityStats.streak} days` : '0 days'}
                </span>
              </div>
            </div>
            <SubmissionHeatmap data={heatmap} />
          </div>
        </div>

        {/* Section 5 & 6: Language stats & Topic Distribution */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {langData.length > 0 && (
            <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-5 h-48">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Language Statistics</h4>
              <div className="h-32">
                <LanguageDoughnutChart data={langData} />
              </div>
            </div>
          )}

          {topicData.length > 0 && (
            <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-5 h-48">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Topic Distribution</h4>
              <div className="h-32">
                <TopicDistributionChart data={topicData} color={config.themeColor} />
              </div>
            </div>
          )}
        </div>

        {/* Section 7: Badges & Achievements */}
        {Array.isArray(profile.badges) && profile.badges.length > 0 ? (
          <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-5">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
              Earned Achievements ({profile.badges.length})
            </h4>
            <div className="flex flex-wrap gap-2.5">
              {profile.badges.map((badge, idx) => (
                <div 
                  key={`${badge.name || 'badge'}_${idx}`} 
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-white dark:bg-slate-900 shadow-sm text-xs font-medium ${idx === 0 ? 'border-amber-500 ring-1 ring-amber-500/20 bg-amber-50/10 dark:bg-amber-950/10' : 'border-slate-150 dark:border-slate-800/80'}`}
                  title={badge.hoverText || badge.name}
                >
                  {badge.icon ? (
                    <img 
                      src={badge.icon} 
                      alt={badge.name} 
                      className="h-5 w-5 object-contain" 
                      onError={(e) => { e.target.style.display = 'none'; }} 
                    />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  )}
                  <span className="text-slate-700 dark:text-slate-300">
                    {badge.name}
                    {idx === 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-500 text-[8px] text-white uppercase font-bold tracking-wider">Recent</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-5 text-center text-slate-400 text-xs py-8">
            No achievements/badges earned yet on LeetCode.
          </div>
        )}

        {/* Section 8: Recent Activity Submissions */}
        {recentSubmissions.length > 0 && (
          <div className="rounded-xl border border-slate-100 dark:border-slate-800/80 p-5">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Recent Activity</h4>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {recentSubmissions.map((s, idx) => (
                <div 
                  key={`${s.title || 'sub'}_${s.timestamp || ''}_${idx}`} 
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/10 text-xs"
                >
                  <div className="space-y-1">
                    <span className="font-semibold text-slate-700 dark:text-slate-200 block truncate max-w-[200px] sm:max-w-md">
                      {s.title}
                    </span>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="font-semibold capitalize text-primary-500">{s.lang || 'Code'}</span>
                      <span>•</span>
                      <span>{new Date(s.timestamp * 1000).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                      {s.statusDisplay || 'Accepted'}
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
