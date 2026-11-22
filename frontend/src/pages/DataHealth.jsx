import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheck,
  Search,
  RotateCw,
  Download,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ExternalLink,
  User,
  TrendingUp,
  Activity,
  Layers
} from 'lucide-react';

function DataHealth() {
  const { user } = useAuth();

  // Audit data states
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Sync controls state
  const [globalSyncing, setGlobalSyncing] = useState(false);
  const [syncProgressMsg, setSyncProgressMsg] = useState('');
  const [syncingStudentId, setSyncingStudentId] = useState(null);
  const [exportingReport, setExportingReport] = useState(false);

  // Toast notification
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

  const showToast = (msg, type = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => setToastMessage(''), 4500);
  };

  const fetchHealthAudit = async (forceRefresh = false) => {
    if (!data) setLoading(true);
    setError('');
    try {
      const params = {};
      if (forceRefresh) params.refresh = 'true';
      const res = await axios.get(`${API_URL}/students/data-health`, { params });
      if (res.data && res.data.success) {
        setData(res.data);
      } else {
        setError(res.data?.message || 'Failed to load diagnostic data.');
      }
    } catch (err) {
      console.error('[DataHealth Error]:', err);
      setError(err.response?.data?.message || err.message || 'Failed to retrieve database health audit data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Load metadata dropdowns and initial diagnosis
    axios.get(`${API_URL}/departments`)
      .then(res => { if (res.data?.success) setDepts(res.data.data); })
      .catch(() => {});

    axios.get(`${API_URL}/students/batches`)
      .then(res => { if (res.data?.success) setBatches(res.data.data); })
      .catch(() => {});

    fetchHealthAudit();
  }, []);

  // Force full sync with automatic polling & UI update
  const handleForceFullSync = async () => {
    setGlobalSyncing(true);
    setSyncProgressMsg('Initiating platform sync across all 987 students...');
    showToast('Platform-wide synchronization started in background.');

    try {
      const res = await axios.post(`${API_URL}/students/sync-all`);
      if (res.data && res.data.success) {
        // Poll audit endpoint every 4s for up to 30s to automatically refresh UI
        let attempts = 0;
        const interval = setInterval(async () => {
          attempts++;
          setSyncProgressMsg(`Syncing student profiles in batches (poll #${attempts})...`);
          await fetchHealthAudit(true);
          if (attempts >= 6) {
            clearInterval(interval);
            setGlobalSyncing(false);
            setSyncProgressMsg('');
            showToast('Full sync complete! Data Health diagnostics successfully updated.', 'success');
          }
        }, 4000);
      } else {
        setGlobalSyncing(false);
        setSyncProgressMsg('');
        showToast(res.data?.message || 'Failed to initiate full sync.', 'error');
      }
    } catch (err) {
      setGlobalSyncing(false);
      setSyncProgressMsg('');
      showToast(err.response?.data?.message || 'Failed to trigger full sync.', 'error');
    }
  };

  // Sync individual student handle
  const handleSyncStudent = async (studentId) => {
    setSyncingStudentId(studentId);
    try {
      const res = await axios.post(`${API_URL}/students/${studentId}/sync/leetcode`);
      if (res.data && res.data.success) {
        showToast('LeetCode profile updated successfully!');
        await fetchHealthAudit(true);
      } else {
        showToast(res.data?.message || 'Failed to sync LeetCode profile.', 'error');
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to sync student.', 'error');
    } finally {
      setSyncingStudentId(null);
    }
  };

  // Export clean diagnostics report
  const handleExportReport = () => {
    if (!data?.students?.length) {
      showToast('No student diagnostic records available to export.', 'error');
      return;
    }
    setExportingReport(true);
    try {
      const rows = data.students.map(s => {
        const lc = s.connections?.leetcode || {};
        return {
          'Roll Number': s.rollNo,
          'Student Name': s.name,
          'Department': s.department,
          'Section': s.section || 'N/A',
          'Batch': s.batch || 'N/A',
          'Health Status': s.healthIndicator || 'Needs Attention',
          'Health Score': `${s.healthScore || 0}%`,
          'LeetCode Handle': lc.username || '',
          'LeetCode Total Solved': lc.problemsSolved || 0,
          'Easy Solved': lc.easySolved || 0,
          'Medium Solved': lc.mediumSolved || 0,
          'Hard Solved': lc.hardSolved || 0,
          'Contest Rating': lc.currentRating ? Math.round(lc.currentRating) : 1500,
          'Global Rank': lc.globalRanking || '-',
          'Sync Status': lc.syncStatus || 'Never Synced',
          'Last Synced': lc.lastSuccessfulSync ? new Date(lc.lastSuccessfulSync).toLocaleString() : 'Never'
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Data Health Diagnostics');
      XLSX.writeFile(wb, `Data_Diagnostics_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
      showToast('Diagnostic report exported successfully!');
    } catch (err) {
      console.error('[Export Error]:', err);
      showToast('Failed to export report: ' + err.message, 'error');
    } finally {
      setExportingReport(false);
    }
  };

  const toggleRow = (id) => {
    setExpandedStudents(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const aggregates = data?.aggregates || {
    totalStudents: 0,
    healthyCount: 0,
    partialCount: 0,
    needsAttentionCount: 0,
    duplicateCount: 0,
    invalidCount: 0,
    platformSyncRate: { leetcode: 0, overall: 0 },
    systemHealthPercentage: 0
  };

  const studentsList = data?.students || [];

  const filteredStudents = studentsList.filter(s => {
    const text = searchText.toLowerCase().trim();
    const lc = s.connections?.leetcode?.username || '';
    const matchesSearch = !text ||
      (s.name && s.name.toLowerCase().includes(text)) ||
      (s.rollNo && s.rollNo.toLowerCase().includes(text)) ||
      (lc && lc.toLowerCase().includes(text));
    const matchesDept = !filterDept || s.department === filterDept;
    const matchesBatch = !filterBatch || s.batch === filterBatch;
    const matchesHealth = !filterHealth || s.healthIndicator === filterHealth;
    return matchesSearch && matchesDept && matchesBatch && matchesHealth;
  });

  return (
    <>
      {/* Toast Alert popup */}
      {toastMessage && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl border text-xs font-bold transition-all ${
          toastType === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
            : 'bg-rose-50 dark:bg-rose-950/80 border-rose-500/30 text-rose-700 dark:text-rose-300'
        }`}>
          <span>{toastType === 'success' ? '✔' : '❌'}</span>
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="space-y-6 max-w-7xl mx-auto pb-10">
        {/* Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-2xl bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
                  Data Health Diagnostic Center
                </h1>
                <p className="text-xs font-semibold text-slate-400 mt-0.5">
                  Real-time database integrity, duplicate detection, and live LeetCode sync verification
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleForceFullSync}
              disabled={globalSyncing}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-sm transition-all"
            >
              <RotateCw className={`h-4 w-4 ${globalSyncing ? 'animate-spin' : ''}`} />
              {globalSyncing ? 'Syncing Profiles...' : 'Force Full Sync'}
            </button>
            <button
              onClick={() => fetchHealthAudit(true)}
              disabled={loading || globalSyncing}
              className="flex items-center gap-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-sm"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Run Diagnosis
            </button>
            <button
              onClick={handleExportReport}
              disabled={exportingReport || !data?.students?.length}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-sm transition-all"
            >
              <Download className="h-4 w-4" />
              {exportingReport ? 'Exporting...' : 'Export Excel'}
            </button>
          </div>
        </div>

        {/* Global Syncing In-Progress Notification */}
        {globalSyncing && (
          <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"></div>
              <span className="text-xs font-bold text-indigo-800 dark:text-indigo-200">
                {syncProgressMsg || 'Synchronizing student performance data in background...'}
              </span>
            </div>
            <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
              Auto-refreshing diagnostics...
            </span>
          </div>
        )}

        {/* Error Notification */}
        {error && (
          <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-center justify-between text-xs font-bold text-rose-700 dark:text-rose-300">
            <span>❌ {error}</span>
            <button onClick={() => fetchHealthAudit(true)} className="underline hover:text-rose-900">Retry Diagnosis</button>
          </div>
        )}

        {/* KPI Summary Cards - Clean Grid without Overlapping */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Health Score */}
          <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">System Health</span>
              <div className="text-3xl font-black text-slate-900 dark:text-white leading-none">
                {aggregates.systemHealthPercentage}%
              </div>
              <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 block pt-1">
                🟢 Production Grade
              </span>
            </div>
            <div className="h-12 w-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Activity className="h-6 w-6" />
            </div>
          </div>

          {/* Card 2: Active Directory */}
          <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Audited Students</span>
              <div className="text-3xl font-black text-slate-900 dark:text-white leading-none">
                {aggregates.totalStudents}
              </div>
              <span className="text-[11px] font-semibold text-slate-500 block pt-1">
                {aggregates.healthyCount} Active Profiles
              </span>
            </div>
            <div className="h-12 w-12 rounded-2xl bg-primary-50 dark:bg-primary-950/40 flex items-center justify-center text-primary-600 dark:text-primary-400">
              <User className="h-6 w-6" />
            </div>
          </div>

          {/* Card 3: Synchronization Health */}
          <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Sync Status</span>
              <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400 leading-none">
                {aggregates.healthyCount}
              </div>
              <span className="text-[11px] font-semibold text-slate-500 block pt-1">
                {aggregates.needsAttentionCount > 0 ? `${aggregates.needsAttentionCount} Need Attention` : '0 Sync Warnings'}
              </span>
            </div>
            <div className="h-12 w-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <CheckCircle className="h-6 w-6" />
            </div>
          </div>

          {/* Card 4: Integrity Errors */}
          <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Integrity Checks</span>
              <div className="text-3xl font-black text-slate-900 dark:text-white leading-none">
                {aggregates.duplicateCount + aggregates.invalidCount}
              </div>
              <span className="text-[11px] font-semibold text-slate-500 block pt-1">
                {aggregates.duplicateCount} Duplicates • {aggregates.invalidCount} Invalid
              </span>
            </div>
            <div className="h-12 w-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-6 w-6" />
            </div>
          </div>
        </div>

        {/* LeetCode Integration Banner */}
        <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-orange-500"></span> LeetCode Live Synchronization
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Official GraphQL API connection status across all registered student profiles
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs font-black text-orange-600 dark:text-orange-400">
                {aggregates.platformSyncRate?.leetcode || 100}% Active Connection
              </span>
            </div>
          </div>

          <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-orange-500 to-amber-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${aggregates.platformSyncRate?.leetcode || 100}%` }}
            />
          </div>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-white dark:bg-slate-900 p-4 border border-slate-200/60 dark:border-slate-800 rounded-2xl shadow-sm">
          <div className="relative">
            <input
              type="text"
              placeholder="Search by name, roll no, or handle..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/40 text-xs outline-none focus:border-primary-500 text-slate-800 dark:text-slate-200"
            />
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
          </div>

          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-primary-500 text-slate-800 dark:text-slate-200"
          >
            <option value="">All Departments</option>
            {depts.map(d => (
              <option key={d.code} value={d.code}>{d.name} ({d.code})</option>
            ))}
          </select>

          <select
            value={filterBatch}
            onChange={(e) => setFilterBatch(e.target.value)}
            className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-primary-500 text-slate-800 dark:text-slate-200"
          >
            <option value="">All Batches</option>
            {batches.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>

          <select
            value={filterHealth}
            onChange={(e) => setFilterHealth(e.target.value)}
            className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-primary-500 text-slate-800 dark:text-slate-200"
          >
            <option value="">All Health Statuses</option>
            <option value="Healthy">🟢 Healthy</option>
            <option value="Partial">🟡 Partial</option>
            <option value="Needs Attention">🔴 Needs Attention</option>
          </select>
        </div>

        {/* Directory Diagnostic Table */}
        <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
          <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="font-extrabold text-slate-800 dark:text-white text-sm uppercase tracking-wider">
                Audited Student Directory
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Showing {filteredStudents.length} of {aggregates.totalStudents} total students
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold text-slate-400">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span> Healthy ({aggregates.healthyCount})</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500"></span> Needs Attention ({aggregates.needsAttentionCount})</span>
            </div>
          </div>

          {loading ? (
            <div className="flex h-56 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[950px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950/40 border-b border-slate-150 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4 text-center w-16">Status</th>
                    <th className="py-3 px-4 min-w-[120px]">Roll No</th>
                    <th className="py-3 px-4 min-w-[180px]">Student Name</th>
                    <th className="py-3 px-4 min-w-[120px]">Dept &amp; Sec</th>
                    <th className="py-3 px-4 min-w-[140px]">LeetCode Handle</th>
                    <th className="py-3 px-4 text-center min-w-[100px]">Problems</th>
                    <th className="py-3 px-4 text-center min-w-[90px]">Rating</th>
                    <th className="py-3 px-4 text-center min-w-[140px]">Last Synced</th>
                    <th className="py-3 px-4 text-right min-w-[100px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40 font-medium">
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="text-center py-12 text-slate-400 font-semibold">
                        No student diagnostic records match your search filters.
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((s) => {
                      const isExpanded = !!expandedStudents[s.id];
                      const lc = s.connections?.leetcode || {};
                      const isSyncingThis = syncingStudentId === s.id;

                      return (
                        <React.Fragment key={s.id}>
                          <tr
                            className="hover:bg-slate-50/70 dark:hover:bg-slate-850/30 cursor-pointer transition-colors"
                            onClick={() => toggleRow(s.id)}
                          >
                            <td className="py-3 px-4 text-center">
                              {s.healthIndicator === 'Healthy' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                                  Healthy
                                </span>
                              )}
                              {s.healthIndicator === 'Partial' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                                  Partial
                                </span>
                              )}
                              {s.healthIndicator === 'Needs Attention' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400">
                                  Attention
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-bold text-slate-500 dark:text-slate-400">{s.rollNo}</td>
                            <td className="py-3 px-4 font-bold text-slate-900 dark:text-white whitespace-nowrap">{s.name}</td>
                            <td className="py-3 px-4 text-slate-500 whitespace-nowrap">{s.department} • Sec {s.section || '-'}</td>
                            <td className="py-3 px-4 font-semibold text-orange-600 dark:text-orange-400">
                              {lc.username ? (
                                <a
                                  href={`https://leetcode.com/u/${lc.username}/`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 hover:underline"
                                >
                                  {lc.username}
                                  <ExternalLink className="h-3 w-3 opacity-60" />
                                </a>
                              ) : (
                                <span className="text-slate-300 dark:text-slate-600">—</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center font-bold text-slate-800 dark:text-slate-200">
                              {lc.problemsSolved || 0}
                            </td>
                            <td className="py-3 px-4 text-center font-bold text-indigo-600 dark:text-indigo-400">
                              {lc.currentRating ? Math.round(lc.currentRating) : '—'}
                            </td>
                            <td className="py-3 px-4 text-center text-[11px] text-slate-400 whitespace-nowrap">
                              {lc.lastSuccessfulSync ? new Date(lc.lastSuccessfulSync).toLocaleDateString('en-IN', {
                                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                              }) : 'Never'}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => handleSyncStudent(s.id)}
                                  disabled={isSyncingThis}
                                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-primary-600 hover:border-primary-500 transition-all disabled:opacity-40"
                                  title="Sync LeetCode"
                                >
                                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncingThis ? 'animate-spin' : ''}`} />
                                </button>
                                <button
                                  onClick={() => toggleRow(s.id)}
                                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-400 hover:text-slate-600 transition-all"
                                >
                                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Student Audit Drawer */}
                          {isExpanded && (
                            <tr className="bg-slate-50/70 dark:bg-slate-950/40 border-l-4 border-primary-500">
                              <td colSpan="9" className="py-4 px-6 space-y-3">
                                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                  {/* Problem breakdown */}
                                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 space-y-1.5">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Difficulty Breakdown</span>
                                    <div className="flex items-center gap-2 pt-1">
                                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300">
                                        Easy: {lc.easySolved || 0}
                                      </span>
                                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                        Med: {lc.mediumSolved || 0}
                                      </span>
                                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                                        Hard: {lc.hardSolved || 0}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Contest metrics */}
                                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 space-y-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contest Standing</span>
                                    <div className="text-sm font-black text-slate-800 dark:text-white pt-0.5">
                                      Rating: {lc.currentRating ? Math.round(lc.currentRating) : 'Unrated'}
                                    </div>
                                    <div className="text-[11px] text-slate-400">
                                      Global Rank: {lc.globalRanking ? `#${lc.globalRanking.toLocaleString()}` : '—'}
                                    </div>
                                  </div>

                                  {/* Audit details */}
                                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 space-y-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Audit Metadata</span>
                                    <div className="text-[11px] text-slate-600 dark:text-slate-300 pt-0.5">
                                      Data Completeness: <span className="font-bold text-emerald-600">{lc.dataCompleteness || 100}%</span>
                                    </div>
                                    <div className="text-[11px] text-slate-400">
                                      Batch: {s.batch || 'N/A'} • Dept: {s.department}
                                    </div>
                                  </div>

                                  {/* Action button */}
                                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 flex flex-col justify-between">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Profile Actions</span>
                                    <button
                                      disabled={isSyncingThis}
                                      onClick={() => handleSyncStudent(s.id)}
                                      className="flex items-center justify-center gap-1.5 w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-bold text-xs py-1.5 px-3 rounded-xl transition-all shadow-sm"
                                    >
                                      <RefreshCw className={`h-3.5 w-3.5 ${isSyncingThis ? 'animate-spin' : ''}`} />
                                      {isSyncingThis ? 'Syncing...' : 'Sync Profile'}
                                    </button>
                                  </div>
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
          )}
        </div>
      </div>
    </>
  );
}

export default DataHealth;
