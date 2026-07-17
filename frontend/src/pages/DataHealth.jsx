import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheck,
  Search,
  Filter,
  RotateCw,
  Download,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Activity,
  Database,
  RefreshCw,
  Link,
  BarChart3,
  FileSpreadsheet
} from 'lucide-react';

function DataHealth() {
  const { user } = useAuth();

  // Tab state
  const [activeTab, setActiveTab] = useState('health'); // 'health' | 'platform-stats' | 'attendance-matrix'

  // Health tab state
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Hardening controls state
  const [globalSyncing, setGlobalSyncing] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [syncingPlatforms, setSyncingPlatforms] = useState({}); // studentId:platform -> boolean
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState('success');

  // Filters
  const [searchText, setSearchText] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterBatch, setFilterBatch] = useState('');
  const [filterHealth, setFilterHealth] = useState('');
  const [depts, setDepts] = useState([]);
  const [batches, setBatches] = useState([]);

  // Expanded rows state (student ID -> boolean)
  const [expandedStudents, setExpandedStudents] = useState({});

  // Platform Stats state
  const [platformStats, setPlatformStats] = useState([]);
  const [platformStatsLoading, setPlatformStatsLoading] = useState(false);

  // Attendance Matrix state
  const [matrix, setMatrix] = useState(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixContestType, setMatrixContestType] = useState('');

  const showToast = (msg, type = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const handleForceFullSync = async () => {
    setGlobalSyncing(true);
    try {
      const res = await axios.post('/api/students/sync-all');
      if (res.data.success) {
        showToast('Platform-wide synchronization started in background.');
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to start full sync.', 'error');
    } finally {
      setGlobalSyncing(false);
    }
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      const res = await axios.post('/api/students/clear-cache');
      if (res.data.success) {
        showToast('Analytics and placement cache successfully invalidated.');
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to invalidate cache.', 'error');
    } finally {
      setClearingCache(false);
    }
  };

  const handleRetryPlatformSync = async (studentId, platform) => {
    const key = `${studentId}:${platform}`;
    setSyncingPlatforms(prev => ({ ...prev, [key]: true }));
    try {
      const res = await axios.post(`/api/students/${studentId}/sync/${platform}`);
      if (res.data.success) {
        showToast(`Successfully synchronized ${platform} handle!`);
        await fetchHealthAudit();
      }
    } catch (err) {
      showToast(err.response?.data?.message || `Failed to sync ${platform} handle.`, 'error');
    } finally {
      setSyncingPlatforms(prev => ({ ...prev, [key]: false }));
    }
  };

  const fetchPlatformStats = async () => {
    setPlatformStatsLoading(true);
    try {
      const res = await axios.get('/api/analytics/platform-stats');
      if (res.data.success) setPlatformStats(res.data.data);
    } catch (err) { console.error(err); }
    finally { setPlatformStatsLoading(false); }
  };

  const fetchAttendanceMatrix = async () => {
    setMatrixLoading(true);
    try {
      const params = {};
      if (matrixContestType) params.contestType = matrixContestType;
      const res = await axios.get('/api/analytics/attendance-matrix', { params });
      if (res.data.success) setMatrix(res.data);
    } catch (err) { console.error(err); }
    finally { setMatrixLoading(false); }
  };

  const fetchHealthAudit = async (forceRefresh = false) => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (forceRefresh) params.refresh = 'true';
      const res = await axios.get('/api/students/data-health', { params });
      if (res.data.success) {
        setData(res.data);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to retrieve database health audit data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'platform-stats') { fetchPlatformStats(); return; }
    if (activeTab === 'attendance-matrix') { fetchAttendanceMatrix(); return; }
    axios.get('/api/departments').then(res => { if (res.data.success) setDepts(res.data.data); }).catch(console.error);
    axios.get('/api/students/batches').then(res => { if (res.data.success) setBatches(res.data.data); }).catch(console.error);
    fetchHealthAudit();
  }, [activeTab]);

  const handleExportMatrix = () => {
    if (!matrix?.matrix?.length) return;
    const headers = ['Roll No', 'Name', 'Department', 'Section', 'Batch', 'LeetCode Username',
      ...matrix.contests.map(c => {
        const d = new Date(c.date);
        return c.title + ' (' + d.toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'2-digit'}) + ')';
      })
    ];
    const rows = matrix.matrix.map(s => [
      s.rollNo, s.name, s.department, s.section||'', s.batch, s.leetcodeUsername,
      ...matrix.contests.map(c => s.attendance[c.id]||'N/A')
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    XLSX.writeFile(wb, 'attendance_matrix_' + new Date().toISOString().split('T')[0] + '.xlsx');
  };

  const handleExportPlatformStats = () => {
    if (!platformStats?.length) return;
    const rows = buildPlatformStatsRows(platformStats);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Platform Stats');
    XLSX.writeFile(wb, 'platform_stats_' + new Date().toISOString().split('T')[0] + '.xlsx');
  };

  const [exportingSpreadsheet, setExportingSpreadsheet] = useState(false);

  const buildPlatformStatsRows = (stats) => stats.map(s => ({
    'Name': s.name,
    'Student Roll No': s.rollNo,

    'LC Account': s.leetcode.username || '',
    'LC Rating': s.leetcode.rating || '',
    'LC Biweekly': s.leetcode.biweeklyThisMonth,
    'LC Weekly': s.leetcode.weeklyThisMonth,
    'LC Monthly': s.leetcode.weeklyThisMonth + s.leetcode.biweeklyThisMonth,
    'LC Total Solved': s.leetcode.totalSolved,

    'CC Account': s.codechef.username || '',
    'CC Rating': s.codechef.rating || '',
    'CC Total Solved': s.codechef.totalSolved,

    'CF Account': s.codeforces.username || '',
    'CF Rating': s.codeforces.rating || '',
    'CF Total Solved': s.codeforces.totalSolved
  }));

  const handleExportCSV = async () => {
    setExportingSpreadsheet(true);
    try {
      let stats = platformStats;
      if (!stats?.length) {
        const res = await axios.get('/api/analytics/platform-stats');
        stats = res.data.success ? res.data.data : [];
      }
      if (!stats?.length) return;

      const rows = buildPlatformStatsRows(stats);
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Student Stats');
      XLSX.writeFile(wb, `student_data_health_export_${Date.now()}.xlsx`);
    } finally {
      setExportingSpreadsheet(false);
    }
  };

  const toggleRow = (id) => {
    setExpandedStudents(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getPlatformStatusDot = (platConn) => {
    if (!platConn.connected) return <span className="h-2 w-2 rounded-full bg-slate-350 dark:bg-slate-755" title="Not connected"></span>;
    if (platConn.syncStatus === 'Healthy') return <span className="h-2 w-2 rounded-full bg-emerald-500" title="Connected and Healthy"></span>;
    if (platConn.syncStatus === 'Partial') return <span className="h-2 w-2 rounded-full bg-amber-400" title="Connected and Partial"></span>;
    if (platConn.syncStatus === 'Failed') return <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" title="Connection Sync Failure"></span>;
    return <span className="h-2 w-2 rounded-full bg-slate-400" title="Never Synced"></span>;
  };

  if (loading && activeTab === 'health') {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
      </div>
    );
  }

  const aggregates = data?.aggregates || {
    totalStudents: 0, healthyCount: 0, partialCount: 0, needsAttentionCount: 0,
    duplicateCount: 0, invalidCount: 0,
    platformSyncRate: { leetcode: 0, codechef: 0, codeforces: 0, hackerrank: 0, overall: 0 },
    systemHealthPercentage: 0
  };

  const studentsList = data?.students || [];

  const filteredStudents = studentsList.filter(s => {
    const text = searchText.toLowerCase();
    const matchesSearch = !text || s.name.toLowerCase().includes(text) || s.rollNo.toLowerCase().includes(text);
    const matchesDept = !filterDept || s.department === filterDept;
    const matchesBatch = !filterBatch || s.batch === filterBatch;
    const matchesHealth = !filterHealth || s.healthIndicator === filterHealth;
    return matchesSearch && matchesDept && matchesBatch && matchesHealth;
  });

  return (
    <>
      {/* Toast Alert popup */}
      {toastMessage && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-lg border text-xs font-bold transition-all ${
          toastType === 'success'
            ? 'bg-emerald-500/10 border-emerald-550/20 text-emerald-600 dark:text-emerald-400'
            : 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-455'
        }`}>
          <span>{toastType === 'success' ? '✔' : '❌'}</span>
          <span>{toastMessage}</span>
        </div>
      )}
      <div className="space-y-6">
        {/* Tab Bar */}
        <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-0">
          {[
            { key: 'health', label: 'Data Health', icon: ShieldCheck },
            { key: 'platform-stats', label: 'Platform Contest Stats', icon: BarChart3 },
            { key: 'attendance-matrix', label: 'Attendance Sheet Export', icon: FileSpreadsheet }
          ].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all border-b-2 ${
                activeTab === tab.key
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-950/20'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}>
              <tab.icon className="h-3.5 w-3.5" /> {tab.label}
            </button>
          ))}
        </div>

        {/* Tab: platform-stats */}
        {activeTab === 'platform-stats' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold text-slate-800 dark:text-white">Platform Contest Stats</h2>
                <p className="text-xs text-slate-400 mt-0.5">Per-student weekly &amp; monthly contest participation across LeetCode, CodeChef and Codeforces</p>
              </div>
              <div className="flex gap-2">
                <button onClick={fetchPlatformStats} className="flex items-center gap-1.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-bold text-xs px-3 py-2 rounded-xl">
                  <RefreshCw className={`h-3.5 w-3.5 ${platformStatsLoading ? 'animate-spin' : ''}`} /> Refresh
                </button>
                <button onClick={handleExportPlatformStats} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-2 rounded-xl">
                  <Download className="h-3.5 w-3.5" /> Export Excel
                </button>
              </div>
            </div>
            {platformStatsLoading ? (
              <div className="flex h-40 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto shadow-sm">
                <table className="w-full text-left text-xs min-w-[1100px]">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950/40 border-b border-slate-150 dark:border-slate-850 text-slate-500 font-bold uppercase tracking-wider">
                      <th className="py-3 px-3">Roll No</th>
                      <th className="py-3 px-3">Name</th>
                      <th className="py-3 px-3 text-center" colSpan="4" style={{borderLeft:'2px solid #f59e0b'}}>
                        <span className="text-orange-500">🟠 LeetCode</span>
                      </th>
                      <th className="py-3 px-3 text-center" colSpan="3" style={{borderLeft:'2px solid #0d9488'}}>
                        <span className="text-teal-600">🟢 CodeChef</span>
                      </th>
                      <th className="py-3 px-3 text-center" colSpan="3" style={{borderLeft:'2px solid #ef4444'}}>
                        <span className="text-red-500">🔴 Codeforces</span>
                      </th>
                    </tr>
                    <tr className="bg-slate-50/80 dark:bg-slate-950/20 border-b border-slate-100 dark:border-slate-850 text-slate-400 text-[10px] uppercase tracking-wider">
                      <th className="py-2 px-3"></th>
                      <th className="py-2 px-3"></th>
                      <th className="py-2 px-3 text-center" style={{borderLeft:'2px solid #f59e0b'}}>Rating</th>
                      <th className="py-2 px-3 text-center">Weekly<br/>This Week</th>
                      <th className="py-2 px-3 text-center">Biweekly<br/>This Week</th>
                      <th className="py-2 px-3 text-center">This Month<br/>(W+B)</th>
                      <th className="py-2 px-3 text-center" style={{borderLeft:'2px solid #0d9488'}}>Rating / Stars</th>
                      <th className="py-2 px-3 text-center">Wed This Week</th>
                      <th className="py-2 px-3 text-center">Wed This Month</th>
                      <th className="py-2 px-3 text-center" style={{borderLeft:'2px solid #ef4444'}}>Rating / Rank</th>
                      <th className="py-2 px-3 text-center">This Week</th>
                      <th className="py-2 px-3 text-center">This Month</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
                    {platformStats.length === 0 ? (
                      <tr><td colSpan="12" className="text-center py-8 text-slate-400">No data available. Make sure student profiles are synced.</td></tr>
                    ) : platformStats.map(s => (
                      <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20">
                        <td className="py-2.5 px-3 font-bold text-slate-500">{s.rollNo}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-white whitespace-nowrap">{s.name}</td>
                        <td className="py-2.5 px-3 text-center" style={{borderLeft:'2px solid #fef3c7'}}>
                          {s.leetcode.username ? (
                            <span className="font-bold text-orange-500">{s.leetcode.rating || '—'}</span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`font-bold px-2 py-0.5 rounded-lg text-[11px] ${s.leetcode.weeklyThisWeek > 0 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                            {s.leetcode.weeklyThisWeek}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`font-bold px-2 py-0.5 rounded-lg text-[11px] ${s.leetcode.biweeklyThisWeek > 0 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                            {s.leetcode.biweeklyThisWeek}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-slate-600 dark:text-slate-300">
                          {s.leetcode.weeklyThisMonth + s.leetcode.biweeklyThisMonth}
                        </td>
                        <td className="py-2.5 px-3 text-center" style={{borderLeft:'2px solid #ccfbf1'}}>
                          {s.codechef.username ? (
                            <div className="flex items-center justify-center gap-1">
                              <span className="font-bold" style={{color: s.codechef.starColor}}>{s.codechef.stars || '—'}</span>
                              <span className="text-slate-500">{s.codechef.rating || ''}</span>
                            </div>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`font-bold px-2 py-0.5 rounded-lg text-[11px] ${s.codechef.wednesdayContestsThisWeek > 0 ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-400'}`}>
                            {s.codechef.wednesdayContestsThisWeek}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-slate-600 dark:text-slate-300">
                          {s.codechef.wednesdayContestsThisMonth}
                        </td>
                        <td className="py-2.5 px-3 text-center" style={{borderLeft:'2px solid #fee2e2'}}>
                          {s.codeforces.username ? (
                            <span className="font-bold text-[11px] px-2 py-0.5 rounded-lg" style={{background: s.codeforces.rankBg, color: s.codeforces.rankColor}}>
                              {s.codeforces.rank} {s.codeforces.rating ? `(${s.codeforces.rating})` : ''}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`font-bold px-2 py-0.5 rounded-lg text-[11px] ${s.codeforces.contestsThisWeek > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-400'}`}>
                            {s.codeforces.contestsThisWeek}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-slate-600 dark:text-slate-300">
                          {s.codeforces.contestsThisMonth}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab: attendance-matrix */}
        {activeTab === 'attendance-matrix' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-xl font-extrabold text-slate-800 dark:text-white">Attendance Sheet Export</h2>
                <p className="text-xs text-slate-400 mt-0.5">Per-person attendance with all contest dates as columns — P = Present, A = Absent, N/A = Not applicable</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <select value={matrixContestType} onChange={e => setMatrixContestType(e.target.value)}
                  className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 px-3 py-2 text-xs outline-none focus:border-primary-500 text-slate-700 dark:text-slate-300">
                  <option value="">All Contest Types</option>
                  <option value="Weekly">Weekly Only</option>
                  <option value="Biweekly">Biweekly Only</option>
                </select>
                <button onClick={fetchAttendanceMatrix} className="flex items-center gap-1.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 font-bold text-xs px-3 py-2 rounded-xl">
                  <RefreshCw className={`h-3.5 w-3.5 ${matrixLoading ? 'animate-spin' : ''}`} /> Load
                </button>
                <button onClick={handleExportMatrix} disabled={!matrix || !matrix.matrix?.length}
                  className="flex items-center gap-1.5 bg-gradient-to-r from-primary-600 to-indigo-600 hover:opacity-95 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow disabled:opacity-40">
                  <Download className="h-3.5 w-3.5" /> Export Excel
                </button>
              </div>
            </div>
            {matrixLoading ? (
              <div className="flex h-40 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
              </div>
            ) : matrix ? (
              <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto shadow-sm">
                <div className="p-4 border-b border-slate-100 dark:border-slate-850 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">{matrix.students} students × {matrix.contests.length} contests</span>
                  <div className="flex items-center gap-3 text-[10px] font-bold">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 inline-block"></span> PRESENT</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block"></span> ABSENT</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-100 inline-block"></span> N/A</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950/40 border-b border-slate-150 dark:border-slate-850 text-slate-500 font-bold">
                        <th className="py-2.5 px-3 sticky left-0 bg-slate-50 dark:bg-slate-950/40 z-10 min-w-[80px]">Roll No</th>
                        <th className="py-2.5 px-3 sticky left-[80px] bg-slate-50 dark:bg-slate-950/40 z-10 min-w-[150px]">Name</th>
                        <th className="py-2.5 px-3 min-w-[80px]">Dept</th>
                        {matrix.contests.map(c => (
                          <th key={c.id} className="py-2.5 px-2 text-center min-w-[90px] whitespace-nowrap text-[10px]">
                            <div>{c.title.replace('LeetCode', '').replace('Contest', '').trim()}</div>
                            <div className="font-normal text-slate-400">{new Date(c.date).toLocaleDateString('en-IN', {day:'2-digit',month:'short'})}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/30">
                      {matrix.matrix.map(s => (
                        <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/10">
                          <td className="py-2 px-3 sticky left-0 bg-white dark:bg-slate-900 font-bold text-slate-500 z-10">{s.rollNo}</td>
                          <td className="py-2 px-3 sticky left-[80px] bg-white dark:bg-slate-900 font-semibold text-slate-800 dark:text-white z-10 whitespace-nowrap">{s.name}</td>
                          <td className="py-2 px-3 text-slate-500">{s.department}</td>
                          {matrix.contests.map(c => {
                            const status = s.attendance[c.id] || 'N/A';
                            return (
                              <td key={c.id} className="py-2 px-2 text-center">
                                <span className={`inline-block px-2 py-0.5 rounded font-bold text-[10px] ${
                                  status === 'PRESENT' ? 'bg-green-100 text-green-700' :
                                  status === 'ABSENT'  ? 'bg-red-100 text-red-600' :
                                  'bg-slate-100 text-slate-400'}`}>
                                  {status === 'PRESENT' ? 'P' : status === 'ABSENT' ? 'A' : '–'}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 text-sm">Click "Load" to generate the attendance matrix.</div>
            )}
          </div>
        )}

        {/* Tab: health - entire original DataHealth content */}
        {activeTab === 'health' && (
          <div className="space-y-6">
            {/* Header Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-3xl font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
                  <ShieldCheck className="h-8 w-8 text-primary-500" /> Data Health Diagnostic Center
                </h1>
                <p className="text-xs text-slate-400 mt-1 uppercase font-bold tracking-wider">
                  Internal administrative reliability, duplicate detection, and platform sync audits
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleForceFullSync}
                  disabled={globalSyncing}
                  className="flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3.5 py-2.5 rounded-xl shadow-sm transition-all disabled:opacity-50"
                >
                  <RotateCw className={`h-4 w-4 ${globalSyncing ? 'animate-spin' : ''}`} /> Force Full Sync
                </button>
                <button
                  onClick={handleClearCache}
                  disabled={clearingCache}
                  className="flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-3.5 py-2.5 rounded-xl shadow-sm transition-all disabled:opacity-50"
                >
                  <Database className="h-4 w-4" /> Flush Cache
                </button>
                <button
                  onClick={() => fetchHealthAudit(true)}
                  className="flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-bold text-xs px-3.5 py-2.5 rounded-xl transition-all shadow-sm hover:bg-slate-50 dark:hover:bg-slate-850"
                >
                  <RefreshCw className="h-4 w-4" /> Run Diagnosis
                </button>
                <button
                  onClick={handleExportCSV}
                  disabled={exportingSpreadsheet}
                  className="flex items-center justify-center gap-1.5 bg-gradient-to-r from-primary-600 to-indigo-600 hover:opacity-95 disabled:opacity-50 text-white font-bold text-xs px-3.5 py-2.5 rounded-xl shadow-md transition-all"
                >
                  <Download className="h-4 w-4" /> {exportingSpreadsheet ? 'Exporting...' : 'Export Spreadsheet'}
                </button>
              </div>
            </div>

            {/* KPI Aggregate cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {/* System health score gauge */}
              <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center gap-4">
                <div className="relative flex items-center justify-center h-20 w-20 shrink-0">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="40" cy="40" r="34" className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="6" fill="transparent" />
                    <circle cx="40" cy="40" r="34" className="stroke-primary-500" strokeWidth="6" fill="transparent"
                      strokeDasharray={2 * Math.PI * 34}
                      strokeDashoffset={2 * Math.PI * 34 * (1 - aggregates.systemHealthPercentage / 100)} />
                  </svg>
                  <div className="absolute flex flex-col items-center justify-center">
                    <span className="text-lg font-black text-slate-800 dark:text-white">{aggregates.systemHealthPercentage}%</span>
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Overall Health</span>
                  <h4 className="font-extrabold text-xs text-slate-700 dark:text-slate-200 mt-1">Platform Diagnostics</h4>
                  <span className="text-[10px] text-slate-400">Target score goal: &gt; 90%</span>
                </div>
              </div>
              {/* Sync counters */}
              <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Audited Directory</span>
                  <h3 className="text-3xl font-black text-slate-800 dark:text-white mt-1">{aggregates.totalStudents}</h3>
                  <span className="text-[10px] text-emerald-500 font-bold mt-0.5 block">{aggregates.healthyCount} 🟢 Healthy</span>
                </div>
                <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-950/40 text-slate-500 text-lg font-bold">👤</div>
              </div>
              {/* Errors/Discrepancies */}
              <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Sync Warnings</span>
                  <h3 className="text-3xl font-black text-slate-800 dark:text-white mt-1">{aggregates.partialCount + aggregates.needsAttentionCount}</h3>
                  <span className="text-[10px] text-rose-500 font-bold mt-0.5 block">{aggregates.needsAttentionCount} 🔴 Action Req</span>
                </div>
                <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/20 text-rose-500 text-lg font-bold">⚠️</div>
              </div>
              {/* Database Duplicates & Invalid */}
              <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Integrity Errors</span>
                  <h3 className="text-3xl font-black text-slate-800 dark:text-white mt-1">{aggregates.duplicateCount + aggregates.invalidCount}</h3>
                  <span className="text-[10px] text-indigo-500 font-bold mt-0.5 block">{aggregates.duplicateCount} Dups • {aggregates.invalidCount} Invalid</span>
                </div>
                <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/20 text-indigo-500 text-lg font-bold">🗄️</div>
              </div>
            </div>

            {/* Platform Sync Rates Widget */}
            <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-850 dark:text-white text-sm uppercase tracking-wider pb-1 border-b border-slate-100 dark:border-slate-850">
                Platform-Wise Integration Rates
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                    <span>LEETCODE</span>
                    <span>{aggregates.platformSyncRate.leetcode}%</span>
                  </div>
                  <div className="w-full bg-slate-150 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-primary-500 h-full rounded-full" style={{ width: `${aggregates.platformSyncRate.leetcode}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                    <span>CODEFORCES</span>
                    <span>{aggregates.platformSyncRate.codeforces}%</span>
                  </div>
                  <div className="w-full bg-slate-150 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${aggregates.platformSyncRate.codeforces}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                    <span>CODECHEF</span>
                    <span>{aggregates.platformSyncRate.codechef}%</span>
                  </div>
                  <div className="w-full bg-slate-150 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-amber-500 h-full rounded-full" style={{ width: `${aggregates.platformSyncRate.codechef}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                    <span>HACKERRANK</span>
                    <span>{aggregates.platformSyncRate.hackerrank}%</span>
                  </div>
                  <div className="w-full bg-slate-150 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${aggregates.platformSyncRate.hackerrank}%` }}></div>
                  </div>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                    <span>OVERALL SYNC RATE</span>
                    <span>{aggregates.platformSyncRate.overall}%</span>
                  </div>
                  <div className="w-full bg-slate-150 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-violet-500 h-full rounded-full" style={{ width: `${aggregates.platformSyncRate.overall}%` }}></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Filter panel */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 bg-white dark:bg-slate-900 p-4 border border-slate-200/60 dark:border-slate-850 rounded-2xl shadow-sm">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search student..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/40 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 text-slate-700 dark:text-slate-350"
                />
                <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
              </div>
              <select
                value={filterDept}
                onChange={(e) => setFilterDept(e.target.value)}
                className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-primary-500 text-slate-700 dark:text-slate-350"
              >
                <option value="">All Departments</option>
                {depts.map(d => (
                  <option key={d.code} value={d.code}>{d.name} ({d.code})</option>
                ))}
              </select>
              <select
                value={filterBatch}
                onChange={(e) => setFilterBatch(e.target.value)}
                className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-primary-500 text-slate-700 dark:text-slate-350"
              >
                <option value="">All Batches</option>
                {batches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <select
                value={filterHealth}
                onChange={(e) => setFilterHealth(e.target.value)}
                className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-primary-500 text-slate-700 dark:text-slate-350"
              >
                <option value="">All Health Categories</option>
                <option value="Healthy">🟢 Healthy</option>
                <option value="Partial">🟡 Partial</option>
                <option value="Needs Attention">🔴 Needs Attention</option>
              </select>
            </div>

            {/* Directory Diagnostic Table */}
            <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
              <div className="p-5 border-b border-slate-100 dark:border-slate-850">
                <h3 className="font-bold text-slate-800 dark:text-white text-sm uppercase tracking-wider">Spreadsheet Diagnostics</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950/40 border-b border-slate-150 dark:border-slate-850 text-slate-500 font-bold uppercase tracking-wider">
                      <th className="py-3.5 px-4 text-center">Status</th>
                      <th className="py-3.5 px-4">Name</th>
                      <th className="py-3.5 px-4">Roll No</th>
                      <th className="py-3.5 px-4">Dept &amp; Sec</th>
                      <th className="py-3.5 px-4 text-center">Score</th>
                      <th className="py-3.5 px-4 text-center">Platforms</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40 font-medium text-slate-700 dark:text-slate-300">
                    {filteredStudents.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="text-center py-8 text-slate-400 font-medium">No student audits match the filters.</td>
                      </tr>
                    ) : (
                      filteredStudents.map((s) => {
                        const isExpanded = !!expandedStudents[s.id];
                        return (
                          <React.Fragment key={s.id}>
                            <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20 cursor-pointer" onClick={() => toggleRow(s.id)}>
                              <td className="py-3.5 px-4 text-center">
                                {s.healthIndicator === 'Healthy' && <span className="text-emerald-500 font-black">🟢</span>}
                                {s.healthIndicator === 'Partial' && <span className="text-amber-500 font-black">🟡</span>}
                                {s.healthIndicator === 'Needs Attention' && <span className="text-rose-500 font-black">🔴</span>}
                              </td>
                              <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">{s.name}</td>
                              <td className="py-3.5 px-4 font-bold text-slate-450">{s.rollNo}</td>
                              <td className="py-3.5 px-4 text-slate-500">{s.department} Section {s.section || 'N/A'}</td>
                              <td className="py-3.5 px-4 text-center font-black text-indigo-600 dark:text-indigo-400">{s.healthScore}%</td>
                              <td className="py-3.5 px-4 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  {getPlatformStatusDot(s.connections.leetcode)}
                                  {getPlatformStatusDot(s.connections.codeforces)}
                                  {getPlatformStatusDot(s.connections.codechef)}
                                  {getPlatformStatusDot(s.connections.hackerrank)}
                                </div>
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <button className="text-slate-400 hover:text-slate-600">
                                  {isExpanded ? <ChevronUp className="h-4.5 w-4.5" /> : <ChevronDown className="h-4.5 w-4.5" />}
                                </button>
                              </td>
                            </tr>

                            {/* Expanded Section */}
                            {isExpanded && (
                              <tr className="bg-slate-50/50 dark:bg-slate-950/25 border-l-2 border-primary-500">
                                <td colSpan="7" className="py-4 px-6 space-y-4">
                                  {/* Missing Fields list */}
                                  {s.missingFields.length > 0 && (
                                    <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
                                      <AlertTriangle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
                                      <div>
                                        <span className="font-bold">Missing Demographic Fields: </span>
                                        {s.missingFields.join(', ')}
                                      </div>
                                    </div>
                                  )}
                                  {/* Sync Errors list */}
                                  {s.syncErrors.length > 0 && (
                                    <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-450">
                                      <XCircle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
                                      <div>
                                        <span className="font-bold">Synchronization Failures: </span>
                                        <ul className="list-disc list-inside mt-1 space-y-0.5">
                                          {s.syncErrors.map((err, i) => <li key={i}>{err}</li>)}
                                        </ul>
                                      </div>
                                    </div>
                                  )}
                                  {/* Connection statuses */}
                                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2">
                                    {Object.entries(s.connections).map(([platform, info]) => {
                                      const key = `${s.id}:${platform}`;
                                      const isSyncing = !!syncingPlatforms[key];
                                      return (
                                        <div key={platform} className="p-3 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 rounded-2xl space-y-2 text-left">
                                          <div className="flex justify-between items-center pb-1.5 border-b border-slate-100 dark:border-slate-800">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{platform}</span>
                                            <div className="flex items-center gap-1.5">
                                              {info.connected ? (
                                                info.syncStatus === 'Healthy' ? (
                                                  <span className="text-[10px] font-bold text-emerald-500 flex items-center gap-0.5">🟢 Healthy ({info.dataCompleteness}%)</span>
                                                ) : info.syncStatus === 'Partial' ? (
                                                  <span className="text-[10px] font-bold text-amber-500 flex items-center gap-0.5">🟡 Partial ({info.dataCompleteness}%)</span>
                                                ) : info.syncStatus === 'Failed' ? (
                                                  <span className="text-[10px] font-bold text-rose-500 flex items-center gap-0.5">🔴 Failed</span>
                                                ) : (
                                                  <span className="text-[10px] font-bold text-slate-400 flex items-center gap-0.5">⚫ Never Synced</span>
                                                )
                                              ) : (
                                                <span className="text-[10px] font-bold text-slate-350 dark:text-slate-600">Disconnected</span>
                                              )}
                                              {info.connected && (
                                                <button
                                                  disabled={isSyncing}
                                                  onClick={(e) => { e.stopPropagation(); handleRetryPlatformSync(s.id, platform); }}
                                                  className="text-slate-400 hover:text-primary-500 p-0.5 rounded transition-all disabled:opacity-30"
                                                  title="Retry Sync"
                                                >
                                                  <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                          {info.connected ? (
                                            <div className="space-y-1 text-[11px]">
                                              <div className="flex justify-between">
                                                <span className="text-slate-400">Handle:</span>
                                                <span className="font-bold text-slate-700 dark:text-slate-200">{info.username}</span>
                                              </div>
                                              <div className="flex justify-between">
                                                <span className="text-slate-400">Status:</span>
                                                <span className="font-bold text-slate-700 dark:text-slate-200">{info.syncStatus}</span>
                                              </div>
                                              {info.syncStatus !== 'Never Synced' && (
                                                <div>
                                                  <div className="flex justify-between">
                                                    <span className="text-slate-400">Solved / Rating:</span>
                                                    <span className="font-bold text-slate-700 dark:text-slate-200">{info.problemsSolved} / {Math.round(info.currentRating)}</span>
                                                  </div>
                                                  <div className="flex justify-between">
                                                    <span className="text-slate-400">Retries:</span>
                                                    <span className="font-bold text-slate-700 dark:text-slate-200">{info.retryCount}</span>
                                                  </div>
                                                  {info.lastSuccessfulSync && (
                                                    <div className="flex justify-between">
                                                      <span className="text-slate-400">Last Success:</span>
                                                      <span className="font-bold text-slate-750 dark:text-slate-250 text-right">{new Date(info.lastSuccessfulSync).toLocaleString()}</span>
                                                    </div>
                                                  )}
                                                  {info.lastAttempt && (
                                                    <div className="flex justify-between">
                                                      <span className="text-slate-400">Last Attempt:</span>
                                                      <span className="font-bold text-slate-700 dark:text-slate-300 text-right">{new Date(info.lastAttempt).toLocaleString()}</span>
                                                    </div>
                                                  )}
                                                  {info.failureReason && (
                                                    <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 text-[10px] text-rose-500 italic break-words">
                                                      Reason: {info.failureReason}
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          ) : (
                                            <span className="text-[10px] text-slate-400 block italic">No account configured.</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default DataHealth;
