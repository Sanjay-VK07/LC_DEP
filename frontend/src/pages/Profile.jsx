import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { 
  User, 
  Search,
  Calendar,
  Activity,
  CheckCircle,
  XCircle,
  Percent,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Filter,
  RefreshCw,
  Table,
  List,
  Award,
  Clock,
  Info,
  Sparkles,
  Target,
  TrendingUp,
  Star
} from 'lucide-react';
import { getLeetCodeProfileUrl } from '../utils/platformUrls';
import { logger } from '../utils/logger';
import { normalizeAttendanceStatus } from '../utils/attendance';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);



function Profile() {
  // Student selection states
  const [students, setStudents] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [academicBatchFilter, setAcademicBatchFilter] = useState('');
  const [selectedStudentInfo, setSelectedStudentInfo] = useState(null);

  // Dynamic filter states
  const [deptFilter, setDeptFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [availableDepts, setAvailableDepts] = useState([]);
  const [availableSections, setAvailableSections] = useState([]);
  const [availableBatches, setAvailableBatches] = useState([]);

  // Timeline records state
  const [dbHistory, setDbHistory] = useState([]);
  const [unifiedProfile, setUnifiedProfile] = useState(null);
  const [ratingHistory, setRatingHistory] = useState({});
  const [ratingChartPlatform, setRatingChartPlatform] = useState('leetcode');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  // Filters & View Mode
  const [viewMode, setViewMode] = useState('timeline'); // 'timeline' | 'table'
  const [contestTypeFilter, setContestTypeFilter] = useState('All'); // 'All' | 'Weekly' | 'Biweekly'
  const [statusFilter, setStatusFilter] = useState('All'); // 'All' | 'Present' | 'Absent'
  const [dateRangeStart, setDateRangeStart] = useState('');
  const [dateRangeEnd, setDateRangeEnd] = useState('');
  const [expandedContestId, setExpandedContestId] = useState(null);

  // Fetch all active students, departments, and batches on component mount
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [studentsRes, deptsRes, batchesRes] = await Promise.all([
          axios.get('/api/students?status=active'),
          axios.get('/api/departments?status=active'),
          axios.get('/api/students/batches')
        ]);
        if (studentsRes.data.success) {
          setStudents(studentsRes.data.data);
          if (studentsRes.data.data.length > 0) {
            setSelectedStudentId(studentsRes.data.data[0].id);
            setSelectedStudentInfo(studentsRes.data.data[0]);
          }
        }
        if (deptsRes.data.success) {
          setAvailableDepts(deptsRes.data.data);
        }
        if (batchesRes.data.success) {
          setAvailableBatches(batchesRes.data.data);
        }
      } catch (err) {
        console.error('Failed to load initial data:', err.message);
      }
    };
    fetchInitialData();
  }, []);

  // Fetch available sections dynamically when department or batch filter changes
  useEffect(() => {
    const fetchAvailableSections = async () => {
      try {
        const params = { status: 'active' };
        if (deptFilter) params.department = deptFilter;
        if (academicBatchFilter) params.academicBatch = academicBatchFilter;
        const res = await axios.get('/api/students/sections', { params });
        if (res.data.success) {
          const sections = res.data.data;
          setAvailableSections(sections);
          if (sectionFilter && !sections.includes(sectionFilter)) {
            setSectionFilter('');
          }
        }
      } catch (err) {
        console.error('Failed to fetch sections:', err);
      }
    };
    fetchAvailableSections();
  }, [deptFilter, academicBatchFilter]);

  const fetchUnifiedProfileData = async (targetId) => {
    if (!targetId) { setUnifiedProfile(null); return; }
    try {
      const res = await axios.get(`/api/students/${targetId}/unified-profile`);
      if (res.data.success) {
        logger.debug('Received unified student profile data:', res.data.data);
        setUnifiedProfile(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch unified student profile:', err.message);
    }
  };

  const fetchRatingHistory = async (targetId) => {
    if (!targetId) { setRatingHistory({}); return; }
    try {
      const res = await axios.get(`/api/analytics/student/${targetId}/rating-history`);
      if (res.data.success) setRatingHistory(res.data.ratingHistory || {});
    } catch (err) {
      console.error('Failed to fetch rating history:', err.message);
    }
  };

  // Fetch student timeline data
  const fetchStudentTimelineData = async (targetId, forceRefresh = false) => {
    if (!targetId) return;
    setLoading(true);
    if (forceRefresh) setSyncing(true);
    setError('');
    try {
      const url = `/api/attendance/student/${targetId}${forceRefresh ? '?refresh=true' : ''}`;
      const res = await axios.get(url);
      if (res.data.success) {
        logger.debug('Received student timeline data:', res.data.data);
        setDbHistory(res.data.data || []);
      } else {
        setError('No contest participation records found.');
      }
    } catch (err) {
      setError('No contest participation records found.');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (selectedStudentId) {
      fetchStudentTimelineData(selectedStudentId);
      fetchUnifiedProfileData(selectedStudentId);
      fetchRatingHistory(selectedStudentId);
      const studentInfo = students.find(s => s.id === parseInt(selectedStudentId));
      if (studentInfo) setSelectedStudentInfo(studentInfo);
    } else {
      setSelectedStudentInfo(null);
      setDbHistory([]);
      setUnifiedProfile(null);
      setRatingHistory({});
    }
  }, [selectedStudentId, students]);

  // Filter students selection list by search keyword, batch, department, and section
  const filteredStudents = students.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(studentSearch.toLowerCase()) || 
                          (s.roll_no && s.roll_no.includes(studentSearch)) ||
                          (s.leetcode_username && s.leetcode_username.toLowerCase().includes(studentSearch.toLowerCase()));
    const matchesBatch = academicBatchFilter ? s.academic_batch === academicBatchFilter : true;
    const matchesDept = deptFilter ? s.department === deptFilter : true;
    const matchesSec = sectionFilter ? s.section === sectionFilter : true;
    return matchesSearch && matchesBatch && matchesDept && matchesSec;
  });

  // Automatically select the first student in the filtered student list when filters change
  useEffect(() => {
    if (filteredStudents.length > 0) {
      const matchesCurrent = filteredStudents.some(s => s.id === parseInt(selectedStudentId));
      if (!matchesCurrent) {
        setSelectedStudentId(filteredStudents[0].id);
      }
    } else {
      setSelectedStudentId('');
    }
  }, [academicBatchFilter, deptFilter, sectionFilter, studentSearch, students]);

  // Filter dbHistory to ONLY include contests within the student's academic period
  const eligibleContests = dbHistory.filter(h => h.eligibility_status === 'Eligible');

  // Filter contests by type, status, and date range
  const filteredContests = eligibleContests.filter(c => {
    // 1. Contest Type Filter
    let matchesType = true;
    if (contestTypeFilter === 'Weekly') {
      matchesType = c.contest_name.toLowerCase().includes('weekly') && !c.contest_name.toLowerCase().includes('biweekly');
    } else if (contestTypeFilter === 'Biweekly') {
      matchesType = c.contest_name.toLowerCase().includes('biweekly');
    }

    // 2. Attendance Status Filter
    let matchesStatus = true;
    const isPresent = normalizeAttendanceStatus(c.attendance_status) === 'PRESENT';
    if (statusFilter === 'Present') {
      matchesStatus = isPresent;
    } else if (statusFilter === 'Absent') {
      matchesStatus = !isPresent;
    }

    // 3. Date Range Filter
    let matchesDate = true;
    const cDate = new Date(c.contest_date);
    if (dateRangeStart) {
      matchesDate = matchesDate && cDate >= new Date(dateRangeStart);
    }
    if (dateRangeEnd) {
      matchesDate = matchesDate && cDate <= new Date(dateRangeEnd);
    }

    return matchesType && matchesStatus && matchesDate;
  });

  // Calculate timeline statistics based on filtered contests
  const totalContestsCount = filteredContests.length;
  const attendedCount = filteredContests.filter(c => normalizeAttendanceStatus(c.attendance_status) === 'PRESENT').length;
  const missedCount = totalContestsCount - attendedCount;
  const attendanceRate = totalContestsCount > 0 ? parseFloat(((attendedCount / totalContestsCount) * 100).toFixed(1)) : 100.0;

  const platformOrder = ['leetcode', 'codechef', 'codeforces', 'hackerrank'];
  const platformLabels = {
    leetcode: 'LeetCode',
    codechef: 'CodeChef',
    codeforces: 'Codeforces',
    hackerrank: 'HackerRank'
  };

  // Manual trigger to force reload student's history
  const handleSyncLeetCode = () => {
    if (selectedStudentId) {
      fetchStudentTimelineData(selectedStudentId, true);
      fetchUnifiedProfileData(selectedStudentId);
      fetchRatingHistory(selectedStudentId);
    }
  };

  // Build rating chart data for the selected platform
  const buildRatingChartData = (platform) => {
    const history = ratingHistory[platform] || [];
    if (!history.length) return null;
    const colors = {
      leetcode: { border: '#4f73ff', bg: 'rgba(79,115,255,0.1)' },
      codechef: { border: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
      codeforces: { border: '#ef4444', bg: 'rgba(239,68,68,0.1)' }
    };
    const c = colors[platform] || colors.leetcode;
    return {
      labels: history.map(h => {
        const d = new Date(h.contest_date || h.date);
        return isNaN(d) ? (h.contest_name || '') : d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      }),
      datasets: [{
        fill: true,
        label: `${platform.charAt(0).toUpperCase() + platform.slice(1)} Rating`,
        data: history.map(h => Number(h.new_rating || h.rating || 0)),
        borderColor: c.border,
        backgroundColor: c.bg,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: history.length > 30 ? 0 : 3,
        pointBackgroundColor: c.border
      }]
    };
  };

  const ratingChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => `Rating: ${ctx.parsed.y}`,
          title: ([ctx]) => ctx.label
        }
      }
    },
    scales: {
      y: { beginAtZero: false, grid: { color: 'rgba(200,200,200,0.1)' } },
      x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } }
    }
  };

  const platformChartColors = {
    leetcode: 'text-primary-500',
    codechef: 'text-amber-500',
    codeforces: 'text-rose-500'
  };


  return (
    <div className="space-y-6">
      {/* Title block with Refresh cache triggers */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Contest Participation Timeline</h1>
          <p className="text-sm text-slate-400">View and audit student contest attendance across the unified competitive programming platform stack.</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            disabled={syncing || !selectedStudentId}
            onClick={handleSyncLeetCode}
            className="flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 active:scale-95 text-white font-bold text-xs px-4 py-2.5 shadow-md shadow-primary-500/10 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing Platform Data...' : 'Sync Platform Data'}
          </button>
        </div>
      </div>

      {selectedStudentInfo && (
        <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Selected Student</p>
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">{selectedStudentInfo.name}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {selectedStudentInfo.roll_no} • {selectedStudentInfo.department} • Section {selectedStudentInfo.section} • {selectedStudentInfo.academic_batch}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200/60 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/40 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Overall Score</p>
                <p className="text-lg font-extrabold text-slate-800 dark:text-white">{unifiedProfile?.overallScore ?? 0}</p>
              </div>
              <div className="rounded-xl border border-slate-200/60 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/40 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Problems Solved</p>
                <p className="text-lg font-extrabold text-slate-800 dark:text-white">{unifiedProfile?.totalProblemsSolved ?? 0}</p>
              </div>
              <div className="rounded-xl border border-slate-200/60 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/40 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Active Platforms</p>
                <p className="text-lg font-extrabold text-slate-800 dark:text-white">{Object.values(unifiedProfile?.profiles || {}).filter((p) => p?.verified).length}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {platformOrder.map((platform) => {
              const profile = unifiedProfile?.profiles?.[platform];
              const username = selectedStudentInfo?.[`${platform}_username`];
              const isVerified = profile?.verified;
              return (
                <div key={platform} className="rounded-xl border border-slate-200/60 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{platformLabels[platform]}</p>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[100px]">{username || 'Not linked'}</p>
                    </div>
                    {isVerified ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">Verified</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">Pending</span>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <div>
                      <p className="font-semibold text-[10px] uppercase tracking-wide">Rating</p>
                      <p className="font-bold text-slate-700 dark:text-slate-200">{profile?.rating ?? (profile?.currentRating ?? '—')}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[10px] uppercase tracking-wide">Highest</p>
                      <p className="font-bold text-slate-700 dark:text-slate-200">{profile?.maxRating ?? (profile?.highestRating ?? '—')}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[10px] uppercase tracking-wide">Solved</p>
                      <p className="font-bold text-slate-700 dark:text-slate-200">{profile?.problemsSolved ?? 0}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[10px] uppercase tracking-wide">
                        {platform === 'codechef' ? 'Stars' : platform === 'codeforces' ? 'Rank' : 'Global Rank'}
                      </p>
                      <p className="font-bold text-slate-700 dark:text-slate-200">
                        {platform === 'codechef'
                          ? (profile?.stars ? `${'⭐'.repeat(Math.min(profile.stars, 7))} (${profile.stars}★)` : '—')
                          : platform === 'codeforces'
                          ? (profile?.rank || profile?.cfRank || '—')
                          : (profile?.globalRanking ? `#${Number(profile.globalRanking).toLocaleString()}` : '—')
                        }
                      </p>
                    </div>
                    {platform !== 'hackerrank' && (
                      <div className="col-span-2">
                        <p className="font-semibold text-[10px] uppercase tracking-wide">Contests</p>
                        <p className="font-bold text-slate-700 dark:text-slate-200">
                          {(ratingHistory[platform] || []).length > 0
                            ? `${(ratingHistory[platform] || []).length} participated`
                            : (profile?.totalContests ?? '—')}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Rating History Chart */}
          {(ratingHistory.leetcode?.length > 0 || ratingHistory.codechef?.length > 0 || ratingHistory.codeforces?.length > 0) && (
            <div className="rounded-xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary-500" />
                  <h4 className="font-bold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-wider">Rating History</h4>
                </div>
                <div className="flex gap-1">
                  {['leetcode','codechef','codeforces'].filter(p => (ratingHistory[p] || []).length > 0).map(p => (
                    <button
                      key={p}
                      onClick={() => setRatingChartPlatform(p)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all ${
                        ratingChartPlatform === p
                          ? p === 'leetcode' ? 'bg-primary-500 text-white' : p === 'codechef' ? 'bg-amber-500 text-white' : 'bg-rose-500 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                      }`}
                    >
                      {p === 'leetcode' ? 'LC' : p === 'codechef' ? 'CC' : 'CF'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-48">
                {buildRatingChartData(ratingChartPlatform) ? (
                  <Line data={buildRatingChartData(ratingChartPlatform)} options={ratingChartOptions} />
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                    No rating history available for {ratingChartPlatform}.
                  </div>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-2 text-center">
                {(ratingHistory[ratingChartPlatform] || []).length} contest{(ratingHistory[ratingChartPlatform] || []).length !== 1 ? 's' : ''} tracked
              </p>
            </div>
          )}
        </div>
      )}

      {/* Select & Filter Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side: Visual Timeline/Table & Filter Options (Takes 2/3 width) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Enhanced Control Toolbar */}
          <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              
              {/* View Switcher */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block mr-1">View:</span>
                <div className="bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-xl flex gap-0.5">
                  <button
                    onClick={() => setViewMode('timeline')}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      viewMode === 'timeline'
                        ? 'bg-white dark:bg-slate-900 text-primary-600 dark:text-primary-400 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                    }`}
                  >
                    <List className="h-3.5 w-3.5" /> Timeline
                  </button>
                  <button
                    onClick={() => setViewMode('table')}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      viewMode === 'table'
                        ? 'bg-white dark:bg-slate-900 text-primary-600 dark:text-primary-400 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                    }`}
                  >
                    <Table className="h-3.5 w-3.5" /> Table
                  </button>
                </div>
              </div>

              {/* Status and Type Selectors */}
              <div className="flex flex-wrap items-center gap-3">
                
                {/* Type Filter */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Type:</span>
                  <select
                    value={contestTypeFilter}
                    onChange={(e) => setContestTypeFilter(e.target.value)}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold outline-none focus:border-primary-500 text-slate-700 dark:text-slate-250 shadow-sm"
                  >
                    <option value="All">All Types</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Biweekly">Biweekly</option>
                  </select>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Status:</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold outline-none focus:border-primary-500 text-slate-700 dark:text-slate-250 shadow-sm"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Present">Present Only</option>
                    <option value="Absent">Absent Only</option>
                  </select>
                </div>

              </div>
            </div>

            {/* Date Range Selection */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block mr-1">Date Range:</span>
              <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                <input
                  type="date"
                  value={dateRangeStart}
                  onChange={(e) => setDateRangeStart(e.target.value)}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs font-semibold outline-none focus:border-primary-500 text-slate-700 dark:text-slate-200 shadow-sm"
                />
                <span className="text-slate-400 text-xs font-medium">to</span>
                <input
                  type="date"
                  value={dateRangeEnd}
                  onChange={(e) => setDateRangeEnd(e.target.value)}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-955 px-3 py-1.5 text-xs font-semibold outline-none focus:border-primary-500 text-slate-700 dark:text-slate-200 shadow-sm"
                />
                {(dateRangeStart || dateRangeEnd) && (
                  <button
                    onClick={() => {
                      setDateRangeStart('');
                      setDateRangeEnd('');
                    }}
                    className="text-xs text-rose-500 hover:text-rose-600 font-bold ml-2 transition-colors active:scale-95"
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Loader, Empty, or Content views */}
          {loading && !syncing ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
            </div>
          ) : error || filteredContests.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-16 text-center bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 rounded-2xl shadow-sm space-y-3">
              <ClipboardList className="h-12 w-12 text-slate-355 dark:text-slate-600 animate-pulse" />
              <h4 className="text-sm font-bold text-slate-700 dark:text-slate-350">
                {error || 'No contest attendance records found'}
              </h4>
              <p className="text-xs text-slate-400 max-w-[320px] leading-relaxed">
                There are no contest records matching your filters within the selected academic period.
              </p>
            </div>
          ) : viewMode === 'timeline' ? (
            /* Timeline View */
            <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-4 pl-6 space-y-5">
              {filteredContests.map((c) => {
                const isPresent = normalizeAttendanceStatus(c.attendance_status) === 'PRESENT';
                const isExpanded = expandedContestId === c.contest_id;
                
                return (
                  <div key={c.contest_id} className="relative">
                    {/* Visual dot on vertical timeline */}
                    <span className={`absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full border-2 bg-white dark:bg-slate-900 transition-all ${
                      isPresent
                        ? 'border-emerald-500 text-emerald-500 shadow-sm shadow-emerald-500/10'
                        : 'border-rose-500 text-rose-500 shadow-sm shadow-rose-500/10'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${isPresent ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                    </span>

                    {/* Timeline card container */}
                    <div className="rounded-xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-4 shadow-sm hover:border-slate-300 dark:hover:border-slate-750 transition-all">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                            {c.contest_name}
                          </h4>
                          <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5 font-medium">
                            <Calendar className="h-3.5 w-3.5 text-primary-500" /> 
                            Date: {new Date(c.contest_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            <span className="text-slate-305 dark:text-slate-700">•</span>
                            <span className={`font-bold ${c.contest_type === 'Biweekly' ? 'text-purple-500' : 'text-blue-500'}`}>{c.contest_type}</span>
                          </p>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 font-bold text-[10px] uppercase border ${
                            isPresent
                              ? 'bg-emerald-50 border-emerald-200/20 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30'
                              : 'bg-rose-50 border-rose-200/20 text-rose-600 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/30'
                          }`}>
                            Status: {isPresent ? 'Present ✅' : 'Absent ❌'}
                          </span>

                          <button
                            onClick={() => setExpandedContestId(isExpanded ? null : c.contest_id)}
                            className="p-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                          >
                            {isExpanded ? <ChevronDown className="h-4.5 w-4.5 text-primary-500" /> : <ChevronRight className="h-4.5 w-4.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Collapsible Details */}
                      {isExpanded && (
                        <div className="mt-3.5 border-t border-slate-100 dark:border-slate-800 pt-3.5 text-xs grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fade-in">
                          {/* LeetCode stats */}
                          {isPresent && c.global_rank ? (
                            <div className="col-span-1 sm:col-span-2 bg-gradient-to-r from-primary-50/40 to-indigo-50/40 dark:from-slate-850/40 dark:to-slate-800/10 rounded-xl p-3 border border-slate-100/60 dark:border-slate-800 space-y-2">
                              <span className="text-[10px] font-extrabold text-primary-600 dark:text-primary-400 uppercase tracking-widest block">{(c.platform || 'LeetCode')} Performance Stats</span>
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <span className="text-slate-450 block text-[9px] uppercase font-bold">Global Rank</span>
                                  <span className="font-extrabold text-sm text-slate-755 dark:text-slate-200">{c.global_rank}</span>
                                </div>
                                <div>
                                  <span className="text-slate-455 block text-[9px] uppercase font-bold">Problems Solved</span>
                                  <span className="font-extrabold text-sm text-slate-755 dark:text-slate-200">{c.problems_solved} / {c.total_problems}</span>
                                </div>
                                <div>
                                  <span className="text-slate-455 block text-[9px] uppercase font-bold">Contest Rating</span>
                                  <span className="font-extrabold text-sm text-slate-755 dark:text-slate-200">
                                    {c.rating} {c.rating_change !== 0 && (
                                      <span className={`text-[10px] font-bold ${c.rating_change > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        ({c.rating_change > 0 ? '+' : ''}{c.rating_change})
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {/* Audit logs */}
                          <div className="bg-slate-50/40 dark:bg-slate-800/20 rounded-xl p-3 border border-slate-100 dark:border-slate-850 space-y-1.5">
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Audit Log</span>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Marked By:</span>
                              <span className="font-semibold text-slate-750 dark:text-slate-250 capitalize">{c.marked_by}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Source Method:</span>
                              <span className="font-semibold text-slate-750 dark:text-slate-250 capitalize">{c.attendance_source || 'AUTO'}</span>
                            </div>
                            {c.last_updated && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">Last Synced:</span>
                                <span className="font-semibold text-slate-750 dark:text-slate-250">{new Date(c.last_updated).toLocaleString('en-GB')}</span>
                              </div>
                            )}
                          </div>

                          <div className="bg-slate-50/40 dark:bg-slate-800/20 rounded-xl p-3 border border-slate-100 dark:border-slate-850 space-y-1.5">
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Academic Batch Context</span>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Eligible Batch:</span>
                              <span className="font-semibold text-slate-750 dark:text-slate-250">{selectedStudentInfo?.academic_batch}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-450">Academic Status:</span>
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">Eligible</span>
                            </div>
                          </div>

                          {c.remarks && (
                            <div className="col-span-1 sm:col-span-2 bg-amber-50/30 border border-amber-100 dark:bg-amber-950/10 dark:border-amber-900/30 rounded-xl p-2.5 text-[11px] text-amber-800 dark:text-amber-450">
                              <span className="font-bold uppercase tracking-wider text-[9px] block mb-0.5">Faculty override remarks:</span>
                              "{c.remarks}"
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Table View */
            <div className="overflow-x-auto rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-sm">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850/60 text-slate-450 uppercase tracking-widest text-[9px] font-extrabold select-none">
                    <th className="p-4">Contest Name</th>
                    <th className="p-4">Contest Date</th>
                    <th className="p-4">Contest Type</th>
                    <th className="p-4">Academic Batch</th>
                    <th className="p-4 text-center">Attendance Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContests.map((c) => {
                    const isPresent = normalizeAttendanceStatus(c.attendance_status) === 'PRESENT';
                    return (
                      <tr key={c.contest_id} className="border-b border-slate-100 dark:border-slate-850 hover:bg-slate-50/30 dark:hover:bg-slate-850/20 transition-all">
                        <td className="p-4 font-bold text-slate-800 dark:text-slate-200">
                          <div className="flex flex-col">
                            <span>{c.contest_name}</span>
                            {isPresent && c.global_rank && (
                              <span className="text-[10px] text-slate-400 font-normal mt-0.5 flex items-center gap-1.5 select-none">
                                <Award className="h-3 w-3 text-amber-500" /> Rank: {c.global_rank} | Solved: {c.problems_solved}/{c.total_problems} | Rating: {c.rating}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-slate-500 dark:text-slate-400 font-medium">
                          {new Date(c.contest_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] uppercase border ${
                            c.contest_type === 'Biweekly'
                              ? 'bg-purple-50 text-purple-650 border-purple-200/20 dark:bg-purple-950/20 dark:text-purple-400'
                              : 'bg-blue-50 text-blue-650 border-blue-200/20 dark:bg-blue-950/20 dark:text-blue-400'
                          }`}>
                            {c.contest_type}
                          </span>
                        </td>
                        <td className="p-4 text-slate-500 dark:text-slate-400 font-semibold">
                          {selectedStudentInfo?.academic_batch || '—'}
                        </td>
                        <td className="p-4 text-center">
                          <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-bold text-[10px] uppercase border ${
                            isPresent
                              ? 'bg-emerald-50 border-emerald-200/20 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30'
                              : 'bg-rose-50 border-rose-200/20 text-rose-605 dark:bg-rose-955/20 dark:text-rose-400 dark:border-rose-900/30'
                          }`}>
                            {isPresent ? 'Present ✅' : 'Absent ❌'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Side: Student selection & Statistics widgets (Takes 1/3 width) */}
        <div className="space-y-6">
          
          {/* Selector Card */}
          <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
            <h3 className="font-bold text-xs text-slate-800 dark:text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
              <User className="h-4.5 w-4.5 text-primary-500" /> Student Profile Directory
            </h3>

            {/* Department Filter Dropdown */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Department</label>
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold outline-none focus:border-primary-500 dark:text-slate-200 shadow-sm"
              >
                <option value="">All Departments</option>
                {availableDepts.map(d => (
                  <option key={d.id} value={d.code}>{d.code}</option>
                ))}
              </select>
            </div>

            {/* Batch Filter Dropdown */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Academic Batch</label>
              <select
                value={academicBatchFilter}
                onChange={(e) => setAcademicBatchFilter(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold outline-none focus:border-primary-500 dark:text-slate-200 shadow-sm"
              >
                <option value="">All Batches</option>
                {availableBatches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* Section Filter Dropdown */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Section</label>
              <select
                value={sectionFilter}
                onChange={(e) => setSectionFilter(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold outline-none focus:border-primary-500 dark:text-slate-200 shadow-sm"
              >
                <option value="">All Sections</option>
                {availableSections.map(sec => (
                  <option key={sec} value={sec}>Section {sec}</option>
                ))}
              </select>
            </div>

            {/* Student Search */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Student Search</label>
              <div className="relative">
                <Search className="absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Search by name/roll/leetcode..."
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 py-2.5 pl-8 pr-3 text-xs outline-none focus:border-primary-500 dark:text-white"
                />
              </div>
            </div>

            {/* Select student */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Student Name</label>
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-xs outline-none focus:border-primary-500 dark:text-slate-200 shadow-sm"
              >
                {filteredStudents.length === 0 ? (
                  <option value="">No matching students found...</option>
                ) : (
                  filteredStudents.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.roll_no})</option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Student Info Card */}
          {selectedStudentInfo && (
            <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-gradient-to-r from-primary-600 to-indigo-700 p-5 text-white shadow-md shadow-primary-500/10 space-y-4 animate-fade-in">
              <div>
                <h4 className="text-[10px] text-white/60 uppercase tracking-wider font-bold">Inspect Student Profile</h4>
                <h2 className="text-base font-extrabold tracking-tight mt-1">{selectedStudentInfo.name}</h2>
                <p className="text-[11px] font-mono text-white/80 mt-0.5">{selectedStudentInfo.roll_no}</p>
              </div>

              <div className="border-t border-white/15 pt-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-white/60">Department:</span>
                  <span className="font-bold">{selectedStudentInfo.department}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Section:</span>
                  <span className="font-bold">Sec {selectedStudentInfo.section}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">LeetCode Profile:</span>
                  {selectedStudentInfo.leetcode_username ? (
                    <a 
                      href={getLeetCodeProfileUrl(selectedStudentInfo.leetcode_username)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-bold underline text-white hover:text-slate-200"
                    >
                      @{selectedStudentInfo.leetcode_username}
                    </a>
                  ) : (
                    <span className="font-bold text-white/60 italic">Not Registered</span>
                  )}
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Academic Year:</span>
                  <span className="font-bold">{selectedStudentInfo.academic_batch}</span>
                </div>
                <div className="flex flex-col gap-1 border-t border-white/15 pt-2.5 text-[10px] text-white/70 font-medium">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Academic Period:</span>
                  <span className="font-mono text-white text-[10px]">
                    {selectedStudentInfo.academic_start_date ? new Date(selectedStudentInfo.academic_start_date).toLocaleDateString('en-GB') : 'N/A'} — {selectedStudentInfo.academic_end_date ? new Date(selectedStudentInfo.academic_end_date).toLocaleDateString('en-GB') : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Timeline Statistics Card */}
          <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
            <h3 className="font-bold text-xs text-slate-800 dark:text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
              <Activity className="h-4.5 w-4.5 text-indigo-500" /> Timeline Metrics Summary
            </h3>

            <div className="grid grid-cols-2 gap-4">
              {/* Card 1: Total Contests */}
              <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Total Eligible</span>
                <span className="text-lg font-black text-slate-700 dark:text-slate-200 mt-1 block">{totalContestsCount}</span>
              </div>

              {/* Card 2: Attendance Rate */}
              <div className="bg-slate-50 dark:bg-slate-955 p-3 rounded-xl border border-slate-100 dark:border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Attendance Rate</span>
                <span className="text-lg font-black text-indigo-650 dark:text-indigo-400 mt-1 block">{attendanceRate}%</span>
              </div>

              {/* Card 3: Attended */}
              <div className="bg-slate-50 dark:bg-slate-955 p-3 rounded-xl border border-slate-100 dark:border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Attended</span>
                <span className="text-lg font-black text-emerald-600 mt-1 block">{attendedCount}</span>
              </div>

              {/* Card 4: Missed */}
              <div className="bg-slate-50 dark:bg-slate-955 p-3 rounded-xl border border-slate-100 dark:border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Missed</span>
                <span className="text-lg font-black text-rose-500 mt-1 block">{missedCount}</span>
              </div>
            </div>

            {/* Attendance Progress bar widget */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex justify-between text-[10px] font-bold text-slate-450 uppercase tracking-wider">
                <span>Overall Period Completion</span>
                <span>{attendanceRate}%</span>
              </div>
              <div className="w-full bg-slate-150 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-primary-500 to-indigo-500 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${attendanceRate}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Grid Participation Heatmap block */}
          <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
            <h3 className="font-bold text-xs text-slate-800 dark:text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
              <ClipboardList className="h-4.5 w-4.5 text-primary-500" /> Grid Heatmap Quick Matrix
            </h3>
            
            <div className="flex flex-wrap gap-2 pt-1 max-h-[160px] overflow-y-auto">
              {filteredContests.length === 0 ? (
                <div className="text-[11px] text-slate-455 italic">No historical contests in selection.</div>
              ) : (
                filteredContests.map(c => {
                  const isPresent = normalizeAttendanceStatus(c.attendance_status) === 'PRESENT';
                  const registered = c.is_registered;
                  
                  let colorClass = 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-650';
                  let titleText = `${c.contest_name}: Absent (Not Registered)`;
                  
                  if (isPresent) {
                    colorClass = 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/10';
                    titleText = `${c.contest_name}: Present (Attended)`;
                  } else if (registered) {
                    colorClass = 'bg-rose-500 text-white shadow-sm shadow-rose-500/10';
                    titleText = `${c.contest_name}: Absent (Registered / Missed)`;
                  } else {
                    colorClass = 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500';
                    titleText = `${c.contest_name}: Absent`;
                  }

                  return (
                    <div 
                      key={c.contest_id}
                      title={titleText}
                      className={`h-7 w-7 rounded-lg flex items-center justify-center text-[9px] font-black cursor-help transition-all hover:scale-110 select-none ${colorClass}`}
                    >
                      {c.contest_name.match(/contest-(\d+)/)?.[1] || 'C'}
                    </div>
                  );
                })
              )}
            </div>
            
            <div className="flex items-center gap-3.5 text-[9px] text-slate-400 font-bold uppercase tracking-wider pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded bg-emerald-500"></span> Present
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded bg-rose-500"></span> Absent (Reg)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded bg-slate-200 dark:bg-slate-800"></span> Absent (Unreg)
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

export default Profile;
