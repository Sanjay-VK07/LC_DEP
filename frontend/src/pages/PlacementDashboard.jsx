import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api';
import { useAuth } from '../context/AuthContext';
import { 
  Briefcase, 
  Award, 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Download, 
  Search, 
  BookOpen, 
  TrendingUp, 
  Activity,
  ChevronRight,
  Filter
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend 
} from 'recharts';

function PlacementDashboard() {
  const { user } = useAuth();
  const isStudent = user?.role === 'Student';
  const targetStudentId = user?.studentId;

  // State for Student View
  const [studentData, setStudentData] = useState(null);
  const [studentLoading, setStudentLoading] = useState(isStudent);

  // State for Staff View
  const [overviewData, setOverviewData] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(!isStudent);
  const [filterDept, setFilterDept] = useState('');
  const [filterBatch, setFilterBatch] = useState('');
  const [searchText, setSearchText] = useState('');

  // Dropdown lists
  const [depts, setDepts] = useState([]);
  const [batches, setBatches] = useState([]);

  const [error, setError] = useState('');

  useEffect(() => {
    // Fetch departments and batches for staff filters
    if (!isStudent) {
      axios.get(`${API_URL}/departments`)
        .then(res => {
          if (res.data.success) setDepts(res.data.data);
        })
        .catch(err => console.error('Failed to load departments', err));

      axios.get(`${API_URL}/students/batches`)
        .then(res => {
          if (res.data.success) setBatches(res.data.data);
        })
        .catch(err => console.error('Failed to load batches', err));
    }
  }, [isStudent]);

  const fetchStudentData = async () => {
    if (!targetStudentId) return;
    setStudentLoading(true);
    try {
      const res = await axios.get(`${API_URL}/placement/student/${targetStudentId}`);
      if (res.data.success) {
        setStudentData(res.data.data);
      }
    } catch (err) {
      setError('Failed to fetch student placement insights.');
    } finally {
      setStudentLoading(false);
    }
  };

  const fetchOverviewData = async () => {
    setOverviewLoading(true);
    try {
      const params = {};
      if (filterDept) params.department = filterDept;
      if (filterBatch) params.academicBatch = filterBatch;

      const res = await axios.get(`${API_URL}/placement/overview`, { params });
      if (res.data.success) {
        setOverviewData(res.data);
      }
    } catch (err) {
      setError('Failed to fetch placement aggregates.');
    } finally {
      setOverviewLoading(false);
    }
  };

  useEffect(() => {
    if (isStudent) {
      fetchStudentData();
    } else {
      fetchOverviewData();
    }
  }, [isStudent, filterDept, filterBatch]);

  // Export to CSV
  const handleExportCSV = () => {
    if (!overviewData || !overviewData.students) return;

    const headers = ['Roll No', 'Name', 'Department', 'Section', 'Batch', 'Problems Solved', 'Readiness Score', 'Readiness Level', 'Tier 1 (FAANG)', 'Tier 2 (Product)', 'Tier 3 (Service)'];
    const rows = overviewData.students.map(s => [
      s.roll_no,
      s.name,
      s.department,
      s.section,
      s.academic_batch,
      s.totalSolved,
      s.overallScore,
      s.readinessLevel,
      s.companyPrep.tier1,
      s.companyPrep.tier2,
      s.companyPrep.tier3
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${val}"`).join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `placement_readiness_report_${filterDept || 'all'}_${filterBatch || 'all'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper colors & icons for company status
  const getPrepStatusBadge = (status) => {
    switch (status) {
      case 'Ready':
        return (
          <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-900/50">
            <CheckCircle className="h-3.5 w-3.5" /> Ready
          </span>
        );
      case 'Close':
        return (
          <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-900/50">
            <AlertTriangle className="h-3.5 w-3.5" /> Close
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-50 dark:bg-slate-950/30 dark:text-slate-400 px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-800">
            <XCircle className="h-3.5 w-3.5" /> Practice
          </span>
        );
    }
  };

  const getReadinessLevelBadge = (level) => {
    const classes = {
      Elite: 'text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-400 dark:bg-violet-950/30 dark:border-violet-900',
      High: 'text-primary-700 bg-primary-50 border-primary-200 dark:text-primary-400 dark:bg-primary-950/30 dark:border-primary-900',
      Moderate: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-900',
      'Needs Practice': 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-950/30 dark:border-rose-900'
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${classes[level] || classes['Needs Practice']}`}>
        {level}
      </span>
    );
  };

  if (isStudent) {
    if (studentLoading) {
      return (
        <div className="flex h-[60vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
        </div>
      );
    }

    if (!studentData) {
      return (
        <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
          <Briefcase className="mx-auto h-12 w-12 text-slate-400" />
          <h2 className="mt-4 text-xl font-bold text-slate-800 dark:text-white">Placement Details Unavailable</h2>
          <p className="mt-2 text-slate-500">Sync your coding profiles to unlock placement readiness analysis.</p>
        </div>
      );
    }

    const { student, overallScore, readinessLevel, companyPrep, consistency, skillMatrix } = studentData;

    return (
      <div className="space-y-6">
        {/* Header Hero Banner */}
        <div className="relative overflow-hidden rounded-3xl border border-primary-100 dark:border-primary-900/50 bg-gradient-to-r from-primary-600 to-indigo-600 p-6 text-white shadow-lg">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <span className="rounded-full bg-white/20 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur-md">
                PLACEMENT MATRIX
              </span>
              <h1 className="mt-3 text-3xl font-extrabold">{student.name}</h1>
              <p className="mt-1 text-primary-100 font-medium text-sm">
                Roll No: {student.roll_no} • {student.department} Section {student.section}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 flex flex-col items-center justify-center rounded-2xl bg-white/10 backdrop-blur-md border border-white/20">
                <span className="text-2xl font-extrabold">{overallScore}</span>
                <span className="text-[10px] uppercase font-bold text-primary-200">Score</span>
              </div>
              <div className="px-5 py-2.5 rounded-2xl bg-white text-slate-900 shadow-md">
                <span className="text-[10px] block font-bold uppercase tracking-wider text-slate-500">Readiness Category</span>
                <span className="text-lg font-extrabold text-indigo-600 uppercase">{readinessLevel}</span>
              </div>
            </div>
          </div>
          {/* Decorative shapes */}
          <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-white/5 blur-3xl -mr-20 -mt-20"></div>
        </div>

        {/* Grid split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Circular Readiness gauge & company prep */}
          <div className="lg:col-span-1 flex flex-col gap-6">
            {/* Readiness Card */}
            <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm flex flex-col items-center justify-center text-center">
              <h3 className="font-bold text-slate-800 dark:text-white text-sm uppercase tracking-wider mb-6">Readiness Gauge</h3>
              <div className="relative flex items-center justify-center h-44 w-44">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="88" cy="88" r="76" className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="12" fill="transparent" />
                  <circle cx="88" cy="88" r="76" className="stroke-primary-500" strokeWidth="12" fill="transparent"
                    strokeDasharray={2 * Math.PI * 76}
                    strokeDashoffset={2 * Math.PI * 76 * (1 - overallScore / 100)} />
                </svg>
                <div className="absolute flex flex-col items-center justify-center">
                  <span className="text-4xl font-extrabold text-slate-800 dark:text-white">{overallScore}%</span>
                  <span className="text-xs font-semibold text-slate-400">Ready Score</span>
                </div>
              </div>
              <p className="mt-4 text-xs font-medium text-slate-400 px-4">
                Your placement score is calculated dynamically based on rating milestones and problem coverage metrics.
              </p>
            </div>

            {/* Company targets */}
            <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-800 dark:text-white text-sm uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
                <Briefcase className="h-4.5 w-4.5 text-primary-500" /> Company Tier Prep
              </h3>
              
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950/30 rounded-2xl border border-slate-100 dark:border-slate-850">
                <div>
                  <h4 className="font-bold text-xs text-slate-800 dark:text-slate-200">Tier 1: FAANG / Top Product</h4>
                  <p className="text-[10px] text-slate-400">Google, Microsoft, Amazon</p>
                </div>
                {getPrepStatusBadge(companyPrep.tier1)}
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950/30 rounded-2xl border border-slate-100 dark:border-slate-850">
                <div>
                  <h4 className="font-bold text-xs text-slate-800 dark:text-slate-200">Tier 2: Mid-Product / Startups</h4>
                  <p className="text-[10px] text-slate-400">Zoho, Razorpay, Freshworks</p>
                </div>
                {getPrepStatusBadge(companyPrep.tier2)}
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950/30 rounded-2xl border border-slate-100 dark:border-slate-850">
                <div>
                  <h4 className="font-bold text-xs text-slate-800 dark:text-slate-200">Tier 3: Service-based Giants</h4>
                  <p className="text-[10px] text-slate-400">TCS, Infosys, Cognizant</p>
                </div>
                {getPrepStatusBadge(companyPrep.tier3)}
              </div>
            </div>
          </div>

          {/* Skill Matrix and Consistency */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            {/* Skill Matrix */}
            <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-5">
              <h3 className="font-bold text-slate-800 dark:text-white text-sm uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
                <Award className="h-4.5 w-4.5 text-indigo-500" /> Coding Skill Matrix
              </h3>

              {/* Easy/Medium/Hard Breakdown */}
              <div className="space-y-3.5">
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1 text-slate-500">
                    <span>LeetCode Easy Solved</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300">{skillMatrix.easySolved}</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${Math.min((skillMatrix.easySolved / 150) * 100, 100)}%` }}></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1 text-slate-500">
                    <span>LeetCode Medium Solved</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300">{skillMatrix.mediumSolved}</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-primary-500 h-full rounded-full" style={{ width: `${Math.min((skillMatrix.mediumSolved / 150) * 100, 100)}%` }}></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1 text-slate-500">
                    <span>LeetCode Hard Solved</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300">{skillMatrix.hardSolved}</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-rose-500 h-full rounded-full" style={{ width: `${Math.min((skillMatrix.hardSolved / 50) * 100, 100)}%` }}></div>
                  </div>
                </div>
              </div>

              {/* Platform breakdown */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-850">
                <h4 className="font-bold text-xs text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wide">Platform Solving Volume</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-50 dark:bg-slate-950/20 p-3 rounded-2xl text-center border border-slate-100 dark:border-slate-800">
                    <span className="text-lg font-extrabold text-slate-800 dark:text-white block">{skillMatrix.platformSolved.leetcode}</span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">LeetCode</span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950/20 p-3 rounded-2xl text-center border border-slate-100 dark:border-slate-800">
                    <span className="text-lg font-extrabold text-slate-800 dark:text-white block">{skillMatrix.platformSolved.codeforces}</span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Codeforces</span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950/20 p-3 rounded-2xl text-center border border-slate-100 dark:border-slate-800">
                    <span className="text-lg font-extrabold text-slate-800 dark:text-white block">{skillMatrix.platformSolved.codechef}</span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">CodeChef</span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950/20 p-3 rounded-2xl text-center border border-slate-100 dark:border-slate-800">
                    <span className="text-lg font-extrabold text-slate-800 dark:text-white block">{skillMatrix.platformSolved.hackerrank}</span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">HackerRank</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Consistency & Attendance */}
            <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-800 dark:text-white text-sm uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
                <Activity className="h-4.5 w-4.5 text-rose-500" /> Contest Consistency Metrics
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-950/20 rounded-2xl border border-slate-100 dark:border-slate-850 flex items-center justify-between">
                  <div>
                    <span className="text-2xl font-black text-slate-850 dark:text-white">{consistency.attendanceRate}%</span>
                    <span className="text-xs block text-slate-400 font-semibold mt-0.5">Overall Attendance Rate</span>
                  </div>
                  <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 font-extrabold">
                    📊
                  </div>
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-950/20 rounded-2xl border border-slate-100 dark:border-slate-850 flex items-center justify-between">
                  <div>
                    <span className="text-2xl font-black text-slate-850 dark:text-white">{consistency.recentConsistency}%</span>
                    <span className="text-xs block text-slate-400 font-semibold mt-0.5">Recent Consistency (Last 5)</span>
                  </div>
                  <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400 font-extrabold">
                    🔥
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Staff View (Faculty/HOD/Admin)
  if (overviewLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
      </div>
    );
  }

  const aggregates = overviewData?.aggregates || {
    totalStudents: 0,
    avgReadinessScore: 0,
    avgProblemsSolved: 0,
    distribution: { elite: 0, high: 0, moderate: 0, practice: 0 },
    companyReadiness: { tier1: 0, tier2: 0, tier3: 0 }
  };

  const studentsList = overviewData?.students || [];

  // Filter students by search query
  const filteredStudents = studentsList.filter(s => {
    const val = searchText.toLowerCase();
    return !val || s.name.toLowerCase().includes(val) || s.roll_no.toLowerCase().includes(val) || s.department.toLowerCase().includes(val);
  });

  // Recharts Pie Chart Data
  const pieData = [
    { name: 'Elite', value: aggregates.distribution.elite, color: '#8b5cf6' },
    { name: 'High', value: aggregates.distribution.high, color: '#3b82f6' },
    { name: 'Moderate', value: aggregates.distribution.moderate, color: '#f59e0b' },
    { name: 'Practice', value: aggregates.distribution.practice, color: '#f43f5e' }
  ].filter(d => d.value > 0);

  // Recharts Bar Chart Data
  const barData = [
    { name: 'Tier 1 (FAANG)', Ready: aggregates.companyReadiness.tier1 },
    { name: 'Tier 2 (Product)', Ready: aggregates.companyReadiness.tier2 },
    { name: 'Tier 3 (Service)', Ready: aggregates.companyReadiness.tier3 }
  ];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 dark:text-white">Placement Readiness Center</h1>
          <p className="text-xs text-slate-400 mt-1 uppercase font-bold tracking-wider">
            Faculty & Department Placement Analytics
          </p>
        </div>
        <button
          onClick={handleExportCSV}
          className="flex items-center justify-center gap-2 bg-gradient-to-r from-primary-600 to-indigo-600 hover:opacity-95 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-md transition-all self-start md:self-auto"
        >
          <Download className="h-4 w-4" /> Export Report
        </button>
      </div>

      {/* Aggregate Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total Active Cohort</span>
            <h3 className="text-3xl font-black text-slate-800 dark:text-white mt-1">{aggregates.totalStudents}</h3>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Monitored candidates</span>
          </div>
          <div className="h-12 w-12 flex items-center justify-center rounded-2xl bg-primary-100 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 text-xl font-bold">
            🎓
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Avg Readiness Score</span>
            <h3 className="text-3xl font-black text-slate-800 dark:text-white mt-1">{aggregates.avgReadinessScore}%</h3>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Overall cohort average</span>
          </div>
          <div className="h-12 w-12 flex items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 text-xl font-bold">
            ⚡
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Avg Solved Problems</span>
            <h3 className="text-3xl font-black text-slate-800 dark:text-white mt-1">{aggregates.avgProblemsSolved}</h3>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Solved DSA problems</span>
          </div>
          <div className="h-12 w-12 flex items-center justify-center rounded-2xl bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 text-xl font-bold">
            📚
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Readiness distribution */}
        <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <h3 className="font-bold text-slate-850 dark:text-white text-sm mb-4 uppercase tracking-wider">Readiness Tier Distribution</h3>
          <div className="h-64 flex items-center justify-center">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${value} Students`, 'Count']} />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <span className="text-xs text-slate-400">No data available for filters.</span>
            )}
          </div>
        </div>

        {/* Company prep distribution */}
        <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <h3 className="font-bold text-slate-850 dark:text-white text-sm mb-4 uppercase tracking-wider">Company Preparation Ready Counts</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis />
                <Tooltip formatter={(value) => [`${value} Students Ready`, 'Ready']} />
                <Legend />
                <Bar dataKey="Ready" fill="#4f46e5" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Filtering Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white dark:bg-slate-900 p-4 border border-slate-200/60 dark:border-slate-850 rounded-2xl shadow-sm">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search student or roll no..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/40 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 text-slate-700 dark:text-slate-350"
          />
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
        </div>

        {/* Department filter */}
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

        {/* Batch filter */}
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
      </div>

      {/* Students Directory Table */}
      <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-100 dark:border-slate-850">
          <h3 className="font-bold text-slate-800 dark:text-white text-sm uppercase tracking-wider">Cohort Placement Readiness Table</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950/40 border-b border-slate-150 dark:border-slate-850 text-slate-500 font-bold uppercase tracking-wider">
                <th className="py-3.5 px-5">Roll No</th>
                <th className="py-3.5 px-4">Name</th>
                <th className="py-3.5 px-4">Dept & Sec</th>
                <th className="py-3.5 px-4 text-center">Problems Solved</th>
                <th className="py-3.5 px-4 text-center">Score</th>
                <th className="py-3.5 px-4">Readiness Level</th>
                <th className="py-3.5 px-4">Tier 1 FAANG</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40 font-medium text-slate-700 dark:text-slate-300">
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-slate-400 font-medium">No students match the current filters.</td>
                </tr>
              ) : (
                filteredStudents.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20">
                    <td className="py-3 px-5 font-bold">{s.roll_no}</td>
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{s.name}</td>
                    <td className="py-3 px-4 text-slate-500">{s.department} - {s.section}</td>
                    <td className="py-3 px-4 text-center font-bold">{s.totalSolved}</td>
                    <td className="py-3 px-4 text-center font-black text-indigo-600 dark:text-indigo-400">{s.overallScore}%</td>
                    <td className="py-3 px-4">{getReadinessLevelBadge(s.readinessLevel)}</td>
                    <td className="py-3 px-4">{getPrepStatusBadge(s.companyPrep.tier1)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default PlacementDashboard;
