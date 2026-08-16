import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api';
import { 
  Activity, 
  Users, 
  UserCheck,
  Clock, 
  Search, 
  ChevronRight, 
  X, 
  RefreshCw, 
  AlertTriangle,
  History
} from 'lucide-react';

export default function ContestActivity() {
  const [contests, setContests] = useState([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [activityData, setActivityData] = useState(null);
  const [loadingContests, setLoadingContests] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [error, setError] = useState(null);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('rank'); // 'name', 'rank', 'score', 'last_seen'
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc', 'desc'

  // Selected Student Modal / Drawer State
  const [selectedStudent, setSelectedStudent] = useState(null);

  // Fetch list of started contests on mount
  useEffect(() => {
    fetchContests();
  }, []);

  const fetchContests = async () => {
    setLoadingContests(true);
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/contest-activity`);
      if (res.data && res.data.success) {
        // Strict safety rule: Filter start_time <= Date.now()
        const now = new Date();
        const startedContests = (res.data.contests || []).filter(c => {
          if (!c.start_time) return true;
          return new Date(c.start_time) <= now;
        });

        setContests(startedContests);
        if (startedContests.length > 0) {
          // Default to weekly-contest-515 if available, else first contest
          const defaultContest = startedContests.find(c => c.slug === 'weekly-contest-515') || startedContests[0];
          setSelectedSlug(defaultContest.slug);
        }
      } else {
        throw new Error(res.data?.error || 'Failed to fetch contest activity list');
      }
    } catch (err) {
      console.error('[ContestActivity] Error fetching contests:', err.message);
      setError('Unable to load contest activity. Please try again.');
    } finally {
      setLoadingContests(false);
    }
  };

  // Fetch activity when selected slug changes
  useEffect(() => {
    if (!selectedSlug) return;
    fetchActivity(selectedSlug);
  }, [selectedSlug]);

  const fetchActivity = async (slug) => {
    setLoadingActivity(true);
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/contest-activity/${slug}`);
      if (res.data && res.data.success) {
        setActivityData(res.data);
      } else {
        throw new Error(res.data?.error || 'Failed to retrieve activity for selected contest');
      }
    } catch (err) {
      console.error('[ContestActivity] Error fetching activity details:', err.message);
      setError('Unable to load contest activity. Please try again.');
      setActivityData(null);
    } finally {
      setLoadingActivity(false);
    }
  };

  // Filter and sort student list
  const filteredAndSortedStudents = useMemo(() => {
    if (!activityData || !activityData.students) return [];

    let list = [...activityData.students];

    // Search filtering
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase().trim();
      list = list.filter(st => 
        (st.student_name || '').toLowerCase().includes(query) ||
        (st.leetcode_username || '').toLowerCase().includes(query) ||
        (st.roll_no || '').toLowerCase().includes(query) ||
        (st.department || '').toLowerCase().includes(query)
      );
    }

    // Sorting
    list.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === 'name') {
        valA = (a.student_name || '').toLowerCase();
        valB = (b.student_name || '').toLowerCase();
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }

      if (sortField === 'rank') {
        valA = Number(a.current_rank) || 999999;
        valB = Number(b.current_rank) || 999999;
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }

      if (sortField === 'score') {
        valA = Number(a.current_score) || 0;
        valB = Number(b.current_score) || 0;
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }

      if (sortField === 'last_seen') {
        valA = new Date(a.last_seen || 0).getTime();
        valB = new Date(b.last_seen || 0).getTime();
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }

      return 0;
    });

    return list;
  }, [activityData, searchTerm, sortField, sortOrder]);

  const handleSortToggle = (field) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return String(dateStr);
    }
  };

  const formatTimeOnly = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return String(dateStr);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header Banner */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">
            <Activity className="h-4 w-4" />
            <span>Contest Activity Tracker</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight mt-1">
            Observable Contest Activity
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Live telemetry & rank history observed from CLIST platform statistics.
          </p>
        </div>

        {/* Contest Selector Dropdown */}
        <div className="flex items-center gap-3">
          <div className="relative min-w-[240px]">
            <select
              value={selectedSlug}
              onChange={(e) => setSelectedSlug(e.target.value)}
              disabled={loadingContests || contests.length === 0}
              className="w-full appearance-none rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2.5 pr-10 text-sm font-semibold text-slate-800 dark:text-slate-200 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
            >
              {contests.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.title || c.slug}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
              <ChevronRight className="h-4 w-4 rotate-90" />
            </div>
          </div>

          <button
            onClick={() => selectedSlug && fetchActivity(selectedSlug)}
            disabled={loadingActivity || !selectedSlug}
            className="flex items-center justify-center h-10 w-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm transition-all disabled:opacity-50"
            title="Refresh Activity"
          >
            <RefreshCw className={`h-4 w-4 ${loadingActivity ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 p-4 flex items-center gap-3 text-rose-700 dark:text-rose-300">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {/* Loading Skeleton View */}
      {(loadingContests || (loadingActivity && !activityData)) ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
          <div className="h-96 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
        </div>
      ) : activityData ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Card 1: CLIST Observed Participants */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  CLIST Observed Participants
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                  <Users className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-3xl font-bold text-slate-900 dark:text-white">
                  {activityData.clistObservedParticipants ?? 0}
                </span>
                <p className="mt-1 text-xs text-slate-400">Total indexed participants on CLIST</p>
              </div>
            </div>

            {/* Card 2: College Matches */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  College Matches
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                  <UserCheck className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                  {activityData.matchedCount ?? 0}
                </span>
                <p className="mt-1 text-xs text-slate-400">Matched active college handles</p>
              </div>
            </div>

            {/* Card 3: Last Checked */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Last Checked
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                  <Clock className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-lg font-bold text-slate-900 dark:text-white block truncate">
                  {formatDate(activityData.lastChecked)}
                </span>
                <p className="mt-1 text-xs text-slate-400">Timestamp of latest observation</p>
              </div>
            </div>
          </div>

          {/* Student Activity Section Header */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Matched Student Activity Table
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Showing observable contest statistics for matched college handles.
                </p>
              </div>

              {/* Search Bar & Sort Dropdown */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                {/* Search Input */}
                <div className="relative flex-1 sm:w-64">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search name, username, roll..."
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 pl-10 pr-4 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                  />
                  {searchTerm && (
                    <button 
                      onClick={() => setSearchTerm('')} 
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Sort Toggle Controls */}
                <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
                  <button
                    onClick={() => handleSortToggle('rank')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      sortField === 'rank' 
                        ? 'bg-white dark:bg-slate-800 text-primary-600 dark:text-primary-400 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    Rank {sortField === 'rank' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </button>
                  <button
                    onClick={() => handleSortToggle('score')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      sortField === 'score' 
                        ? 'bg-white dark:bg-slate-800 text-primary-600 dark:text-primary-400 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    Score {sortField === 'score' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </button>
                  <button
                    onClick={() => handleSortToggle('name')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      sortField === 'name' 
                        ? 'bg-white dark:bg-slate-800 text-primary-600 dark:text-primary-400 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    Name {sortField === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </button>
                </div>
              </div>
            </div>

            {/* Table Content or Empty State */}
            {filteredAndSortedStudents.length === 0 ? (
              <div className="p-12 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400">
                  <Activity className="h-6 w-6" />
                </div>
                <h4 className="mt-4 text-base font-semibold text-slate-800 dark:text-slate-200">
                  No CLIST activity has been observed yet.
                </h4>
                <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
                  Either no student handles matched CLIST statistics for this contest, or polling has not collected activity snapshots yet.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">
                      <th className="py-3.5 px-5">Student</th>
                      <th className="py-3.5 px-5">LeetCode Username</th>
                      <th className="py-3.5 px-5 text-center">Current Rank</th>
                      <th className="py-3.5 px-5 text-center">Current Score</th>
                      <th className="py-3.5 px-5">First Seen</th>
                      <th className="py-3.5 px-5">Last Seen</th>
                      <th className="py-3.5 px-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {filteredAndSortedStudents.map((st) => (
                      <tr 
                        key={st.student_id} 
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors group cursor-pointer"
                        onClick={() => setSelectedStudent(st)}
                      >
                        <td className="py-4 px-5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-950/60 text-primary-600 dark:text-primary-400 font-bold text-xs">
                              {st.student_name ? st.student_name.charAt(0) : '?'}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white group-hover:text-primary-600 transition-colors">
                                {st.student_name}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {st.roll_no} • {st.department} {st.section ? `(${st.section})` : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-5">
                          <span className="font-mono text-slate-700 dark:text-slate-300 font-semibold bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">
                            {st.leetcode_username}
                          </span>
                        </td>
                        <td className="py-4 px-5 text-center font-bold text-slate-900 dark:text-white">
                          #{st.current_rank}
                        </td>
                        <td className="py-4 px-5 text-center">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                            {st.current_score} pts
                          </span>
                        </td>
                        <td className="py-4 px-5 text-slate-500 dark:text-slate-400 font-medium">
                          {formatTimeOnly(st.first_seen)}
                        </td>
                        <td className="py-4 px-5 text-slate-500 dark:text-slate-400 font-medium">
                          {formatTimeOnly(st.last_seen)}
                        </td>
                        <td className="py-4 px-5 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedStudent(st);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-primary-50 hover:text-primary-600 dark:hover:bg-primary-950 dark:hover:text-primary-400 transition-all"
                          >
                            <History className="h-3.5 w-3.5" />
                            <span>Timeline</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* Student Activity History Modal / Slide-over Drawer */}
      {selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/50 backdrop-blur-sm p-4 sm:p-6 transition-opacity">
          <div 
            className="w-full max-w-md h-full max-h-[90vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-100 dark:bg-primary-950/60 text-primary-600 dark:text-primary-400 font-bold">
                  {selectedStudent.student_name ? selectedStudent.student_name.charAt(0) : '?'}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    {selectedStudent.student_name}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">
                    @{selectedStudent.leetcode_username}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedStudent(null)}
                className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Student Metadata Card */}
            <div className="p-6 space-y-6 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 text-xs">
                <div>
                  <span className="text-slate-400 block font-medium">Roll Number</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{selectedStudent.roll_no || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Department</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{selectedStudent.department} {selectedStudent.section ? `(${selectedStudent.section})` : ''}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Current Rank</span>
                  <span className="font-bold text-primary-600 dark:text-primary-400">#{selectedStudent.current_rank}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Current Score</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{selectedStudent.current_score} pts</span>
                </div>
              </div>

              {/* Activity History Timeline */}
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-3">
                  <History className="h-4 w-4 text-primary-600" />
                  <span>Activity History Timeline</span>
                </div>

                {(!selectedStudent.history || selectedStudent.history.length === 0) ? (
                  <p className="text-xs text-slate-400 italic py-4">No historical observations recorded.</p>
                ) : (
                  <div className="relative border-l-2 border-slate-100 dark:border-slate-800 ml-3 space-y-4 pl-4 py-2">
                    {selectedStudent.history.map((h, idx) => (
                      <div key={h.id || idx} className="relative group">
                        {/* Timeline Bullet Dot */}
                        <div className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary-600 ring-4 ring-white dark:ring-slate-900" />
                        
                        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 text-xs">
                          <div>
                            <div className="font-bold text-slate-800 dark:text-slate-200">
                              Rank #{h.rank}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {formatTimeOnly(h.observedAt)}
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">
                              {h.score} pts
                            </span>
                            <span className="block text-[9px] text-slate-400 font-mono mt-0.5 uppercase">
                              {h.provider || 'CLIST'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-center text-[10px] text-slate-400">
              Observable activity snapshot timeline • Provider: CLIST
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
