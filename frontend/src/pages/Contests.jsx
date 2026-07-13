import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  Plus,
  Calendar,
  Trash2,
  Edit,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  Download,
  Activity,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Filter,
  BarChart3,
  TrendingUp,
  Lock,
  Unlock,
  Users,
  Target,
  Trophy,
  Zap,
  Eye,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  RefreshCw,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getLeetCodeProfileUrl } from '../utils/platformUrls';
import { logger } from '../utils/logger';
import { normalizeAttendanceStatus } from '../utils/attendance';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Cell,
  Area,
  AreaChart,
} from 'recharts';

/* ─────────────────────────── helpers ─────────────────────────── */

function getContestTiming(dateStr, durationSeconds = 5400) {
  const now = new Date();
  const startTime = new Date(dateStr);
  if (isNaN(startTime.getTime())) return 'past';
  const endTime = new Date(startTime.getTime() + durationSeconds * 1000);
  if (startTime > now) return 'upcoming';
  if (startTime <= now && endTime > now) return 'active';
  return 'past';
}

function parseDateOnly(dateInput) {
  if (!dateInput) return new Date();
  const d = new Date(dateInput);
  return isNaN(d.getTime()) ? new Date() : d;
}

/* ── Badge helpers ── */
function TypeBadge({ type }) {
  const t = type ? type.toLowerCase() : '';
  
  if (t === 'weekly') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30">
        <Zap className="h-3 w-3" /> Weekly
      </span>
    );
  }
  if (t === 'biweekly') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400 border border-violet-100 dark:border-violet-900/30">
        <Calendar className="h-3 w-3" /> Biweekly
      </span>
    );
  }
  if (t === 'starters') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-450 border border-amber-100 dark:border-amber-900/30">
        <Zap className="h-3 w-3" /> Starters
      </span>
    );
  }
  if (t === 'cook-off') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-450 border border-orange-100 dark:border-orange-900/30">
        <Calendar className="h-3 w-3" /> Cook-Off
      </span>
    );
  }
  if (t === 'lunchtime') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-450 border border-emerald-100 dark:border-emerald-900/30">
        <Zap className="h-3 w-3" /> Lunchtime
      </span>
    );
  }
  if (t === 'long challenge') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/30">
        <Calendar className="h-3 w-3" /> Long Challenge
      </span>
    );
  }
  if (t === 'div1+div2') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30">
        <Zap className="h-3 w-3" /> DIV1 + DIV2
      </span>
    );
  }
  if (t.includes('div')) {
    const formatted = type.toUpperCase().replace('ROUND', '').trim();
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30">
        <Zap className="h-3 w-3" /> {formatted}
      </span>
    );
  }
  if (t === 'educational' || t.includes('edu')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 border border-sky-100 dark:border-sky-900/30">
        <Calendar className="h-3 w-3" /> EDUCATIONAL
      </span>
    );
  }
  if (t === 'global') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-teal-50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400 border border-teal-100 dark:border-teal-900/30">
        <Zap className="h-3 w-3" /> GLOBAL
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide bg-slate-50 text-slate-700 dark:bg-slate-850 dark:text-slate-450 border border-slate-200 dark:border-slate-800">
      {type}
    </span>
  );
}

function AttendanceBadge({ contest }) {
  const timing = getContestTiming(contest.date, contest.duration || 5400);
  const isOngoing = timing === 'active';
  const isUnrated = contest.status?.toLowerCase() === 'unrated' || contest.contest_status?.toLowerCase() === 'unrated' || normalizeAttendanceStatus(contest.attendance_status) === 'UNRATED';
  const isPresent = contest.is_joined || normalizeAttendanceStatus(contest.attendance_status) === 'PRESENT';

  if (isOngoing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-extrabold bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
        🔵 Ongoing
      </span>
    );
  }

  if (isUnrated) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-extrabold bg-slate-100 text-slate-550 dark:bg-slate-800/50 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        ⚪ Unrated
      </span>
    );
  }

  if (isPresent) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-extrabold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-450 border border-emerald-100 dark:border-emerald-900/30">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        ✓ Present
      </span>
    );
  }

  if (timing === 'upcoming') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-extrabold bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-450 border border-blue-100 dark:border-blue-900/30">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
        Registered
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-extrabold bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
      🔴 Absent
    </span>
  );
}

