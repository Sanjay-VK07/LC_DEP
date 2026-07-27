import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api';
import { useAuth } from '../context/AuthContext';
import { 
  Sparkles, 
  Brain, 
  TrendingUp, 
  AlertTriangle, 
  CheckSquare, 
  HelpCircle,
  Lightbulb,
  Search,
  CheckCircle2,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend 
} from 'recharts';

function AiInsights() {
  const { user } = useAuth();
  const isStudent = user?.role === 'Student';
  const targetStudentId = user?.studentId;

  // Selection state for staff users
  const [students, setStudents] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState(isStudent ? targetStudentId : '');
  const [studentSearchText, setStudentSearchText] = useState('');

  // AI insights state
  const [insightsData, setInsightsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load students list for staff selection
  useEffect(() => {
    if (!isStudent) {
      axios.get(`${API_URL}/students`, { params: { status: 'active' } })
        .then(res => {
          if (res.data.success) {
            setStudents(res.data.data);
          }
        })
        .catch(err => console.error('Failed to load students list', err));
    }
  }, [isStudent]);

  // Load insights when selectedStudentId changes
  useEffect(() => {
    if (selectedStudentId) {
      fetchInsights(selectedStudentId);
    } else {
      setInsightsData(null);
    }
  }, [selectedStudentId]);

  const fetchInsights = async (id) => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API_URL}/ai/insights/${id}`);
      if (res.data.success) {
        setInsightsData(res.data.data);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch AI coaching insights.');
      setInsightsData(null);
    } finally {
      setLoading(false);
    }
  };

  // Filter students dropdown list for staff search
  const filteredStudents = students.filter(s =>
    s.name.toLowerCase().includes(studentSearchText.toLowerCase()) ||
    s.roll_no.toLowerCase().includes(studentSearchText.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <Brain className="h-8 w-8 text-fuchsia-600 animate-pulse" /> AI Coaching Center
          </h1>
          <p className="text-xs text-slate-400 mt-1 uppercase font-bold tracking-wider">
            Personalized weak area detection, milestone tracking, and contest predictions
          </p>
        </div>
      </div>

      {/* Staff Student Selector Dropdown */}
      {!isStudent && (
        <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="space-y-1 self-start">
            <h3 className="font-bold text-slate-800 dark:text-white text-sm">Review Candidate Coach Profile</h3>
            <p className="text-xs text-slate-400">Select a student from the active directory to review their AI metrics.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            {/* Search Input inside Selector */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search student..."
                value={studentSearchText}
                onChange={(e) => setStudentSearchText(e.target.value)}
                className="w-full sm:w-60 pl-8 pr-4 py-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/40 text-xs outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 text-slate-700 dark:text-slate-350"
              />
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
            </div>

            {/* Selector */}
            <select
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-primary-500 text-slate-700 dark:text-slate-350 w-full sm:w-60"
            >
              <option value="">Select Candidate</option>
              {filteredStudents.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.roll_no})</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Loading Spin */}
      {loading && (
        <div className="flex h-[50vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
        </div>
      )}

      {/* Error notification */}
      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* No selection placeholder */}
      {!loading && !insightsData && !error && (
        <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
          <Sparkles className="mx-auto h-12 w-12 text-slate-400 animate-pulse" />
          <h2 className="mt-4 text-xl font-bold text-slate-800 dark:text-white">AI Coach Insights Ready</h2>
          <p className="mt-2 text-slate-500 max-w-md mx-auto text-xs">
            {isStudent 
              ? 'Connect your LeetCode profile to receive personalized weakness analysis.' 
              : 'Select a student profile from the selector above to load their AI recommendations and predictions.'}
          </p>
        </div>
      )}

      {/* Insights Data Views */}
      {!loading && insightsData && (
        <div className="space-y-6 animate-fadeIn">
          {/* Top Banner Hero */}
          <div className="relative overflow-hidden rounded-3xl border border-fuchsia-100 dark:border-fuchsia-950/60 bg-gradient-to-r from-fuchsia-600 to-purple-600 p-6 text-white shadow-lg shadow-fuchsia-500/10">
            <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <span className="rounded-full bg-white/20 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur-md">
                  AI COORDINATION REPORT
                </span>
                <h2 className="mt-3 text-3xl font-extrabold">{insightsData.student.name}</h2>
                <p className="mt-1 text-fuchsia-100 font-medium text-sm">
                  Roll No: {insightsData.student.roll_no} • {insightsData.student.department} Section {insightsData.student.section}
                </p>
              </div>
              <div className="px-5 py-2.5 rounded-2xl bg-white text-slate-900 shadow-md self-start md:self-auto">
                <span className="text-[10px] block font-bold uppercase tracking-wider text-slate-500">Predicted Contest Rating</span>
                <span className="text-xl font-black text-fuchsia-600">{insightsData.contestPredictions.predictedRating}</span>
              </div>
            </div>
            {/* Shapes */}
            <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-white/5 blur-3xl -mr-20 -mt-20"></div>
          </div>

          {/* Grid Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: Weak Areas & Insights */}
            <div className="lg:col-span-1 flex flex-col gap-6">
              {/* Weak Topics */}
              <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
                <h3 className="font-bold text-slate-800 dark:text-white text-sm uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <AlertTriangle className="h-4.5 w-4.5 text-amber-500" /> Weak Topics Detected
                </h3>
                
                {insightsData.weakTopics.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">No critical weaknesses detected. Student has solid topic coverage!</p>
                ) : (
                  <div className="space-y-4">
                    {insightsData.weakTopics.map((topic, index) => (
                      <div key={index} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-semibold text-slate-700 dark:text-slate-350">{topic.topicName}</span>
                          <span className={`font-bold uppercase text-[9px] px-2 py-0.5 rounded-full ${
                            topic.priority === 'High' 
                              ? 'text-rose-600 bg-rose-50 dark:bg-rose-950/20 dark:text-rose-400' 
                              : 'text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400'
                          }`}>
                            {topic.priority} Priority
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${topic.priority === 'High' ? 'bg-rose-500' : 'bg-amber-500'}`}
                            style={{ width: `${Math.max((topic.solvedCount / topic.targetCount) * 100, 5)}%` }}
                          ></div>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Practice tier: {topic.tier}</span>
                          <span>{topic.solvedCount} / {topic.targetCount} Solved</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Performance Highlights */}
              <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
                <h3 className="font-bold text-slate-800 dark:text-white text-sm uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <Lightbulb className="h-4.5 w-4.5 text-fuchsia-500" /> AI Insights
                </h3>
                <div className="space-y-3">
                  {insightsData.insights.map((insight, index) => (
                    <div key={index} className="flex gap-2.5 p-3 rounded-2xl bg-fuchsia-50/50 dark:bg-fuchsia-950/10 border border-fuchsia-100/50 dark:border-fuchsia-950/20">
                      <Lightbulb className="h-5 w-5 text-fuchsia-600 dark:text-fuchsia-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-slate-600 dark:text-slate-350 leading-relaxed font-medium">{insight}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Recommendations & Predictions */}
            <div className="lg:col-span-2 flex flex-col gap-6">
              {/* Recommendations Roadmap */}
              <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-5">
                <h3 className="font-bold text-slate-800 dark:text-white text-sm uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <CheckSquare className="h-4.5 w-4.5 text-primary-500" /> Personalized Roadmap
                </h3>
                <div className="bg-slate-50 dark:bg-slate-950/30 p-4 rounded-2xl border border-slate-100 dark:border-slate-850">
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-semibold">
                    {insightsData.recommendations.text}
                  </p>
                </div>
                <div className="space-y-3">
                  <h4 className="font-bold text-xs uppercase tracking-wide text-slate-500">Upcoming Practice Milestones</h4>
                  {insightsData.recommendations.milestones.map((m, index) => (
                    <div key={index} className="flex items-center justify-between p-3.5 bg-white dark:bg-slate-950/20 border border-slate-100 dark:border-slate-850 rounded-2xl">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                        <span className="text-xs text-slate-700 dark:text-slate-250 font-bold">{m.goal}</span>
                      </div>
                      <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2.5 py-1 rounded-lg shrink-0">
                        <Calendar className="h-3 w-3" /> {m.targetDate}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rating Projection Predictions */}
              <div className="rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-5">
                <h3 className="font-bold text-slate-800 dark:text-white text-sm uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <TrendingUp className="h-4.5 w-4.5 text-indigo-500" /> Contest Predictions & Trajectory
                </h3>
                
                {/* Meta details */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-3 bg-slate-50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-850 rounded-2xl text-center">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Next Rating</span>
                    <span className="text-lg font-black text-slate-850 dark:text-white block mt-1">
                      {insightsData.contestPredictions.predictedRating}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-850 rounded-2xl text-center">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Expected Gain</span>
                    <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 block mt-1">
                      {insightsData.contestPredictions.predictedChange}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-850 rounded-2xl text-center">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Expected Rank</span>
                    <span className="text-lg font-black text-indigo-600 dark:text-indigo-400 block mt-1">
                      {insightsData.contestPredictions.expectedRank}
                    </span>
                  </div>
                </div>

                {/* Rating line chart */}
                {insightsData.contestPredictions.history.length > 0 ? (
                  <div className="h-64 pt-2">
                    <h4 className="font-bold text-xs uppercase tracking-wide text-slate-400 mb-3 text-center">Recent Rating progression</h4>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={insightsData.contestPredictions.history}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="contestName" tick={{ fontSize: 9 }} />
                        <YAxis tick={{ fontSize: 9 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="rating" stroke="#6366f1" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 text-center py-6">No rating graph available. Connect LeetCode and play rated contests to unlock.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AiInsights;
