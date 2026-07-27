import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api';
import { 
  Activity, Play, Pause, RefreshCw, CheckCircle2, AlertCircle, Search, Filter, 
  Terminal, ShieldCheck, Cpu, HardDrive, Wifi, Users as UsersIcon, Award, 
  Clock, ShieldAlert, ChevronDown, ChevronUp, BarChart2
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function LiveMonitor() {
  const [contest, setContest] = useState(null);
  const [hasLiveContest, setHasLiveContest] = useState(false);
  const [students, setStudents] = useState([]);
  const [analytics, setAnalytics] = useState({ batch: [], department: [], section: [], history: [] });
  const [health, setHealth] = useState(null);
  
  // Filtering and Searching states
  const [search, setSearch] = useState('');
  const [selectedBatch, setSelectedBatch] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');

  // Dropdown lists
  const [batches, setBatches] = useState([]);
  const [departments, setDepartments] = useState(['DEC', 'CSE', 'ECE', 'MECH', 'CIVIL', 'IT']);
  const [sections, setSections] = useState(['A', 'B', 'C', 'D']);
  
  // UI interactive states
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [isHealthOpen, setIsHealthOpen] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const [pulseUserIds, setPulseUserIds] = useState(new Set()); // IDs of students currently flashing on diff update
  const [timeRemaining, setTimeRemaining] = useState('');

  const eventSourceRef = useRef(null);

  // Fetch initial data
  const fetchData = async () => {
    try {
      setLoading(true);
      const currentRes = await axios.get('/api/contestmaster/live/current');
      const activeContest = currentRes.data.contest;
      const liveFlag = currentRes.data.hasLiveContest;
      setContest(activeContest);
      setHasLiveContest(liveFlag);

      if (activeContest && liveFlag) {
        // Fetch students and analytics
        const studentsRes = await axios.get(`/api/contestmaster/live/students?contestId=${activeContest.id}`);
        setStudents(studentsRes.data.students);

        const analyticsRes = await axios.get(`/api/contestmaster/live/analytics?contestId=${activeContest.id}`);
        setAnalytics(analyticsRes.data);
      }

      const healthRes = await axios.get('/api/contestmaster/live/health');
      setHealth(healthRes.data.health);

      const batchesRes = await axios.get('/api/contestmaster/batches');
      setBatches(batchesRes.data);

    } catch (err) {
      console.error('Error fetching live data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Poll health metrics every 15 seconds
    const healthInterval = setInterval(async () => {
      try {
        const res = await axios.get(`${API_URL}/contestmaster/live/health`);
        setHealth(res.data.health);
      } catch (e) {}
    }, 15000);

    return () => clearInterval(healthInterval);
  }, []);

  // Countdown timer calculations
  useEffect(() => {
    if (!hasLiveContest || !contest) return;

    const timer = setInterval(() => {
      const now = new Date();
      const startTime = new Date(contest.startTime);
      const endTime = new Date(contest.endTime);

      if (now < startTime) {
        const diff = startTime - now;
        setTimeRemaining(`Starts in: ${formatDuration(diff)}`);
      } else if (now >= startTime && now <= endTime) {
        const diff = endTime - now;
        setTimeRemaining(`Ends in: ${formatDuration(diff)}`);
      } else {
        setTimeRemaining('Contest Ended');
        clearInterval(timer);
        fetchData();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [contest, hasLiveContest]);

  const formatDuration = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // SSE Stream handler
  useEffect(() => {
    if (!hasLiveContest || !contest) return;

    // Establish event stream connection
    const connectSSE = () => {
      console.log('[SSE] Connecting to live stream...');
      const source = new EventSource(`${API_URL}/contestmaster/live/stream`);
      eventSourceRef.current = source;

      source.onopen = () => {
        setSseConnected(true);
      };

      source.onerror = () => {
        setSseConnected(false);
        source.close();
        // Retry connection after 5 seconds
        setTimeout(connectSSE, 5000);
      };

      source.addEventListener('StudentUpdated', (event) => {
        const payload = JSON.parse(event.data);
        if (payload.contestId !== contest.id) return;

        // Apply differential update to students array
        setStudents(prevStudents => {
          return prevStudents.map(student => {
            if (student.studentId === payload.studentId) {
              // Pulse animation logic
              setPulseUserIds(prev => {
                const updated = new Set(prev);
                updated.add(student.studentId);
                return updated;
              });
              // Remove pulse class after 2 seconds
              setTimeout(() => {
                setPulseUserIds(prev => {
                  const updated = new Set(prev);
                  updated.delete(student.studentId);
                  return updated;
                });
              }, 2500);

              return {
                ...student,
                ...payload.diff,
                lastUpdatedAt: payload.timestamp
              };
            }
            return student;
          });
        });

        // Trigger an async analytics and health refresh
        axios.get(`/api/contestmaster/live/analytics?contestId=${contest.id}`)
          .then(res => setAnalytics(res.data))
          .catch(() => {});
      });

      source.addEventListener('ContestCompleted', () => {
        fetchData();
      });

      source.addEventListener('SnapshotCreated', () => {
        axios.get(`/api/contestmaster/live/analytics?contestId=${contest.id}`)
          .then(res => setAnalytics(res.data))
          .catch(() => {});
      });

      source.addEventListener('SyncProgress', (event) => {
        const payload = JSON.parse(event.data);
        if (payload.contestId !== contest.id) return;
        setContest(prev => prev ? { ...prev, syncProgress: payload.progress } : null);
      });
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [contest]);

  // Admin Controls
  const triggerControlAction = async (action) => {
    if (!contest) return;
    try {
      setActionLoading(true);
      const res = await axios.post('/api/contestmaster/live/control', {
        action,
        contestId: contest.id
      });
      alert(res.data.message || 'Action executed successfully.');
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to trigger control action.');
    } finally {
      setActionLoading(false);
    }
  };

  // Filter student list
  const filteredStudents = students.filter(student => {
    const matchesSearch = student.name.toLowerCase().includes(search.toLowerCase()) ||
      student.roll_no.toLowerCase().includes(search.toLowerCase()) ||
      (student.leetcode_username || '').toLowerCase().includes(search.toLowerCase());
    
    const matchesBatch = selectedBatch ? student.academic_batch === selectedBatch : true;
    const matchesDept = selectedDept ? student.department === selectedDept : true;
    const matchesSection = selectedSection ? student.section === selectedSection : true;
    const matchesStatus = selectedStatus ? student.attendanceStatus === selectedStatus : true;

    return matchesSearch && matchesBatch && matchesDept && matchesSection && matchesStatus;
  });

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center bg-slate-950 text-white rounded-3xl">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-10 w-10 animate-spin text-primary-500" />
          <p className="text-sm font-semibold text-slate-400">Loading Live Monitor telemetry...</p>
        </div>
      </div>
    );
  }

  if (!hasLiveContest || !contest) {
    return (
      <div className="flex h-[80vh] items-center justify-center bg-slate-950 text-white rounded-3xl p-6 text-center">
        <div className="max-w-md">
          <ShieldAlert className="h-16 w-16 text-yellow-500 mx-auto mb-4 animate-bounce" />
          <h2 className="text-xl font-bold tracking-tight mb-2">No Active Contest</h2>
          <p className="text-slate-400 text-sm mb-6">
            There is currently no ongoing Weekly or Biweekly contest detected. You can seed a test contest using admin controls or check back during contest hours.
          </p>
          <div className="flex gap-3 justify-center">
            <button 
              onClick={fetchData} 
              className="px-4 py-2 bg-slate-800 text-sm font-semibold rounded-xl hover:bg-slate-700 transition"
            >
              Refresh Scanner
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-slate-100 min-h-screen pb-12">
      {/* 1. Header Hero Panel */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-900 to-slate-950 p-6 shadow-xl">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-primary-600/10 blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="flex h-3.5 w-3.5 relative">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  contest.status === 'Live' ? 'bg-emerald-400' : 'bg-yellow-400'
                }`} />
                <span className={`relative inline-flex rounded-full h-3 w-3 ${
                  contest.status === 'Live' ? 'bg-emerald-500' : 'bg-yellow-500'
                }`} />
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                LeetCode {contest.contestType} Contest
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              {contest.contestName}
            </h1>
            <div className="flex flex-wrap gap-4 text-xs font-medium text-slate-400 pt-1">
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-primary-500" />
                <span>Starts: {new Date(contest.startTime).toLocaleTimeString()}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <RefreshCw className="h-4 w-4 text-primary-500" />
                <span>Last Sync: {contest.lastSyncAt ? new Date(contest.lastSyncAt).toLocaleTimeString() : 'Never'}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start md:items-end gap-3">
            <div className="px-4 py-2 bg-slate-800/80 backdrop-blur rounded-2xl border border-slate-700/50">
              <span className="text-xl md:text-2xl font-mono font-bold tracking-wider text-primary-400">
                {timeRemaining}
              </span>
            </div>
            
            {/* Sync Progress Bar */}
            <div className="w-full md:w-48 space-y-1">
              <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <span>Sync Progress</span>
                <span>{parseFloat(contest.syncProgress).toFixed(0)}%</span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden border border-slate-700/30">
                <div 
                  className="h-full bg-gradient-to-r from-primary-500 to-emerald-500 transition-all duration-1000"
                  style={{ width: `${contest.syncProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Admin & System Health Collapsible Panel */}
      <div className="border border-slate-800 bg-slate-900/40 backdrop-blur rounded-3xl overflow-hidden shadow-lg">
        <button 
          onClick={() => setIsHealthOpen(!isHealthOpen)}
          className="flex items-center justify-between w-full p-5 hover:bg-slate-800/20 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <Terminal className="h-5 w-5 text-primary-500" />
            <h3 className="font-bold tracking-tight">System Telemetry & Controls</h3>
          </div>
          {isHealthOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>

        {isHealthOpen && health && (
          <div className="p-6 border-t border-slate-800/60 grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Health telemetry stats */}
            <div className="space-y-4 col-span-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Telemetry Signals</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800/50 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                    <Wifi className={`h-4 w-4 ${sseConnected ? 'text-emerald-500' : 'text-rose-500'}`} />
                    <span>SSE Stream</span>
                  </div>
                  <p className="text-lg font-bold font-mono">{sseConnected ? 'CONNECTED' : 'DISCONNECTED'}</p>
                </div>

                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800/50 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                    <Cpu className="h-4 w-4 text-blue-500" />
                    <span>Datasource</span>
                  </div>
                  <p className="text-lg font-bold">{health.currentDatasource || 'N/A'}</p>
                </div>

                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800/50 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                    <HardDrive className="h-4 w-4 text-purple-500" />
                    <span>Queue Status</span>
                  </div>
                  <p className="text-lg font-bold">{health.queue?.active ? 'RUNNING' : 'IDLE'}</p>
                </div>

                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800/50 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                    <ShieldCheck className="h-4 w-4 text-yellow-500" />
                    <span>Sync Lock</span>
                  </div>
                  <p className="text-lg font-bold">{health.syncLockState || 'Idle'}</p>
                </div>
              </div>
            </div>

            {/* Admin control panel actions */}
            <div className="p-5 bg-slate-950/80 rounded-2xl border border-slate-800/50 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Sync Controls</h4>
              <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={actionLoading || health.queue?.active}
                  onClick={() => triggerControlAction('sync')}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-xs font-bold rounded-xl transition-all"
                >
                  <RefreshCw className="h-4 w-4" />
                  Manual Sync
                </button>

                <button
                  disabled={actionLoading || !health.queue?.active}
                  onClick={() => triggerControlAction('pause')}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold rounded-xl transition-all"
                >
                  <Pause className="h-4 w-4" />
                  Pause Sync
                </button>

                <button
                  disabled={actionLoading}
                  onClick={() => triggerControlAction('resume')}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold rounded-xl transition-all"
                >
                  <Play className="h-4 w-4" />
                  Resume Sync
                </button>

                <button
                  disabled={actionLoading}
                  onClick={() => triggerControlAction('finalize')}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-rose-950/40 hover:bg-rose-900/30 border border-rose-800/40 disabled:opacity-50 text-xs font-bold rounded-xl transition-all text-rose-300"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Finalize
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Analytics Aggregates Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Core summary metrics */}
        <div className="grid grid-cols-2 gap-4 lg:col-span-1">
          <div className="p-6 bg-slate-900/40 backdrop-blur rounded-3xl border border-slate-800/60 shadow space-y-1">
            <UsersIcon className="h-8 w-8 text-primary-500 mb-2" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Attendance Rate</h4>
            <p className="text-3xl font-extrabold font-mono tracking-tight text-white">
              {analytics.history?.length > 0 
                ? `${parseFloat(analytics.history[analytics.history.length - 1].attendancePercentage).toFixed(1)}%` 
                : 'N/A'}
            </p>
          </div>

          <div className="p-6 bg-slate-900/40 backdrop-blur rounded-3xl border border-slate-800/60 shadow space-y-1">
            <BarChart2 className="h-8 w-8 text-emerald-500 mb-2" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Avg Solved</h4>
            <p className="text-3xl font-extrabold font-mono tracking-tight text-white">
              {analytics.history?.length > 0 
                ? `${parseFloat(analytics.history[analytics.history.length - 1].averageSolved).toFixed(1)}` 
                : 'N/A'}
            </p>
          </div>

          <div className="p-6 bg-slate-900/40 backdrop-blur rounded-3xl border border-slate-800/60 shadow space-y-1 col-span-2">
            <Award className="h-8 w-8 text-yellow-500 mb-2" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Top Rank Performer</h4>
            <p className="text-xl font-bold tracking-tight text-white truncate">
              {analytics.batch?.[0]?.topPerformer || 'No participation yet'}
            </p>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">
              {analytics.batch?.[0]?.topScore > 0 ? `Score: ${analytics.batch[0].topScore} pts` : ''}
            </p>
          </div>
        </div>

        {/* Live Aggregates Timeline Chart */}
        <div className="p-6 bg-slate-900/40 backdrop-blur rounded-3xl border border-slate-800/60 shadow lg:col-span-2">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-400 mb-4">Real-Time Participation Trend</h3>
          <div className="h-44 w-full">
            {analytics.history?.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.history}>
                  <defs>
                    <linearGradient id="colorPart" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis 
                    dataKey="snapshotTime" 
                    tickFormatter={(time) => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    stroke="#64748b"
                    fontSize={10}
                  />
                  <YAxis stroke="#64748b" fontSize={10} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
                    labelFormatter={(label) => new Date(label).toLocaleString()}
                  />
                  <Area type="monotone" dataKey="participants" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorPart)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-500 text-xs">
                Waiting for the first aggregate synchronization snapshot...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. Filters & Student List Table */}
      <div className="bg-slate-900/40 backdrop-blur rounded-3xl border border-slate-800/60 overflow-hidden shadow-xl">
        {/* Filters Header panel */}
        <div className="p-5 border-b border-slate-800/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3.5 top-3 h-4.5 w-4.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search student, roll, handle..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-950 text-sm text-slate-200 border border-slate-800 hover:border-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500 rounded-xl"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold uppercase">
              <Filter className="h-4 w-4" />
              <span>Filters:</span>
            </div>

            <select
              value={selectedBatch}
              onChange={(e) => setSelectedBatch(e.target.value)}
              className="bg-slate-950 text-xs font-semibold py-2 px-3 border border-slate-800 hover:border-slate-700 focus:outline-none rounded-xl"
            >
              <option value="">All Batches</option>
              {batches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="bg-slate-950 text-xs font-semibold py-2 px-3 border border-slate-800 hover:border-slate-700 focus:outline-none rounded-xl"
            >
              <option value="">All Departments</option>
              {departments.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            <select
              value={selectedSection}
              onChange={(e) => setSelectedSection(e.target.value)}
              className="bg-slate-950 text-xs font-semibold py-2 px-3 border border-slate-800 hover:border-slate-700 focus:outline-none rounded-xl"
            >
              <option value="">All Sections</option>
              {sections.map(s => (
                <option key={s} value={s}>Section {s}</option>
              ))}
            </select>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-slate-950 text-xs font-semibold py-2 px-3 border border-slate-800 hover:border-slate-700 focus:outline-none rounded-xl"
            >
              <option value="">All Statuses</option>
              <option value="Participating">Participating</option>
              <option value="Unknown">Not Yet Detected</option>
              <option value="Present">Present</option>
              <option value="Absent">Absent</option>
            </select>
          </div>
        </div>

        {/* Table representation */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800/80">
                <th className="px-6 py-4">Student Details</th>
                <th className="px-6 py-4">LeetCode Handle</th>
                <th className="px-6 py-4">Attendance</th>
                <th className="px-6 py-4">Global Rank</th>
                <th className="px-6 py-4">Solved</th>
                <th className="px-6 py-4">Score</th>
                <th className="px-6 py-4">Last Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {filteredStudents.length > 0 ? (
                filteredStudents.map((s) => {
                  const isPulsing = pulseUserIds.has(s.studentId);
                  return (
                    <tr 
                      key={s.studentId}
                      className={`hover:bg-slate-800/10 transition-colors duration-300 ${
                        isPulsing ? 'bg-primary-950/20 ring-1 ring-primary-500/40' : ''
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="space-y-0.5">
                          <p className="font-semibold text-white text-sm">{s.name}</p>
                          <p className="text-xs text-slate-500 font-medium">
                            {s.roll_no} • {s.department} - {s.section}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-mono text-primary-400 bg-primary-950/30 border border-primary-900/40 px-2.5 py-1 rounded-lg">
                          {s.leetcode_username || 'N/A'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                          s.attendanceStatus === 'Participating' 
                            ? 'bg-emerald-950/30 border-emerald-900/40 text-emerald-400' 
                            : s.attendanceStatus === 'Present'
                            ? 'bg-blue-950/30 border-blue-900/40 text-blue-400'
                            : s.attendanceStatus === 'Absent'
                            ? 'bg-rose-950/30 border-rose-900/40 text-rose-400'
                            : 'bg-slate-950/30 border-slate-800/60 text-slate-400'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            s.attendanceStatus === 'Participating' 
                              ? 'bg-emerald-400' 
                              : s.attendanceStatus === 'Present'
                              ? 'bg-blue-400'
                              : s.attendanceStatus === 'Absent'
                              ? 'bg-rose-400'
                              : 'bg-slate-400'
                          }`} />
                          {s.attendanceStatus === 'Unknown' ? 'Not Yet Detected' : s.attendanceStatus}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm font-semibold text-white">
                        {s.rank ? `#${s.rank.toLocaleString()}` : '-'}
                      </td>
                      <td className="px-6 py-4 font-mono text-sm font-semibold text-white">
                        {s.solved || 0}
                      </td>
                      <td className="px-6 py-4 font-mono text-sm font-semibold text-white">
                        {s.score ? `${parseFloat(s.score).toFixed(1)} pts` : '-'}
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-slate-500">
                        {s.lastUpdatedAt ? new Date(s.lastUpdatedAt).toLocaleTimeString() : 'Waiting...'}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7" className="px-6 py-8 text-center text-slate-500 text-xs font-medium">
                    No active students matching the search and filter settings.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default LiveMonitor;