function TimingBadge({ timing }) {
  const map = {
    active: 'bg-amber-400 text-white animate-pulse',
    upcoming: 'bg-sky-500 text-white',
    past: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  };
  return (
    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[10px] font-extrabold capitalize ${map[timing]}`}>
      {timing}
    </span>
  );
}

/* ── Tooltip for charts ── */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 shadow-xl text-white text-xs">
      <p className="font-bold text-slate-300 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: <span className="font-black">{p.value}%</span></p>
      ))}
    </div>
  );
};

function StatCard({ icon: Icon, label, value, sub, colorClass, bgClass }) {
  return (
    <div className={`rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-4 shadow-sm flex items-center gap-3.5 hover:shadow-md transition-all duration-200`}>
      <div className={`p-2.5 rounded-xl ${bgClass} shrink-0`}>
        <Icon className={`h-5 w-5 ${colorClass}`} />
      </div>
      <div>
        <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">{label}</span>
        <span className="text-lg font-black text-slate-850 dark:text-white mt-0.5 block">{value}</span>
        <span className="text-[10px] text-slate-400 mt-0.5 block">{sub}</span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════ */
function Contests() {
  /* ── platform selector state ── */
  const [activePlatform, setActivePlatform] = useState('leetcode');

  /* ── standard states ── */
  const [contests, setContests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selectedBatch, setSelectedBatch] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [adminMode, setAdminMode] = useState(false);
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [modalMode, setModalMode] = useState('add');
  const [selectedContest, setSelectedContest] = useState(null);

  const [students, setStudents] = useState([]);
  const [availableBatches, setAvailableBatches] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('all');
  const [studentSearch, setStudentSearch] = useState('');

  /* ── pre-calculated platform analytics ── */
  const [metrics, setMetrics] = useState({ eligible: 0, attended: 0, missed: 0, rate: 0.0, ongoing: 0 });
  const [monthlyTrendData, setMonthlyTrendData] = useState([]);
  const [semesterAnalyticsData, setSemesterAnalyticsData] = useState([]);
  const [batchComparisonData, setBatchComparisonData] = useState([]);
  const [studentSummaries, setStudentSummaries] = useState([]);
  const [platformRanking, setPlatformRanking] = useState(null);

  const [showAnalyticsPanel, setShowAnalyticsPanel] = useState(true);
  const [activeAnalyticsTab, setActiveAnalyticsTab] = useState('trend');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [expandedContestId, setExpandedContestId] = useState(null);
  const [contestParticipants, setContestParticipants] = useState({});
  const [loadingParticipants, setLoadingParticipants] = useState({});

  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideContest, setOverrideContest] = useState(null);
  const [overrideStatus, setOverrideStatus] = useState('present');
  const [overrideRemarks, setOverrideRemarks] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);
  const [syncingPlatform, setSyncingPlatform] = useState(false);

  const [formData, setFormData] = useState({ contestId: '', name: '', date: '', type: 'weekly', platform: 'leetcode' });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const selectedStudentInfo = students.find(s => s.id === parseInt(selectedStudentId));

  /* ── platform style configurations ── */
  const platformStyles = {
    leetcode: {
      text: 'text-orange-500 dark:text-orange-400',
      textAccent: 'text-orange-600 dark:text-orange-400',
      bg: 'bg-orange-500',
      bgMuted: 'bg-orange-50 dark:bg-orange-950/20',
      bgHover: 'hover:bg-orange-600',
      border: 'border-orange-200 dark:border-orange-900/30 focus:border-orange-400',
      borderMuted: 'border-orange-100 dark:border-orange-900/30',
      shadow: 'shadow-orange-500/20',
      gradient: 'from-orange-500 to-amber-500',
      gradientButton: 'from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400',
      badge: 'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-450 border-orange-100 dark:border-orange-900/30',
      chartColor: '#f97316'
    },
    codechef: {
      text: 'text-amber-800 dark:text-amber-400',
      textAccent: 'text-amber-800 dark:text-amber-400',
      bg: 'bg-amber-800',
      bgMuted: 'bg-amber-50 dark:bg-amber-950/20',
      bgHover: 'hover:bg-amber-900',
      border: 'border-amber-200 dark:border-amber-700 focus:border-amber-500',
      borderMuted: 'border-amber-100 dark:border-amber-800/30',
      shadow: 'shadow-amber-800/20',
      gradient: 'from-amber-800 to-amber-600',
      gradientButton: 'from-amber-800 to-amber-700 hover:from-amber-700 hover:to-amber-600',
      badge: 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-450 border-amber-100 dark:border-amber-900/30',
      chartColor: '#b45309'
    },
    codeforces: {
      text: 'text-rose-600 dark:text-rose-400',
      textAccent: 'text-rose-600 dark:text-rose-400',
      bg: 'bg-rose-600',
      bgMuted: 'bg-rose-50 dark:bg-rose-950/20',
      bgHover: 'hover:bg-rose-700',
      border: 'border-rose-200 dark:border-rose-700 focus:border-rose-500',
      borderMuted: 'border-rose-100 dark:border-rose-800/30',
      shadow: 'shadow-rose-500/20',
      gradient: 'from-rose-600 to-red-500',
      gradientButton: 'from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400',
      badge: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-450 border-rose-100 dark:border-rose-900/30',
      chartColor: '#e11d48'
    }
  };

  const style = platformStyles[activePlatform] || platformStyles.leetcode;

  /* ── fetch active students and batches (on mount) ── */
  useEffect(() => {
    axios.get('/api/students?status=active')
      .then(res => { if (res.data.success) setStudents(res.data.data || []); })
      .catch(() => {});

    axios.get('/api/contestmaster/batches')
      .then(res => { setAvailableBatches(res.data || []); })
      .catch(() => {});
  }, []);

  /* ── fetch platform data ── */
  const fetchPlatformData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`/api/contestmaster/${activePlatform}`, {
        params: {
          studentId: selectedStudentId,
          batch: selectedBatch,
          type: filterType,
          status: filterStatus
        }
      });
      if (res.data.success) {
        setContests(res.data.contests || []);
        setMetrics(res.data.metrics || { eligible: 0, attended: 0, missed: 0, rate: 0.0, ongoing: 0 });
        setMonthlyTrendData(res.data.monthlyTrendData || []);
        setSemesterAnalyticsData(res.data.semesterAnalyticsData || []);
        setBatchComparisonData(res.data.batchComparisonData || []);
        setStudentSummaries(res.data.studentSummaries || []);
        setPlatformRanking(res.data.platformRanking || null);
      }
    } catch (err) {
      console.error('Error fetching platform master data:', err);
      setError(`Failed to fetch ${activePlatform} analytics dashboard data.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlatformData();
  }, [activePlatform, selectedStudentId, selectedBatch, filterType, filterStatus]);

  const handleSyncPlatformData = async () => {
    setSyncingPlatform(true);
    setSuccessMsg('');
    setError('');
    try {
      const res = await axios.post('/api/contests/sync');
      if (res.data.success) {
        setSuccessMsg('Synchronization job started in background.');
        await fetchPlatformData();
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch (err) {
      setError('Failed to trigger platform synchronization.');
    } finally {
      setSyncingPlatform(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    setExpandedContestId(null);
    setContestParticipants({});  // clear stale expanded data when filters change
  }, [selectedStudentId, selectedBatch, filterType, filterStatus, activePlatform]);

  /* ── derived date limits for frontend filtering (fallback) ── */
  const batchStudentsCount = useMemo(() => {
    const bs = students.filter(s => selectedBatch ? s.academic_batch === selectedBatch : true);
    return bs.length || 1;
  }, [students, selectedBatch]);

  const batchDates = useMemo(() => {
    if (!selectedBatch) return null;
    const bs = students.filter(s => s.academic_batch === selectedBatch);
    if (!bs.length) return null;
    const starts = bs.map(s => new Date(s.academic_start_date).getTime()).filter(t => !isNaN(t));
    const ends = bs.map(s => new Date(s.academic_end_date).getTime()).filter(t => !isNaN(t));
    return {
      start: starts.length ? new Date(Math.min(...starts)) : null,
      end: ends.length ? new Date(Math.max(...ends)) : null,
    };
  }, [selectedBatch, students]);

  // Apply batch date boundaries on the frontend contests list
  const filteredContestsByBatch = useMemo(() => {
    let list = contests;
    if (selectedBatch && batchDates) {
      list = list.filter(c => {
        const t = new Date(c.date).getTime();
        const ok1 = batchDates.start ? t >= batchDates.start.getTime() : true;
        const ok2 = batchDates.end ? t <= batchDates.end.getTime() : true;
        return ok1 && ok2;
      });
    }
    return list;
  }, [contests, selectedBatch, batchDates]);

  // Filter students dropdown list based on search and batch
  const filteredStudents = useMemo(() =>
    students.filter(s => {
      const matchSearch = s.name.toLowerCase().includes(studentSearch.toLowerCase()) || s.roll_no.includes(studentSearch);
      const matchBatch = selectedBatch ? s.academic_batch === selectedBatch : true;
      return matchSearch && matchBatch;
    }), [students, studentSearch, selectedBatch]);

  const recentActivity = useMemo(() =>
    filteredContestsByBatch.filter(c => getContestTiming(c.date, c.duration || 5400) === 'past').slice(0, 5),
    [filteredContestsByBatch]);

  // Paginate list
  const paginatedContests = useMemo(() =>
    filteredContestsByBatch.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [filteredContestsByBatch, currentPage]);

  const totalPages = Math.ceil(filteredContestsByBatch.length / itemsPerPage);

  /* ── platform category breakdowns (Right Sidebar) ── */
  const platformBreakdowns = useMemo(() => {
    const eligibleRecords = contests.filter(c => c.eligibility_status === 'Eligible' && (c.status === 'attended' || c.status === 'not attended'));
    
    const computeBreakdown = (filterFn, label) => {
      const records = eligibleRecords.filter(filterFn);
      const eligible = records.length;
      let attended = 0;
      if (selectedStudentId !== 'all') {
        attended = records.filter(c => c.is_joined || normalizeAttendanceStatus(c.attendance_status) === 'PRESENT').length;
      } else {
        const totalAttended = records.reduce((acc, c) => acc + (c.attendance_count || 0), 0);
        attended = Math.round(totalAttended / batchStudentsCount);
      }
      const missed = Math.max(0, eligible - attended);
      const rate = eligible > 0 ? parseFloat(((attended / eligible) * 100).toFixed(1)) : null;
      return { label, eligible, attended, missed, rate };
    };

    if (activePlatform === 'leetcode') {
      return [
        computeBreakdown(c => c.type === 'weekly', 'Weekly Contests'),
        computeBreakdown(c => c.type === 'biweekly', 'Biweekly Contests')
      ];
    } else if (activePlatform === 'codechef') {
      return [
        computeBreakdown(c => c.type === 'starters', 'Starters'),
        computeBreakdown(c => c.type === 'cook-off', 'Cook-Off'),
        computeBreakdown(c => c.type === 'lunchtime', 'Lunchtime'),
        computeBreakdown(c => c.type === 'long challenge', 'Long Challenge')
      ];
    } else if (activePlatform === 'codeforces') {
      return [
        computeBreakdown(c => c.type === 'div1' || c.type === 'div1+div2', 'Div 1 Rounds'),
        computeBreakdown(c => c.type === 'div2' || c.type === 'div1+div2', 'Div 2 Rounds'),
        computeBreakdown(c => c.type === 'div3', 'Div 3 Rounds'),
        computeBreakdown(c => c.type === 'div4', 'Div 4 Rounds'),
        computeBreakdown(c => c.type === 'educational', 'Educational Rounds'),
        computeBreakdown(c => c.type === 'global', 'Global Rounds')
      ];
    }
    return [];
  }, [contests, activePlatform, selectedStudentId, batchStudentsCount]);

  /* ── form handlers ── */
  const handleInputChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const openAddModal = () => {
    setFormData({ contestId: '', name: '', date: new Date().toISOString().split('T')[0], type: 'weekly', platform: activePlatform });
    setFormError('');
    setIsOpenModal(true);
    setModalMode('add');
  };

  const openEditModal = (c) => {
    setSelectedContest(c);
    setFormData({ contestId: c.contest_id, name: c.name, date: new Date(c.date).toISOString().split('T')[0], type: c.type, platform: activePlatform });
    setFormError('');
    setIsOpenModal(true);
    setModalMode('edit');
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormLoading(true);
    try {
      const res = modalMode === 'add'
        ? await axios.post('/api/contests', formData)
        : await axios.put(`/api/contests/${selectedContest.id}`, formData);
      if (res.data.success) {
        setIsOpenModal(false);
        setSuccessMsg(modalMode === 'add' ? 'Contest created successfully.' : 'Contest updated successfully.');
        fetchPlatformData();
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch (err) {
      setFormError(err.response?.data?.message || 'Error saving contest.');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteContest = async (id) => {
    if (!window.confirm('Delete this contest? All attendance records will be permanently removed.')) return;
    try {
      const res = await axios.delete(`/api/contests/${id}`);
      if (res.data.success) {
        setSuccessMsg('Contest deleted.');
        fetchPlatformData();
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch {
      setError('Failed to delete contest.');
    }
  };

  const handleRegister = async (contestId) => {
    try {
      const res = await axios.post('/api/contests/register', { userId: selectedStudentId, contestId });
      if (res.data.success) { setSuccessMsg('Registered!'); fetchPlatformData(); setTimeout(() => setSuccessMsg(''), 3000); }
    } catch { setError('Failed to register.'); }
  };

  const handleJoin = async (contestId) => {
    try {
      const res = await axios.post('/api/contests/join', { userId: selectedStudentId, contestId });
      if (res.data.success) { setSuccessMsg('Joined & marked present!'); fetchPlatformData(); setTimeout(() => setSuccessMsg(''), 3000); }
    } catch { setError('Failed to join.'); }
  };

  const openOverride = (c) => {
    setOverrideContest(c);
    setOverrideStatus(c.is_joined ? 'absent' : 'present');
    setOverrideRemarks('');
    setShowOverrideModal(true);
  };

  const handleOverrideSubmit = async (e) => {
    e.preventDefault();
    if (!overrideContest || selectedStudentId === 'all') return;
    setSavingOverride(true);
    try {
      const res = await axios.post('/api/attendance/override', {
        studentId: selectedStudentId,
        contestId: overrideContest.id,
        status: overrideStatus,
        remarks: overrideRemarks,
      });
      if (res.data.success) {
        setShowOverrideModal(false);
        setSuccessMsg(`Override saved for ${overrideContest.name}.`);
        fetchPlatformData();
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch { setError('Failed to save override.'); }
    finally { setSavingOverride(false); }
  };

  const fetchParticipants = async (contestId) => {
    // Always re-fetch when called — filters may have changed since last fetch.
    setLoadingParticipants(p => ({ ...p, [contestId]: true }));
    try {
      const res = await axios.get(`/api/attendance/contest/${contestId}`, {
        params: {
          batch: selectedBatch || undefined
        }
      });
      if (res.data.success) {
        logger.debug('Received contest participants:', res.data.data);
        setContestParticipants(p => ({
          ...p,
          [contestId]: {
            attended: res.data.attended || [],
            missed: res.data.missed || [],
            raw: res.data.data || [],
            validationStatus: res.data.validationStatus,
            validationIssues: res.data.validationIssues
          }
        }));
      }
    } catch {}
    finally { setLoadingParticipants(p => ({ ...p, [contestId]: false })); }
  };

  const handleToggleExpand = (id) => {
    if (expandedContestId === id) { setExpandedContestId(null); return; }
    setExpandedContestId(id);
    const item = contests.find(c => c.id === id);
    if (selectedStudentId === 'all' && item) fetchParticipants(id);
  };

  /* ── Export Report ── */
  const handleExportReport = () => {
    const pLabel = activePlatform === 'leetcode' ? 'LeetCode' : activePlatform === 'codechef' ? 'CodeChef' : 'Codeforces';
    const fileName = `${pLabel}_ContestMaster_Report`;
    
    let exportData = [];
    if (selectedStudentId === 'all') {
      exportData = filteredContestsByBatch.map(c => ({
        'Contest Name': c.name,
        'Platform': pLabel,
        'Type': c.type,
        'Date': new Date(c.date).toLocaleDateString('en-GB'),
        'Registrations': c.registration_count,
        'Attended Count': c.attendance_count,
        'Attendance Rate %': c.registration_count > 0 ? Math.round((c.attendance_count / c.registration_count) * 100) : 0
      }));
    } else {
      exportData = filteredContestsByBatch.map(c => ({
        'Student Name': selectedStudentInfo?.name,
        'Register No': selectedStudentInfo?.roll_no,
        'Contest Name': c.name,
        'Platform': pLabel,
        'Type': c.type,
        'Date': new Date(c.date).toLocaleDateString('en-GB'),
        'Eligibility': c.eligibility_status,
        'Attendance Status': c.attendance_status,
        'Global Rank': c.global_rank || 'N/A',
        'Solved': c.problems_solved !== null ? c.problems_solved : 'N/A',
        'Rating': c.rating || 'N/A',
        'Rating Change': c.rating_change || '0'
      }));
    }

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PlatformContestReport');
    XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  /* ════════════════ RENDER ════════════════ */
  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── PAGE HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <div className={`h-8 w-8 rounded-xl bg-gradient-to-br ${style.gradient} flex items-center justify-center shadow-md ${style.shadow}`}>
              <Trophy className="h-4 w-4 text-white" />
            </div>
            <h1 className="text-xl font-black text-slate-800 dark:text-white tracking-tight">Contest Master</h1>
          </div>
          <p className="text-xs text-slate-400 ml-10">
            Track college-wide {activePlatform === 'leetcode' ? 'LeetCode' : activePlatform === 'codechef' ? 'CodeChef' : 'Codeforces'} contest participation · Analyze batch trends · Generate reports
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
              onClick={openAddModal}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r ${style.gradientButton} text-white text-xs font-bold transition-all shadow-md ${style.shadow}`}
            >
              <Plus className="h-3.5 w-3.5" /> Create Contest
            </button>
          )}
        </div>
      </div>

      {/* ── PLATFORM SELECTOR ── */}
      <div className="flex rounded-2xl bg-white dark:bg-slate-900 p-1.5 border border-slate-200/60 dark:border-slate-850 shadow-sm gap-2">
        {[
          { id: 'leetcode', label: 'LeetCode', icon: '🟠' },
          { id: 'codechef', label: 'CodeChef', icon: '🟤' },
          { id: 'codeforces', label: 'Codeforces', icon: '🔴' }
        ].map(platform => {
          const isActive = activePlatform === platform.id;
          let btnClass = "";
          if (isActive) {
            if (platform.id === 'leetcode') btnClass = "bg-orange-500 text-white shadow-md shadow-orange-500/20";
            else if (platform.id === 'codechef') btnClass = "bg-amber-800 text-white shadow-md shadow-amber-800/20";
            else if (platform.id === 'codeforces') btnClass = "bg-rose-600 text-white shadow-md shadow-rose-500/20";
          } else {
            btnClass = "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50";
          }
          return (
            <button
              key={platform.id}
              onClick={() => {
                setActivePlatform(platform.id);
                setFilterType('');
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black transition-all ${btnClass}`}
            >
              <span className="text-sm leading-none">{platform.icon}</span>
              {platform.label}
            </button>
          );
        })}
      </div>

      {/* ── TOAST ALERTS ── */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 px-4 py-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400 animate-fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0" />{successMsg}
          <button className="ml-auto" onClick={() => setSuccessMsg('')}><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 px-4 py-3 text-xs font-semibold text-rose-700 dark:text-rose-400 animate-fade-in">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
          <button className="ml-auto" onClick={() => setError('')}><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* ── SUMMARY STAT CARDS ── */}
      <div>
        <div className="flex items-center justify-between mb-2.5 px-0.5">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Dashboard Metrics</span>
          <span className="text-[10px] italic text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-full capitalize font-semibold">
            {selectedStudentId === 'all' ? 'platform average' : 'student-specific stats'}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            icon={ClipboardList}
            label="Eligible Contests"
            value={metrics.eligible}
            sub={selectedBatch || 'All batches'}
            colorClass="text-slate-600 dark:text-slate-300"
            bgClass="bg-slate-100 dark:bg-slate-800"
          />
          <StatCard
            icon={CheckCircle2}
            label={selectedStudentId === 'all' ? 'Average Contests Attended' : 'Contests Attended'}
            value={metrics.attended}
            sub="Past contests"
            colorClass="text-emerald-600 dark:text-emerald-450"
            bgClass="bg-emerald-50 dark:bg-emerald-950/40"
          />
          <StatCard
            icon={AlertCircle}
            label={selectedStudentId === 'all' ? 'Average Contests Missed' : 'Contests Missed'}
            value={metrics.missed}
            sub="Past contests"
            colorClass="text-rose-600 dark:text-rose-400"
            bgClass="bg-rose-50 dark:bg-rose-950/40"
          />
          <StatCard
            icon={Target}
            label={selectedStudentId === 'all' ? 'Student Attendance Rate' : 'Attendance Rate'}
            value={metrics.eligible > 0 ? `${metrics.rate}%` : 'N/A'}
            sub="Average %"
            colorClass={style.text}
            bgClass={style.bgMuted}
          />
          <StatCard
            icon={Activity}
            label="Ongoing Contests"
            value={metrics.ongoing}
            sub="Active now"
            colorClass="text-amber-500"
            bgClass="bg-amber-50 dark:bg-amber-950/40"
          />
          <StatCard
            icon={Trophy}
            label="Active Platform"
            value={activePlatform === 'leetcode' ? 'LeetCode' : activePlatform === 'codechef' ? 'CodeChef' : 'Codeforces'}
            sub="View selected"
            colorClass={style.text}
            bgClass={style.bgMuted}
          />
        </div>
      </div>

      {/* ── FILTER TOOLBAR ── */}
      <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 p-3.5 rounded-2xl shadow-sm">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 flex items-center gap-1">
          <Filter className="h-3 w-3" /> Filters
        </span>

        {/* Student Search and select */}
        <div className="relative shrink-0 w-full sm:w-60">
          <Search className="absolute inset-y-0 left-3 my-auto h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search student by name/roll..."
            value={studentSearch}
            onChange={e => setStudentSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 py-2 pl-8 pr-3 text-xs outline-none focus:border-primary-400 dark:text-white placeholder:text-slate-400 transition-colors"
          />
        </div>

        {/* Student Dropdown */}
        <div className="relative flex-1 min-w-[200px]">
          <Users className="absolute inset-y-0 left-3 my-auto h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <select
            value={selectedStudentId}
            onChange={e => setSelectedStudentId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 py-2 pl-8 pr-3 text-xs font-semibold outline-none focus:border-primary-400 dark:text-slate-200 transition-colors appearance-none"
          >
            <option value="all">All Students (Batch Overview)</option>
            {filteredStudents.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.roll_no})</option>
            ))}
          </select>
        </div>

        {/* Batch Filter */}
        <div className="relative shrink-0">
          <Filter className="absolute inset-y-0 left-3 my-auto h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <select
            value={selectedBatch}
            onChange={e => setSelectedBatch(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 py-2 pl-8 pr-3 text-xs font-semibold outline-none focus:border-primary-400 dark:text-slate-200 transition-colors appearance-none"
          >
            <option value="">All Batches</option>
            {(() => {
              console.log('[Contests Academic Years Audit]', availableBatches);
              const years = [...new Set(availableBatches)];
              return years.map(b => <option key={b} value={b}>{b}</option>);
            })()}
          </select>
        </div>

        {/* Contest Type (Dynamic options based on platform) */}
        <div className="relative shrink-0">
          <BarChart3 className="absolute inset-y-0 left-3 my-auto h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 py-2 pl-8 pr-3 text-xs font-semibold outline-none focus:border-primary-400 dark:text-slate-200 transition-colors appearance-none"
          >
            <option value="">All Types</option>
            {activePlatform === 'leetcode' && (
              <>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
              </>
            )}
            {activePlatform === 'codechef' && (
              <>
                <option value="starters">Starters</option>
                <option value="cook-off">Cook-Off</option>
                <option value="lunchtime">Lunchtime</option>
                <option value="long challenge">Long Challenge</option>
              </>
            )}
            {activePlatform === 'codeforces' && (
              <>
                <option value="div1">Div 1</option>
                <option value="div2">Div 2</option>
                <option value="div3">Div 3</option>
                <option value="div4">Div 4</option>
                <option value="educational">Educational</option>
                <option value="global">Global</option>
              </>
            )}
          </select>
        </div>

        {/* Status Filter */}
        <div className="relative shrink-0">
          <Filter className="absolute inset-y-0 left-3 my-auto h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 py-2 pl-8 pr-3 text-xs font-semibold outline-none focus:border-primary-400 dark:text-slate-200 transition-colors appearance-none"
          >
            <option value="">All Statuses</option>
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="unrated">Unrated</option>
            <option value="ongoing">Ongoing</option>
          </select>
        </div>

        {/* Divider */}
        <div className="h-7 w-px bg-slate-200 dark:bg-slate-700 shrink-0 hidden sm:block" />

        {/* Toggle Charts */}
        <button
          onClick={() => setShowAnalyticsPanel(p => !p)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${
            showAnalyticsPanel
              ? `bg-primary-50 ${style.text} ${style.border} dark:bg-slate-800`
              : 'bg-white text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800'
          }`}
        >
          <TrendingUp className="h-3.5 w-3.5" />
          {showAnalyticsPanel ? 'Hide Charts' : 'Analytics'}
        </button>

        {/* Export */}
        <button
          onClick={handleExportReport}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-450 text-xs font-bold transition-all shadow-sm shrink-0 border border-emerald-100 dark:border-emerald-900/30"
        >
          <Download className="h-3.5 w-3.5" /> Export
        </button>

        {/* Sync / Refresh */}
        <button
          onClick={handleSyncPlatformData}
          disabled={syncingPlatform}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-sm shrink-0 border ${
            syncingPlatform 
              ? 'bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700 cursor-not-allowed'
              : `bg-white hover:bg-slate-50 ${style.text} ${style.border} dark:bg-slate-900 dark:hover:bg-slate-800`
          }`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncingPlatform ? 'animate-spin' : ''}`} />
          {syncingPlatform ? 'Syncing...' : 'Sync'}
        </button>
      </div>

      {/* ── ANALYTICS PANEL ── */}
      {showAnalyticsPanel && (
        <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm animate-fade-in space-y-6">
          
          {/* Header block with tab selector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
            <h3 className="text-xs font-extrabold text-slate-700 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className={`h-4 w-4 ${style.text}`} />
              Academic Participation Analytics
            </h3>
            <div className="flex rounded-xl bg-slate-50 dark:bg-slate-800/60 p-1 border border-slate-100 dark:border-slate-700/60 gap-0.5">
              {[
                { id: 'trend', label: 'Monthly Trend' },
                { id: 'semester', label: 'Semester Analytics' },
                { id: 'batch', label: 'Batch Comparison' },
                { id: 'history', label: 'Contest History' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveAnalyticsTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                    activeAnalyticsTab === tab.id
                      ? `${style.bg} text-white shadow-sm`
                      : 'text-slate-550 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Side Chart/Table Block (2/3 width) */}
            <div className="lg:col-span-2 space-y-2">
              {activeAnalyticsTab === 'trend' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Monthly Attendance Rate %</span>
                    <span className="text-[10px] text-slate-400 font-semibold italic">Showing last {monthlyTrendData.length} months</span>
                  </div>
                  <div className="h-60 w-full bg-slate-50/20 dark:bg-slate-900/10 rounded-xl border border-slate-150 dark:border-slate-800 p-2">
                    {metrics.eligible === 0 || monthlyTrendData.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 dark:text-slate-500">
                        <BarChart3 className="h-8 w-8 mb-2 text-slate-350 dark:text-slate-600" />
                        <p className="text-sm font-bold">No analytics available yet.</p>
                        <p className="text-[11px] mt-0.5">Analytics will appear after more contests are completed.</p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={monthlyTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={style.chartColor} stopOpacity={0.2}/>
                              <stop offset="95%" stopColor={style.chartColor} stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" className="dark:stroke-slate-800/60" />
                          <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                          <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} domain={[0, 100]} />
                          <RechartsTooltip content={<CustomTooltip />} />
                          <Area type="monotone" dataKey="rate" stroke={style.chartColor} fillOpacity={1} fill="url(#colorRate)" strokeWidth={2.5} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              )}

              {activeAnalyticsTab === 'semester' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Semester-wise Attendance Trend %</span>
                    <span className="text-[10px] text-slate-400 font-semibold italic">8-Semester tracking matrix</span>
                  </div>
                  <div className="h-60 w-full bg-slate-50/20 dark:bg-slate-900/10 rounded-xl border border-slate-150 dark:border-slate-800 p-2">
                    {metrics.eligible === 0 || semesterAnalyticsData.filter(s => s.total > 0).length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 dark:text-slate-500">
                        <BarChart3 className="h-8 w-8 mb-2 text-slate-350 dark:text-slate-600" />
                        <p className="text-sm font-bold">No analytics available yet.</p>
                        <p className="text-[11px] mt-0.5">Analytics will appear after more contests are completed.</p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={semesterAnalyticsData} margin={{ top: 10, right: 5, left: -25, bottom: 0 }} barSize={16}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" className="dark:stroke-slate-800/60" />
                          <XAxis dataKey="semester" stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                          <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} domain={[0, 100]} />
                          <RechartsTooltip content={<CustomTooltip />} />
                          <Bar dataKey="rate" fill={style.chartColor} radius={[4, 4, 0, 0]}>
                            {semesterAnalyticsData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={style.chartColor} opacity={entry.rate > 0 ? 0.95 : 0.25} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              )}

              {activeAnalyticsTab === 'batch' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Comparative Batch Metrics</span>
                    <span className="text-[10px] text-slate-400 font-semibold italic">Cohort analysis</span>
                  </div>
                  {metrics.eligible === 0 || batchComparisonData.length === 0 ? (
                    <div className="h-44 w-full bg-slate-50/20 dark:bg-slate-900/10 rounded-xl border border-slate-150 dark:border-slate-800 p-2 flex flex-col items-center justify-center text-center text-slate-400 dark:text-slate-500">
                      <BarChart3 className="h-8 w-8 mb-2 text-slate-350 dark:text-slate-600" />
                      <p className="text-sm font-bold">No analytics available yet.</p>
                      <p className="text-[11px] mt-0.5">Analytics will appear after more contests are completed.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Bar Chart comparing attendance */}
                      <div className="h-44 bg-slate-50/20 dark:bg-slate-900/10 rounded-xl border border-slate-150 dark:border-slate-800 p-2">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={batchComparisonData} margin={{ top: 10, right: 5, left: -20, bottom: 0 }} barSize={32}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" className="dark:stroke-slate-800/60" />
                            <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} domain={[0, 100]} />
                            <RechartsTooltip content={<CustomTooltip />} />
                            <Bar dataKey="attendance" fill={style.chartColor} radius={[4, 4, 0, 0]} name="Avg Attendance" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Table overview */}
                      <div className="border border-slate-150 dark:border-slate-800 rounded-xl overflow-hidden text-xs bg-slate-50/10 dark:bg-slate-900/5">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-850 font-bold text-slate-550">
                              <th className="py-2.5 px-3">Batch</th>
                              <th className="py-2.5 px-3 text-right">Participants</th>
                              <th className="py-2.5 px-3 text-right">Avg Rating</th>
                              <th className="py-2.5 px-3 text-right">Avg Attendance</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 dark:divide-slate-850/50">
                            {batchComparisonData.map(b => (
                              <tr key={b.name} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                                <td className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-300">{b.name}</td>
                                <td className="py-2.5 px-3 text-right font-medium text-slate-505">{b.participants}</td>
                                <td className="py-2.5 px-3 text-right font-bold text-indigo-650 dark:text-indigo-400">{b.rating}</td>
                                <td className="py-2.5 px-3 text-right font-extrabold text-cyan-600 dark:text-cyan-400">{b.attendance}%</td>
                              </tr>
                            ))}
                            {selectedStudentId !== 'all' && selectedStudentInfo && (
                              <tr className={`bg-primary-50/20 dark:bg-primary-950/15 border-t ${style.borderMuted}`}>
                                <td className={`py-2.5 px-3 font-extrabold ${style.text} flex items-center gap-1`}>
                                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.bg} shrink-0`} />
                                  {selectedStudentInfo.name.split(' ')[0]} (You)
                                </td>
                                <td className="py-2.5 px-3 text-right text-slate-400 dark:text-slate-500 font-medium">—</td>
                                <td className={`py-2.5 px-3 text-right font-extrabold ${style.text}`}>
                                  {studentSummaries.find(s => s.id === parseInt(selectedStudentId))?.current_rating || 0}
                                </td>
                                <td className={`py-2.5 px-3 text-right font-extrabold ${style.text}`}>
                                  {metrics.eligible > 0 ? `${metrics.rate}%` : '--'}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeAnalyticsTab === 'history' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Contest Participation History</span>
                    <span className="text-[10px] text-slate-400 font-semibold italic">{filteredContestsByBatch.length} past contests during academic period</span>
                  </div>
                  <div className="border border-slate-150 dark:border-slate-800 rounded-xl overflow-hidden text-xs max-h-56 overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-850 font-bold text-slate-500 sticky top-0 z-10">
                          <th className="py-2 px-4">Contest Name</th>
                          <th className="py-2 px-3">Date</th>
                          <th className="py-2 px-3">Type</th>
                          <th className="py-2 px-4 text-right">Attendance Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 dark:divide-slate-850/50">
                        {filteredContestsByBatch.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="text-center py-10 text-slate-400 italic">No historical contests found.</td>
                          </tr>
                        ) : (
                          filteredContestsByBatch.map(c => {
                            const isPresent = selectedStudentId === 'all'
                              ? c.attendance_count > 0
                              : c.is_joined || normalizeAttendanceStatus(c.attendance_status) === 'PRESENT';
                            return (
                              <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                                <td className="py-2 px-4 font-semibold text-slate-700 dark:text-slate-300">{c.name}</td>
                                <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                                  {new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </td>
                                <td className="py-2 px-3 uppercase tracking-wide font-extrabold text-[9px]">
                                  <TypeBadge type={c.type} />
                                </td>
                                <td className="py-2 px-4 text-right font-extrabold text-[10px]">
                                  {selectedStudentId === 'all' ? (
                                    <span className="text-slate-600 dark:text-slate-400">{c.attendance_count} / {c.registration_count} present</span>
                                  ) : (
                                    <span className={isPresent ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-lg' : 'text-rose-500 bg-rose-50 dark:bg-rose-950/20 px-2 py-0.5 rounded-lg'}>
                                      {isPresent ? 'Present' : 'Absent'}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Right Side Platform Breakdown Card (1/3 width) */}
            <div className="lg:col-span-1">
              <div className="rounded-xl border border-slate-150 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-900/10 p-5 space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                  <Calendar className={`h-4.5 w-4.5 ${style.text}`} />
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                    {activePlatform === 'leetcode' ? 'LeetCode' : activePlatform === 'codechef' ? 'CodeChef' : 'Codeforces'} Category Analysis
                  </span>
                </div>

                {platformBreakdowns.map((item, idx) => {
                  let progressColor = style.bg;
                  let textColor = style.text;
                  if (activePlatform === 'leetcode') {
                    progressColor = idx === 0 ? "bg-orange-500" : "bg-purple-500";
                    textColor = idx === 0 ? "text-orange-600 dark:text-orange-400" : "text-purple-600 dark:text-purple-400";
                  }

                  return (
                    <div key={item.label} className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700 dark:text-slate-300">{item.label}</span>
                        <span className={`font-extrabold ${textColor}`}>{item.rate !== null ? `${item.rate}%` : 'N/A'}</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-300 ${progressColor}`} style={{ width: `${item.rate !== null ? item.rate : 0}%` }} />
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[10px] text-center font-bold mt-1 text-slate-400">
                        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 py-1 rounded-lg">
                          <span className="block text-slate-700 dark:text-slate-300 text-xs font-black">{item.eligible}</span>
                          Eligible
                        </div>
                        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 py-1 rounded-lg">
                          <span className="block text-emerald-600 dark:text-emerald-450 text-xs font-black">{item.attended}</span>
                          Attended
                        </div>
                        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 py-1 rounded-lg">
                          <span className="block text-rose-500 dark:text-rose-455 text-xs font-black">{item.missed}</span>
                          Missed
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RECENT ACTIVITY BANNER ── */}
      {selectedStudentId !== 'all' && recentActivity.length > 0 && (
        <div className="bg-gradient-to-r from-slate-50 to-slate-50/60 dark:from-slate-900/60 dark:to-slate-900/40 border border-slate-200/60 dark:border-slate-800/80 rounded-2xl p-4 shadow-sm animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <Activity className={`h-3.5 w-3.5 ${style.text} animate-pulse`} />
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400">Recent Activity</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentActivity.map((c) => (
              <div key={c.id} className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-xl px-3 py-2 shadow-sm text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[140px]">{c.name}</span>
                <AttendanceBadge contest={c} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CONTEST TABLE ── */}
      <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        {/* Table header bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-slate-400" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
              Contest Records
            </span>
            {filteredContestsByBatch.length > 0 && (
              <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2.5 py-0.5 rounded-full ml-1">
                {filteredContestsByBatch.length}
              </span>
            )}
          </div>
          {selectedStudentInfo && (
            <div className="flex items-center gap-3">
              {platformRanking && (
                <div className={`flex items-center gap-2.5 ${style.bgMuted} border ${style.borderMuted} px-3 py-1.5 rounded-xl text-[10px] font-bold ${style.text}`}>
                  <span>Rating: <span className="font-extrabold">{platformRanking.rating}</span></span>
                  {platformRanking.globalRanking && (
                    <>
                      <span className="opacity-40">|</span>
                      <span>Rank: <span className="font-extrabold">#{platformRanking.globalRanking}</span></span>
                    </>
                  )}
                  {platformRanking.rank && (
                    <>
                      <span className="opacity-40">|</span>
                      <span>Rank: <span className="font-extrabold">{platformRanking.rank}</span></span>
                    </>
                  )}
                  {platformRanking.maxRank && (
                    <>
                      <span className="opacity-40">|</span>
                      <span>Max Rank: <span className="font-extrabold">{platformRanking.maxRank}</span></span>
                    </>
                  )}
                </div>
              )}
              <div className={`flex items-center gap-1.5 ${style.bgMuted} border ${style.borderMuted} px-3 py-1.5 rounded-xl`}>
                <Users className={`h-3 w-3 ${style.text}`} />
                <span className={`text-[10px] font-bold ${style.text}`}>{selectedStudentInfo.name} · {selectedStudentInfo.roll_no}</span>
              </div>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest bg-white dark:bg-slate-900 sticky top-0 z-10">
                <th className="px-5 py-3.5 pl-6">Contest Name</th>
                <th className="px-5 py-3.5">Type</th>
                <th className="px-5 py-3.5">Date</th>
                {selectedStudentId === 'all' ? (
                  <>
                    <th className="px-5 py-3.5">Registrations</th>
                    <th className="px-5 py-3.5">Attended</th>
                    <th className="px-5 py-3.5">Rate</th>
                  </>
                ) : (
                  <>
                    <th className="px-5 py-3.5">Attendance</th>
                    <th className="px-5 py-3.5">Status</th>
                  </>
                )}
                <th className="px-5 py-3.5">Batch</th>
                <th className="px-5 py-3.5 text-right pr-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className={`h-8 w-8 animate-spin rounded-full border-2 ${style.text} border-t-transparent`} />
                      <span className="text-xs text-slate-400 font-medium">Loading contests…</span>
                    </div>
                  </td>
                </tr>
              ) : filteredContestsByBatch.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-12 w-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                        <ClipboardList className="h-6 w-6 text-slate-300 dark:text-slate-600" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-500 dark:text-slate-400">No contest records available</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                          {selectedBatch ? `No contests found for batch ${selectedBatch}.` : 'Try adjusting your filters.'}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedContests.map((c) => {
                  const timing = getContestTiming(c.date, c.duration || 5400);
                  const isExpanded = expandedContestId === c.id;
                  const rate = c.registration_count > 0
                    ? Math.round((c.attendance_count / c.registration_count) * 100) : 0;

                  return (
                    <React.Fragment key={c.id}>
                      <tr className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors duration-150 ${isExpanded ? `${style.bgMuted}` : ''}`}>
                        {/* Contest Name */}
                        <td className="px-5 py-3.5 pl-6">
                          <div className="flex items-center gap-2">
                            {timing === 'active' && (
                              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                            )}
                            <span className="font-bold text-slate-800 dark:text-slate-100 text-xs">{c.name}</span>
                          </div>
                        </td>

                        {/* Type */}
                        <td className="px-5 py-3.5">
                          <TypeBadge type={c.type} />
                        </td>

                        {/* Date */}
                        <td className="px-5 py-3.5">
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                          <span className="block text-[10px] text-slate-400">
                            {new Date(c.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </td>

                        {/* Batch Overview Columns */}
                        {selectedStudentId === 'all' ? (
                          <>
                            <td className="px-5 py-3.5">
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{c.registration_count}</span>
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{c.attendance_count}</span>
                            </td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${rate >= 75 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-400' : 'bg-rose-500'}`}
                                    style={{ width: `${rate}%` }}
                                  />
                                </div>
                                <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">{rate}%</span>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-5 py-3.5"><AttendanceBadge contest={c} /></td>
                            <td className="px-5 py-3.5"><TimingBadge timing={timing} /></td>
                          </>
                        )}

                        {/* Batch */}
                        <td className="px-5 py-3.5">
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg">
                            {selectedStudentInfo ? selectedStudentInfo.academic_batch : (selectedBatch || 'All')}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-3.5 pr-6">
                          <div className="flex items-center justify-end gap-1.5">
                            {!adminMode && (
                              <>
                                <button
                                  onClick={() => handleToggleExpand(c.id)}
                                  className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
                                >
                                  <Eye className="h-3 w-3" />
                                  {isExpanded ? 'Hide' : 'Details'}
                                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                </button>

                                {selectedStudentId === 'all' ? (
                                  <a
                                    href={`/attendance?contestId=${c.id}`}
                                    className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg ${style.bgMuted} ${style.text} hover:bg-opacity-80 transition-all border ${style.borderMuted}`}
                                  >
                                    <Users className="h-3 w-3" /> Participants
                                  </a>
                                ) : (
                                  <>
                                    {timing === 'upcoming' && !c.is_registered && (
                                      <button
                                        onClick={() => handleRegister(c.id)}
                                        className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border ${style.border} ${style.text} hover:${style.bgMuted} transition-all`}
                                      >
                                        Register
                                      </button>
                                    )}
                                    {timing === 'active' && !c.is_joined && (
                                      <button
                                        onClick={() => handleJoin(c.id)}
                                        className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg ${style.bg} text-white hover:opacity-90 transition-all shadow-sm`}
                                      >
                                        Join Now
                                      </button>
                                    )}
                                    {timing === 'past' && c.status?.toLowerCase() !== 'unrated' && c.contest_status?.toLowerCase() !== 'unrated' && normalizeAttendanceStatus(c.attendance_status) !== 'UNRATED' && (
                                      <button
                                        onClick={() => openOverride(c)}
                                        className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                                          c.is_joined || normalizeAttendanceStatus(c.attendance_status) === 'PRESENT'
                                            ? 'border-rose-200 text-rose-600 hover:bg-rose-50/30 dark:border-rose-900/30 dark:text-rose-400'
                                            : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50/30 dark:border-emerald-900/30 dark:text-emerald-400'
                                        }`}
                                      >
                                        Override
                                      </button>
                                    )}
                                  </>
                                )}
                              </>
                            )}

                            {adminMode && (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => openEditModal(c)}
                                  className={`p-1.5 rounded-lg text-slate-400 hover:${style.text} hover:${style.bgMuted} transition-all`}
                                  title="Edit Contest"
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteContest(c.id)}
                                  className="p-1.5 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/25 transition-all"
                                  title="Delete Contest"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* ── Expanded Detail Drawer ── */}
                      {isExpanded && (
                        <tr className="bg-slate-50/70 dark:bg-slate-800/20">
                          <td colSpan={8} className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                            <div className="animate-fade-in space-y-4">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Contest Summary Details</span>
                                <span className="text-[10px] text-slate-400 font-mono bg-slate-100 dark:bg-slate-850 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800">
                                  Slug: <span className="font-bold text-slate-600 dark:text-slate-300">{c.contest_id}</span>
                                </span>
                              </div>

                              {(contestParticipants[c.id]?.validationStatus === 'FAILED' || contestParticipants[c.id]?.validationStatus === 'INVALID_METRICS') && (
                                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-250 dark:border-amber-900/60 rounded-xl text-xs text-amber-750 dark:text-amber-400 font-bold flex items-center gap-2">
                                  <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                                  <span>⚠ Contest data partially invalid: {contestParticipants[c.id].validationIssues?.join(', ')}</span>
                                </div>
                              )}

                              {selectedStudentId === 'all' ? (
                                <div className="space-y-6">
                                  {loadingParticipants[c.id] ? (
                                    <div className="flex justify-center py-6"><Loader2 className={`h-6 w-6 animate-spin ${style.text}`} /></div>
                                  ) : !contestParticipants[c.id] ? (
                                    <p className="text-xs text-slate-400 italic">No participation records loaded.</p>
                                  ) : (
                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                      {/* 1. Attended Students Table */}
                                      <div className="space-y-2.5">
                                        <h5 className="text-[11px] font-extrabold text-emerald-600 dark:text-emerald-450 uppercase tracking-wider flex items-center gap-1.5">
                                          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                          Attended Students ({contestParticipants[c.id].attended?.length || 0})
                                        </h5>
                                        <div className="border border-slate-200/60 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-900 text-xs">
                                          <div className="overflow-x-auto max-h-72">
                                            <table className="w-full text-left border-collapse">
                                              <thead>
                                                <tr className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 font-extrabold text-[9px] uppercase tracking-wider text-slate-400">
                                                  <th className="py-2.5 px-3">Student / Roll</th>
                                                  <th className="py-2.5 px-3">Username</th>
                                                  <th className="py-2.5 px-3 text-right">Rank</th>
                                                  {activePlatform === 'leetcode' && <th className="py-2.5 px-3 text-right">Solved</th>}
                                                  <th className="py-2.5 px-3 text-right">Rating Change</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
                                                {!contestParticipants[c.id].attended || contestParticipants[c.id].attended.length === 0 ? (
                                                  <tr>
                                                    <td colSpan={activePlatform === 'leetcode' ? 5 : 4} className="py-8 text-center text-slate-450 italic">No students attended.</td>
                                                  </tr>
                                                ) : (
                                                  contestParticipants[c.id].attended.map(p => (
                                                    <tr key={p.student_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                                                      <td className="py-2.5 px-3">
                                                        <span className="font-bold text-slate-800 dark:text-slate-200 block">{p.name}</span>
                                                        <span className="text-[9px] text-slate-400 font-mono">{p.register_number}</span>
                                                      </td>
                                                      <td className="py-2.5 px-3 font-semibold text-slate-500 dark:text-slate-400">
                                                        {activePlatform === 'leetcode' && p.platform_username ? (
                                                          <a 
                                                            href={getLeetCodeProfileUrl(p.platform_username)}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="text-primary-500 hover:underline"
                                                          >
                                                            {p.platform_username}
                                                          </a>
                                                        ) : (
                                                          p.platform_username || '—'
                                                        )}
                                                      </td>
                                                      <td className="py-2.5 px-3 text-right font-black text-slate-700 dark:text-slate-300">
                                                        {p.contest_rank ? `#${p.contest_rank}` : '—'}
                                                      </td>
                                                      {activePlatform === 'leetcode' && (
                                                        <td className="py-2.5 px-3 text-right font-bold text-slate-650 dark:text-slate-400">
                                                          {p.contest_rank != null
                                                            ? `${p.problems_solved}/${p.total_problems || 4} (${p.contest_score || 0} pts)`
                                                            : '—'}
                                                        </td>
                                                      )}
                                                      <td className="py-2.5 px-3 text-right font-extrabold">
                                                        {p.rating_change > 0 ? (
                                                          <span className="text-emerald-600">+{p.rating_change}</span>
                                                        ) : p.rating_change < 0 ? (
                                                          <span className="text-rose-500">{p.rating_change}</span>
                                                        ) : (
                                                          <span className="text-slate-400">0</span>
                                                        )}
                                                      </td>
                                                    </tr>
                                                  ))
                                                )}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      </div>

                                      {/* 2. Missed Students Table */}
                                      <div className="space-y-2.5">
                                        <h5 className="text-[11px] font-extrabold text-rose-600 dark:text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                                          <span className="h-2 w-2 rounded-full bg-rose-500" />
                                          Missed Students ({contestParticipants[c.id].missed?.length || 0})
                                        </h5>
                                        <div className="border border-slate-200/60 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-900 text-xs">
                                          <div className="overflow-x-auto max-h-72">
                                            <table className="w-full text-left border-collapse">
                                              <thead>
                                                <tr className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 font-extrabold text-[9px] uppercase tracking-wider text-slate-400">
                                                  <th className="py-2.5 px-3">Student / Roll</th>
                                                  <th className="py-2.5 px-3">Batch</th>
                                                  <th className="py-2.5 px-3">Username</th>
                                                  <th className="py-2.5 px-3 text-right">Reason</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
                                                {!contestParticipants[c.id].missed || contestParticipants[c.id].missed.length === 0 ? (
                                                  <tr>
                                                    <td colSpan={4} className="py-8 text-center text-slate-450 italic">No students missed this contest.</td>
                                                  </tr>
                                                ) : (
                                                  contestParticipants[c.id].missed.map(p => (
                                                    <tr key={p.student_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                                                      <td className="py-2.5 px-3">
                                                        <span className="font-bold text-slate-800 dark:text-slate-200 block">{p.name}</span>
                                                        <span className="text-[9px] text-slate-400 font-mono">{p.register_number}</span>
                                                      </td>
                                                      <td className="py-2.5 px-3 font-semibold text-slate-500">{p.academic_year}</td>
                                                      <td className="py-2.5 px-3 font-semibold text-slate-500 dark:text-slate-400">
                                                        {activePlatform === 'leetcode' && p.platform_username ? (
                                                          <a 
                                                            href={getLeetCodeProfileUrl(p.platform_username)}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="text-primary-500 hover:underline"
                                                          >
                                                            {p.platform_username}
                                                          </a>
                                                        ) : (
                                                          p.platform_username || '—'
                                                        )}
                                                      </td>
                                                      <td className="py-2.5 px-3 text-right">
                                                        <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[9px] font-extrabold border ${
                                                          p.reason === 'Username Not Linked'
                                                            ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400'
                                                            : p.reason === 'Not Registered'
                                                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-450'
                                                            : 'bg-slate-50 text-slate-650 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                                        }`}>
                                                          {p.reason}
                                                        </span>
                                                      </td>
                                                    </tr>
                                                  ))
                                                )}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    {[
                                      { label: '1. Registration Status', value: c.is_registered ? 'Registered ✓' : 'Not Registered', sub: c.is_registered ? 'Crawler verified' : '—', ok: c.is_registered },
                                      { label: '2. Participation Action', value: c.is_joined ? 'Joined ✓' : 'No activity logged', sub: c.is_joined ? 'Contest action detected' : '—', ok: c.is_joined },
                                      { label: '3. Final Attendance', value: normalizeAttendanceStatus(c.attendance_status) === 'PRESENT' ? 'PRESENT' : 'ABSENT', sub: c.attendance_source === 'MANUAL' ? 'Manual override by Faculty' : 'Automatic platform sync', ok: normalizeAttendanceStatus(c.attendance_status) === 'PRESENT' },
                                    ].map((item, i) => (
                                      <div key={i} className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-700/60 p-3 rounded-xl shadow-sm">
                                        <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1">{item.label}</span>
                                        <span className={`text-xs font-black ${item.ok ? 'text-emerald-600' : 'text-rose-500'}`}>{item.value}</span>
                                        <span className="text-[10px] text-slate-450 block mt-0.5 font-medium">{item.sub}</span>
                                      </div>
                                    ))}
                                  </div>

                                  {/* Performance Stats Sub-card */}
                                  {(c.rating !== null || c.global_rank !== null || c.problems_solved !== null) && (
                                    <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-700/60 p-4 rounded-xl shadow-sm space-y-2">
                                      <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block border-b pb-1">Performance Details</span>
                                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                                        {c.rating !== null && (
                                          <div>
                                            <span className="text-[10px] text-slate-400 block font-bold">New Rating</span>
                                            <span className={`font-extrabold ${style.text}`}>{c.rating}</span>
                                          </div>
                                        )}
                                        {c.rating_change !== null && c.rating_change !== 0 && (
                                          <div>
                                            <span className="text-[10px] text-slate-400 block font-bold">Rating Change</span>
                                            <span className={`font-extrabold ${c.rating_change >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                              {c.rating_change >= 0 ? `+${c.rating_change}` : c.rating_change}
                                            </span>
                                          </div>
                                        )}
                                        {c.global_rank !== null && (
                                          <div>
                                            <span className="text-[10px] text-slate-400 block font-bold">Rank</span>
                                            <span className="font-extrabold text-slate-700 dark:text-slate-200">#{c.global_rank}</span>
                                          </div>
                                        )}
                                        {c.problems_solved !== null && (
                                          <div>
                                            <span className="text-[10px] text-slate-400 block font-bold">Solved</span>
                                            <span className="font-extrabold text-slate-700 dark:text-slate-200">{c.problems_solved} / {c.total_problems || 4} ({c.contest_score || 0} pts)</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
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

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 px-5 py-3.5">
            <span className="text-[11px] font-semibold text-slate-500">
              Showing <span className="font-extrabold text-slate-700 dark:text-slate-200">{(currentPage - 1) * itemsPerPage + 1}</span>
              –<span className="font-extrabold text-slate-700 dark:text-slate-200">{Math.min(currentPage * itemsPerPage, filteredContestsByBatch.length)}</span>
              {' '}of <span className="font-extrabold text-slate-700 dark:text-slate-200">{filteredContestsByBatch.length}</span> contests
            </span>
            <div className="flex items-center gap-1.5">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => p - 1)}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let page;
                if (totalPages <= 7) {
                  page = i + 1;
                } else if (currentPage <= 4) {
                  page = i + 1;
                } else if (currentPage >= totalPages - 3) {
                  page = totalPages - 6 + i;
                } else {
                  page = currentPage - 3 + i;
                }
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                      currentPage === page
                        ? `${style.bg} text-white ${style.border} shadow-sm`
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-650 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}

              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => p + 1)}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRightIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════
          MANUAL ATTENDANCE OVERRIDE MODAL
      ══════════════════════════════════════════════════════ */}
      {showOverrideModal && overrideContest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-750 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between mb-4 pb-2 border-b">
              <h3 className="text-sm font-extrabold text-slate-800 dark:text-white uppercase tracking-wider">Attendance Override</h3>
              <button onClick={() => setShowOverrideModal(false)} className="p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleOverrideSubmit} className="space-y-4">
              <div className="bg-slate-50 dark:bg-slate-850 p-3.5 rounded-xl border">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wide">Contest</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-205">{overrideContest.name}</span>
                <span className="text-[10px] text-slate-400 block mt-1">Student: {selectedStudentInfo?.name} ({selectedStudentInfo?.roll_no})</span>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest block">Status</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOverrideStatus('present')}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border ${
                      overrideStatus === 'present'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/20'
                        : 'bg-white border-slate-200 text-slate-500'
                    }`}
                  >
                    ✓ PRESENT
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverrideStatus('absent')}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border ${
                      overrideStatus === 'absent'
                        ? 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/20'
                        : 'bg-white border-slate-200 text-slate-500'
                    }`}
                  >
                    🔴 ABSENT
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest block">Remarks</label>
                <textarea
                  required
                  value={overrideRemarks}
                  onChange={(e) => setOverrideRemarks(e.target.value)}
                  placeholder="e.g. Medical certificate verified, participated on secondary laptop..."
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-xs outline-none focus:border-primary-400 dark:text-white resize-none"
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button type="button" onClick={() => setShowOverrideModal(false)} className="rounded-xl border px-4 py-2 text-xs font-bold text-slate-500">Cancel</button>
                <button type="submit" disabled={savingOverride} className={`rounded-xl ${style.bg} text-white px-5 py-2 text-xs font-bold shadow-md hover:opacity-90 flex items-center gap-1.5`}>
                  {savingOverride ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ADD / EDIT CONTEST MODAL
      ══════════════════════════════════════════════════════ */}
      {isOpenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-slate-800 dark:text-white">
                {modalMode === 'add' ? '➕ Create Contest' : '✏️ Edit Contest'}
              </h3>
              <button onClick={() => setIsOpenModal(false)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError && (
              <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 p-3 text-xs font-semibold text-rose-700 dark:text-rose-400 mb-4">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />{formError}
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Platform</label>
                <select name="platform" required value={formData.platform || activePlatform} onChange={handleInputChange}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm outline-none focus:border-primary-400 dark:text-slate-250">
                  <option value="leetcode">LeetCode</option>
                  <option value="codechef">CodeChef</option>
                  <option value="codeforces">Codeforces</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Contest ID (Slug)</label>
                <input type="text" name="contestId" required value={formData.contestId} onChange={handleInputChange}
                  placeholder="e.g. weekly-contest-390, codechef-starters-160, codeforces-2207"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm outline-none focus:border-primary-400 dark:text-white" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Contest Name</label>
                <input type="text" name="name" required value={formData.name} onChange={handleInputChange}
                  placeholder="e.g. Weekly Contest 390, CodeChef Starters 160..."
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm outline-none focus:border-primary-400 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Contest Date</label>
                  <input type="date" name="date" required value={formData.date} onChange={handleInputChange}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm outline-none focus:border-primary-400 dark:text-slate-200" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Contest Type</label>
                  <select name="type" required value={formData.type} onChange={handleInputChange}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm outline-none focus:border-primary-400 dark:text-slate-200">
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button type="button" onClick={() => setIsOpenModal(false)}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                  Cancel
                </button>
                <button type="submit" disabled={formLoading}
                  className={`rounded-xl ${style.bg} hover:opacity-90 disabled:opacity-50 text-white px-5 py-2 text-xs font-bold shadow-md shadow-primary-500/20 flex items-center gap-1.5`}>
                  {formLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save Contest'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Contests;
