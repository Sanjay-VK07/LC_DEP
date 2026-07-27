import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api';
import { 
  Flame, 
  Calendar, 
  Trophy, 
  ArrowUpRight
} from 'lucide-react';

function Analytics() {
  const [loading, setLoading] = useState(true);
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [error, setError] = useState('');

  // Filters state
  const [filterDept, setFilterDept] = useState('');
  const [filterSec, setFilterSec] = useState('');
  const [filterBatch, setFilterBatch] = useState('');
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState('overall');
  const [availableDepts, setAvailableDepts] = useState([]);
  const [availableSections, setAvailableSections] = useState([]);
  const [availableBatches, setAvailableBatches] = useState([]);

  // Fetch initial filters (departments & batches) on mount
  useEffect(() => {
    const fetchInitialFilters = async () => {
      try {
        const [deptsRes, batchesRes] = await Promise.all([
          axios.get(`${API_URL}/departments?status=active`),
          axios.get(`${API_URL}/students/batches`)
        ]);
        if (deptsRes.data.success) {
          setAvailableDepts(deptsRes.data.data);
        }
        if (batchesRes.data.success) {
          setAvailableBatches(batchesRes.data.data);
        }
      } catch (err) {
        console.error('Failed to load filters data in Analytics:', err);
      }
    };
    fetchInitialFilters();
  }, []);

  // Fetch available sections dynamically when department or batch filters change
  useEffect(() => {
    const fetchAvailableSections = async () => {
      try {
        const params = { status: 'active' };
        if (filterDept) params.department = filterDept;
        if (filterBatch) params.academicBatch = filterBatch;
        const res = await axios.get(`${API_URL}/students/sections`, { params });
        if (res.data.success) {
          const sections = res.data.data;
          setAvailableSections(sections);
          if (filterSec && !sections.includes(filterSec)) {
            setFilterSec('');
          }
        }
      } catch (err) {
        console.error('Failed to fetch sections:', err);
      }
    };
    fetchAvailableSections();
  }, [filterDept, filterBatch]);

  // Fetch analytics data when filters change
  useEffect(() => {
    const fetchAnalyticsData = async () => {
      setLoading(true);
      try {
        const lbParams = {};
        if (filterDept) lbParams.department = filterDept;
        if (filterSec) lbParams.section = filterSec;
        if (filterBatch) lbParams.academicBatch = filterBatch;

        const lbRes = await axios.get(`${API_URL}/analytics/leaderboards`, { params: lbParams });

        if (lbRes.data.success) {
          setLeaderboardData(lbRes.data);
          setError('');
        } else {
          setError('Failed to load analytical metrics.');
        }
      } catch (err) {
        setError('Error connecting to the server. Please ensure database is initialized.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalyticsData();
  }, [filterDept, filterSec, filterBatch]);

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
      </div>
    );
  }

  if (error || !leaderboardData) {
    return (
      <div className="rounded-2xl border border-rose-100 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-950/40 p-6 text-rose-600 dark:text-rose-400">
        <p className="font-semibold">Analytics system offline</p>
        <p className="text-sm mt-1">{error || 'Verify database credentials in backend/.env'}</p>
      </div>
    );
  }

  const { topPerformers, topImprovers, mostConsistent, coverageSummary } = leaderboardData;

  const filteredTopPerformers = [...(topPerformers || [])]
    .filter((student) => {
      const value = searchText.toLowerCase();
      return !value || [student.name, student.register_number, student.leetcode_username, student.codechef_username, student.codeforces_username, student.hackerrank_username]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(value));
    })
    .sort((a, b) => {
      if (sortBy === 'rating') return Number(b.current_rating || 0) - Number(a.current_rating || 0);
      if (sortBy === 'problems') return Number(b.problems_solved || 0) - Number(a.problems_solved || 0);
      if (sortBy === 'attendance') return Number(b.contests_attended || 0) - Number(a.contests_attended || 0);
      return Number(b.overall_score || 0) - Number(a.overall_score || 0);
    });

  const formatPlatformLabel = (platform) => {
    switch (platform) {
      case 'leetcode': return 'LeetCode';
      case 'codechef': return 'CodeChef';
      case 'codeforces': return 'Codeforces';
      case 'hackerrank': return 'HackerRank';
      default: return platform;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Performance Analytics & Leaderboard</h1>
        <p className="text-sm text-slate-400">In-depth statistical insights and performance charts.</p>
      </div>

      <div className="space-y-6">
          {/* Filters Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-4 shadow-sm">
            {/* Search */}
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by name or handle"
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-3 py-2.5 text-xs outline-none focus:border-primary-500 dark:text-slate-200"
            />

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-3 py-2.5 text-xs outline-none focus:border-primary-500 dark:text-slate-200"
            >
              <option value="overall">Sort by overall score</option>
              <option value="rating">Sort by current rating</option>
              <option value="problems">Sort by problems solved</option>
              <option value="attendance">Sort by contests attended</option>
            </select>

            {/* Dept filter */}
            <select
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-3 py-2.5 text-xs outline-none focus:border-primary-500 dark:text-slate-200"
            >
              <option value="">All Departments</option>
              {availableDepts.map(dept => (
                <option key={dept.id} value={dept.code}>{dept.code}</option>
              ))}
            </select>

            {/* Batch filter */}
            <select
              value={filterBatch}
              onChange={(e) => setFilterBatch(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-3 py-2.5 text-xs outline-none focus:border-primary-500 dark:text-slate-200"
            >
              <option value="">All Academic Batches</option>
              {availableBatches.map(batch => (
                <option key={batch} value={batch}>{batch}</option>
              ))}
            </select>

            {/* Section filter */}
            <select
              value={filterSec}
              onChange={(e) => setFilterSec(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-3 py-2.5 text-xs outline-none focus:border-primary-500 dark:text-slate-200"
            >
              <option value="">All Sections</option>
              {availableSections.map(sec => (
                <option key={sec} value={sec}>Section {sec}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-3 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-gradient-to-br from-primary-50/80 to-white dark:from-primary-950/30 dark:to-slate-900 p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">Unified competitive programming overview</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Students are ranked by contest performance while also showing their connected platforms.</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-primary-200 bg-white/80 px-3 py-1 font-semibold text-primary-700 dark:border-primary-900/50 dark:bg-slate-900/70 dark:text-primary-400">
                    {coverageSummary?.multiPlatformProfiles || 0} multi-platform profiles
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
                    Avg. {coverageSummary?.averagePlatformCount || '0.0'} platforms per student
                  </span>
                </div>
              </div>
            </div>

          {/* Top Performers Leaderboard */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <Trophy className="h-5 w-5 text-amber-500" />
              <div>
                <h3 className="font-bold text-slate-800 dark:text-white">Top Performers Leaderboard</h3>
                <p className="text-xs text-slate-400">Ranked by contest strength and platform coverage.</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-semibold">
                    <th className="py-2.5">Rank</th>
                    <th>Name / Roll</th>
                    <th>Department</th>
                    <th className="text-center">Attended</th>
                    <th className="text-right">Current Rating</th>
                    <th className="text-right">Best Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
                  {filteredTopPerformers.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="text-center py-8 text-slate-400">No participation records yet. Sync data to begin.</td>
                    </tr>
                  ) : (
                    filteredTopPerformers.map((p, idx) => (
                      <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                        <td className="py-3 font-extrabold text-slate-400">
                          {idx === 0 ? '🏆 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : idx + 1}
                        </td>
                        <td>
                          <span className="font-bold text-slate-800 dark:text-slate-200 block">{p.name}</span>
                          <span className="text-[10px] text-slate-400 uppercase tracking-wide">{p.register_number} • {p.leetcode_username || 'No LeetCode handle'}</span>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {p.platforms?.length ? p.platforms.map((platform) => (
                              <span key={`${p.id}-${platform.platform}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {formatPlatformLabel(platform.platform)}
                              </span>
                            )) : (
                              <span className="text-[10px] text-slate-400">LeetCode-only profile</span>
                            )}
                          </div>
                        </td>
                        <td className="text-slate-500">{p.department}</td>
                        <td className="text-center font-semibold text-slate-600 dark:text-slate-300">{p.contests_attended}</td>
                        <td className="text-right font-extrabold text-primary-600 dark:text-primary-400">{p.current_rating}</td>
                        <td className="text-right font-semibold text-slate-500">{p.best_rating}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-6">
            {/* Top Improvers */}
            <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <Flame className="h-5 w-5 text-rose-500 animate-pulse" />
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-white">Top Rating Improvers</h3>
                  <p className="text-xs text-slate-400">Highest net rating gains.</p>
                </div>
              </div>

              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {topImprovers.length === 0 ? (
                  <p className="text-center py-6 text-slate-400 text-xs">No rating gains recorded yet.</p>
                ) : (
                  topImprovers.map((item, idx) => (
                    <div key={item.id} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-xs">
                      <div>
                        <span className="font-semibold text-slate-700 dark:text-slate-300 block">{item.name}</span>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider">{item.department}</span>
                      </div>
                      <div className="text-right">
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-extrabold">
                          <ArrowUpRight className="h-3.5 w-3.5" /> +{item.rating_gain}
                        </span>
                        <span className="text-[10px] text-slate-400 block">{item.initial_rating} → {item.current_rating}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Most Consistent */}
            <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <Calendar className="h-5 w-5 text-indigo-500" />
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-white">Most Consistent</h3>
                  <p className="text-xs text-slate-400">Highest attendance rates.</p>
                </div>
              </div>

              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {mostConsistent.length === 0 ? (
                  <p className="text-center py-6 text-slate-400 text-xs">No consistency data yet.</p>
                ) : (
                  mostConsistent.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-xs">
                      <div>
                        <span className="font-semibold text-slate-700 dark:text-slate-300 block">{item.name}</span>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider">{item.register_number} • {item.department}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-extrabold text-indigo-600 dark:text-indigo-400 block">{item.attendance_percentage}%</span>
                        <span className="text-[10px] text-slate-400">{item.present_count} / {item.total_contests} Contests</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Analytics;
