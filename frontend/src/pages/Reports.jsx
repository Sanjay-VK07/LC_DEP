import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  BarChart3, 
  Download, 
  FileSpreadsheet, 
  FileJson, 
  Grid,
  Search,
  Users,
  Award,
  BookOpen,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { saveAs } from 'file-saver';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

function Reports() {
  const [activeTab, setActiveTab] = useState('contests'); // 'contests', 'students', 'departments', 'sections', 'heatmap'
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [heatmapData, setHeatmapData] = useState(null);
  
  // Student report filters
  const [studentSearch, setStudentSearch] = useState('');
  const [studentDept, setStudentDept] = useState('');
  const [studentSec, setStudentSec] = useState('');
  const [studentYear, setStudentYear] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Contest report filters
  const [contestBatch, setContestBatch] = useState('');

  // Dynamic filter states
  const [availableDepts, setAvailableDepts] = useState([]);
  const [availableBatches, setAvailableBatches] = useState([]);
  const [availableSections, setAvailableSections] = useState([]);

  // Fetch filters data on mount
  useEffect(() => {
    const loadFiltersData = async () => {
      try {
        const [deptsRes, batchesRes] = await Promise.all([
          axios.get('/api/departments'),
          axios.get('/api/students/batches')
        ]);
        if (deptsRes.data.success) {
          setAvailableDepts(deptsRes.data.data);
        }
        if (batchesRes.data.success) {
          setAvailableBatches(batchesRes.data.data);
        }
      } catch (err) {
        console.error('Failed to load filter data in Reports:', err);
      }
    };
    loadFiltersData();
  }, []);

  // Fetch available sections dynamically when department or batch filters change
  useEffect(() => {
    const fetchAvailableSections = async () => {
      try {
        const params = { status: 'active' };
        if (studentDept) params.department = studentDept;
        if (studentYear) params.academicBatch = studentYear;
        const res = await axios.get('/api/students/sections', { params });
        if (res.data.success) {
          const sections = res.data.data;
          setAvailableSections(sections);
          if (studentSec && !sections.includes(studentSec)) {
            setStudentSec('');
          }
        }
      } catch (err) {
        console.error('Failed to fetch sections:', err);
      }
    };
    fetchAvailableSections();
  }, [studentDept, studentYear]);

  // Fetch report data based on active tab
  const fetchReportData = async () => {
    setLoading(true);
    setData([]); // Clear old data to prevent type mismatch crashes on tab transition
    try {
      if (activeTab === 'heatmap') {
        const res = await axios.get('/api/reports/heatmap');
        if (res.data.success) {
          setHeatmapData(res.data);
        }
      } else {
        const endpoint = `/api/reports/${activeTab}`;
        let params = {};
        if (activeTab === 'students') {
          params = {
            department: studentDept,
            section: studentSec,
            academicYear: studentYear,
            startDate: filterStartDate,
            endDate: filterEndDate
          };
        } else if (activeTab === 'contests') {
          params = {
            batch: contestBatch
          };
        }

        const res = await axios.get(endpoint, { params });
        if (res.data.success) {
          setData(res.data.data);
        }
      }
    } catch (err) {
      console.error('Failed to load report data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [activeTab, studentDept, studentSec, studentYear, filterStartDate, filterEndDate, contestBatch]);

  // Export to Excel handler
  const handleExportExcel = () => {
    let exportData = [];
    let fileName = `report_${activeTab}`;

    if (activeTab === 'heatmap' && heatmapData) {
      // Format heatmap for Excel
      exportData = heatmapData.students.map(s => {
        const row = {
          'Register Number': s.registerNumber,
          'Student Name': s.name
        };
        heatmapData.contests.forEach((c, idx) => {
          row[c.name] = s.timeline[idx] ? s.timeline[idx].toUpperCase() : 'ABSENT';
        });
        return row;
      });
      fileName = 'attendance_heatmap_report';
    } else if (activeTab === 'contests') {
      exportData = data.map(c => ({
        'Contest Name': c.name,
        'Slug': c.contest_slug,
        'Status': c.contest_status,
        'Type': c.type.toUpperCase(),
        'Contest Date': new Date(c.date).toLocaleDateString(),
        'Students Tracked': c.total_students,
        'Present Count': c.present_count,
        'Absent Count': c.absent_count,
        'Attendance Percentage': `${c.attendance_percentage}%`
      }));
      fileName = contestBatch ? `${contestBatch}_contests_attendance_report` : 'contests_attendance_report';
    } else if (activeTab === 'students') {
      exportData = filteredStudentsReport.map(s => ({
        'Roll Number': s.register_number,
        'Student Name': s.name,
        'Department': s.department,
        'Year': s.academic_year,
        'LeetCode Username': s.leetcode_username,
        'Rated Contests': s.rated_contests,
        'Unrated Contests': s.unrated_contests,
        'Participation Count': s.present_count,
        'Attendance Percentage': `${s.attendance_percentage}%`,
        'Current Rating': s.current_rating,
        'Best Rating': s.best_rating,
        'Rank History': s.rank_history
      }));
      fileName = 'student_performance_report';
    } else if (activeTab === 'attendance-log') {
      exportData = data.map(item => ({
        'Register Number': item.register_number,
        'Student Name': item.student_name,
        'Department': item.department,
        'Section': item.section,
        'Contest Name': item.contest_name,
        'Contest Date': new Date(item.contest_date).toLocaleDateString(),
        'Contest Status': item.contest_status,
        'Attendance Status': item.attendance_status
      }));
      fileName = 'student_attendance_log_report';
    } else {
      exportData = data;
    }

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ReportData');
    XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Export to CSV handler
  const handleExportCSV = () => {
    let exportData = [];
    let fileName = `report_${activeTab}`;

    if (activeTab === 'heatmap' && heatmapData) {
      exportData = heatmapData.students.map(s => {
        const row = {
          'Register Number': s.registerNumber,
          'Student Name': s.name
        };
        heatmapData.contests.forEach((c, idx) => {
          row[c.name] = s.timeline[idx] ? s.timeline[idx].toUpperCase() : 'ABSENT';
        });
        return row;
      });
      fileName = 'attendance_heatmap_report';
    } else if (activeTab === 'contests') {
      exportData = data.map(c => ({
        'Contest Name': c.name,
        'Slug': c.contest_slug,
        'Status': c.contest_status,
        'Type': c.type.toUpperCase(),
        'Contest Date': new Date(c.date).toLocaleDateString(),
        'Students Tracked': c.total_students,
        'Present Count': c.present_count,
        'Absent Count': c.absent_count,
        'Attendance Percentage': `${c.attendance_percentage}%`
      }));
      fileName = contestBatch ? `${contestBatch}_contests_attendance_report` : 'contests_attendance_report';
    } else if (activeTab === 'students') {
      exportData = filteredStudentsReport.map(s => ({
        'Roll Number': s.register_number,
        'Student Name': s.name,
        'Department': s.department,
        'Year': s.academic_year,
        'LeetCode Username': s.leetcode_username,
        'Rated Contests': s.rated_contests,
        'Unrated Contests': s.unrated_contests,
        'Participation Count': s.present_count,
        'Attendance Percentage': `${s.attendance_percentage}%`,
        'Current Rating': s.current_rating,
        'Best Rating': s.best_rating,
        'Rank History': s.rank_history
      }));
      fileName = 'student_performance_report';
    } else if (activeTab === 'attendance-log') {
      exportData = data.map(item => ({
        'Register Number': item.register_number,
        'Student Name': item.student_name,
        'Department': item.department,
        'Section': item.section,
        'Contest Name': item.contest_name,
        'Contest Date': new Date(item.contest_date).toLocaleDateString(),
        'Contest Status': item.contest_status,
        'Attendance Status': item.attendance_status
      }));
      fileName = 'student_attendance_log_report';
    } else {
      exportData = data;
    }

    const ws = XLSX.utils.json_to_sheet(exportData);
    const csvOutput = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `${fileName}_${new Date().toISOString().split('T')[0]}.csv`);
  };

  // Export to PDF handler
  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: (activeTab === 'heatmap' || activeTab === 'students') ? 'landscape' : 'portrait' });
    const dateStr = new Date().toLocaleDateString();
    
    let title = 'Analytical Attendance Report';
    let headers = [];
    let rows = [];
    let fileName = `report_${activeTab}`;

    if (activeTab === 'contests') {
      title = contestBatch ? `${contestBatch} Contest Attendance Report` : 'EnthraHub Contests Attendance Report';
      fileName = contestBatch ? `${contestBatch}_contest_report` : 'contests_attendance_report';
      headers = ['Contest Name', 'Slug', 'Status', 'Type', 'Contest Date', 'Present', 'Absent', 'Attendance %'];
      rows = data.map(c => [
        c.name,
        c.contest_slug,
        c.contest_status,
        c.type.toUpperCase(),
        new Date(c.date).toLocaleDateString(),
        c.present_count,
        c.absent_count,
        `${c.attendance_percentage}%`
      ]);
    } else if (activeTab === 'students') {
      title = 'Student Attendance & LeetCode Performance Report';
      fileName = 'student_performance_report';
      headers = ['Roll Number', 'Student Name', 'Dept', 'Year', 'LeetCode Username', 'Rated', 'Unrated', 'Present', 'Attendance %', 'Rating', 'Best Rating', 'Rank History'];
      rows = filteredStudentsReport.map(s => [
        s.register_number,
        s.name,
        s.department,
        s.academic_year,
        s.leetcode_username,
        s.rated_contests,
        s.unrated_contests,
        s.present_count,
        `${s.attendance_percentage}%`,
        s.current_rating,
        s.best_rating,
        s.rank_history
      ]);
    } else if (activeTab === 'departments') {
      title = 'Department Attendance Summary';
      fileName = 'department_attendance_report';
      headers = ['Department', 'Total Students', 'Agg. Present Count', 'Attendance %'];
      rows = data.map(d => [
        d.department,
        d.total_students,
        d.present_count,
        `${d.attendance_percentage}%`
      ]);
    } else if (activeTab === 'sections') {
      title = 'Section-wise Attendance Summary';
      fileName = 'sections_attendance_report';
      headers = ['Department', 'Section', 'Total Students', 'Agg. Present Count', 'Attendance %'];
      rows = data.map(s => [
        s.department,
        s.section,
        s.total_students,
        s.present_count,
        `${s.attendance_percentage}%`
      ]);
    } else if (activeTab === 'heatmap' && heatmapData) {
      title = 'Contest Attendance Heatmap Tracker';
      fileName = 'attendance_heatmap_report';
      headers = ['Register No', 'Name', ...heatmapData.contests.map(c => c.name.replace('Contest', ''))];
      rows = heatmapData.students.map(s => [
        s.registerNumber,
        s.name,
        ...s.timeline.map(status => status === 'present' ? 'P' : 'A')
      ]);
    } else if (activeTab === 'attendance-log') {
      title = 'Student Attendance Log Report';
      fileName = 'student_attendance_log_report';
      headers = ['Register Number', 'Student Name', 'Dept', 'Sec', 'Contest Name', 'Contest Date', 'Contest Status', 'Attendance Status'];
      rows = data.map(item => [
        item.register_number,
        item.student_name,
        item.department,
        item.section,
        item.contest_name,
        new Date(item.contest_date).toLocaleDateString(),
        item.contest_status,
        item.attendance_status
      ]);
    }

    doc.setFontSize(14);
    doc.text(title, 14, 15);
    doc.setFontSize(8);
    doc.text(`Generated on: ${dateStr}`, 14, 20);

    doc.autoTable({
      head: [headers],
      body: rows,
      startY: 23,
      theme: 'grid',
      styles: { fontSize: 7 }
    });

    doc.save(`${fileName}_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // Filter students if tab is student
  const filteredStudentsReport = activeTab === 'students' 
    ? data.filter(s => 
        (s.name?.toLowerCase().includes(studentSearch.toLowerCase())) || 
        (s.register_number?.includes(studentSearch)) || 
        (s.leetcode_username?.toLowerCase().includes(studentSearch.toLowerCase()))
      )
    : [];

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Reports & Analytics</h1>
          <p className="text-sm text-slate-400">Generate printable and exportable reports.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportExcel}
            disabled={loading || (activeTab === 'heatmap' && !heatmapData) || (activeTab !== 'heatmap' && (activeTab === 'students' ? filteredStudentsReport.length === 0 : data.length === 0))}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 transition-all shadow-sm disabled:opacity-40"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-500" /> Export Excel
          </button>
          <button
            onClick={handleExportCSV}
            disabled={loading || (activeTab === 'heatmap' && !heatmapData) || (activeTab !== 'heatmap' && (activeTab === 'students' ? filteredStudentsReport.length === 0 : data.length === 0))}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 transition-all shadow-sm disabled:opacity-40"
          >
            <FileJson className="h-4 w-4 text-amber-500" /> Export CSV
          </button>
          <button
            onClick={handleExportPDF}
            disabled={loading || (activeTab === 'heatmap' && !heatmapData) || (activeTab !== 'heatmap' && (activeTab === 'students' ? filteredStudentsReport.length === 0 : data.length === 0))}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 transition-all shadow-sm disabled:opacity-40"
          >
            <Download className="h-4 w-4 text-red-500" /> Export PDF
          </button>
        </div>
      </div>

      {/* Tabs list */}
      <div className="flex rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 p-1.5 shadow-sm overflow-x-auto">
        {[
          { id: 'contests', label: 'Contest Report', icon: Award },
          { id: 'students', label: 'Student Performance', icon: Users },
          { id: 'attendance-log', label: 'Attendance Log', icon: FileSpreadsheet },
          { id: 'departments', label: 'Department Stats', icon: BookOpen },
          { id: 'sections', label: 'Section Summary', icon: Grid },
          { id: 'heatmap', label: 'Attendance Heatmap', icon: BarChart3 }
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold rounded-xl transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-primary-600 text-white shadow-md shadow-primary-500/10'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Dynamic Content Views */}
      <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        {/* Loader */}
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
          </div>
        ) : (
          <>
            {/* 1. CONTEST-WISE SUMMARY REPORT */}
            {activeTab === 'contests' && (
              <div className="space-y-4 animate-fade-in">
                {/* Batch Filter Dropdown */}
                <div className="flex flex-col sm:flex-row items-center gap-3 p-4 bg-slate-50/40 dark:bg-slate-800/10 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-primary-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Academic Batch:</span>
                  </div>
                  <select
                    value={contestBatch}
                    onChange={(e) => setContestBatch(e.target.value)}
                    className="w-full sm:w-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold outline-none focus:border-primary-500 dark:text-slate-200 shadow-sm"
                  >
                    <option value="">All Batches combined</option>
                    {availableBatches.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="px-6 py-4">Contest Name</th>
                      <th className="px-6 py-4">Slug</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Type</th>
                      <th className="px-6 py-4">Date</th>
                      <th className="px-6 py-4">Students Tracked</th>
                      <th className="px-6 py-4">Present Count</th>
                      <th className="px-6 py-4">Absent Count</th>
                      <th className="px-6 py-4">Attendance Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs text-slate-600 dark:text-slate-300">
                    {data.length === 0 ? (
                      <tr><td colSpan="9" className="text-center py-12 text-slate-400">No contests recorded.</td></tr>
                    ) : (
                      data.map((c) => (
                        <tr key={c.contest_slug || c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                          <td className="px-6 py-4 font-bold text-slate-800 dark:text-slate-200">{c.name}</td>
                          <td className="px-6 py-4 font-mono text-[10px]">{c.contest_slug}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              c.contest_status === 'RATED' ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400' :
                              c.contest_status === 'UNRATED' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' :
                              'bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400'
                            }`}>
                              {c.contest_status}
                            </span>
                          </td>
                          <td className="px-6 py-4 capitalize">{c.type}</td>
                          <td className="px-6 py-4 font-medium">{new Date(c.date).toLocaleDateString()}</td>
                          <td className="px-6 py-4">{c.total_students}</td>
                          <td className="px-6 py-4 text-emerald-600 font-semibold">{c.present_count}</td>
                          <td className="px-6 py-4 text-rose-500">{c.absent_count}</td>
                          <td className="px-6 py-4">
                            <span className="font-bold text-slate-800 dark:text-slate-100">{c.attendance_percentage}%</span>
                            <div className="w-24 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
                              <div className="bg-primary-500 h-full" style={{ width: `${c.attendance_percentage}%` }}></div>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            )}

            {/* 6. DETAILED ATTENDANCE LOG REPORT */}
            {activeTab === 'attendance-log' && (
              <div className="overflow-x-auto animate-fade-in">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="px-6 py-4">Register Number</th>
                      <th className="px-6 py-4">Student Name</th>
                      <th className="px-6 py-4">Dept / Sec</th>
                      <th className="px-6 py-4">Contest Name</th>
                      <th className="px-6 py-4">Contest Date</th>
                      <th className="px-6 py-4">Contest Status</th>
                      <th className="px-6 py-4">Attendance Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs text-slate-600 dark:text-slate-300">
                    {data.length === 0 ? (
                      <tr><td colSpan="7" className="text-center py-12 text-slate-400">No attendance logs recorded.</td></tr>
                    ) : (
                      data.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                          <td className="px-6 py-4 font-bold text-slate-800 dark:text-slate-200">{item.register_number}</td>
                          <td className="px-6 py-4 font-semibold">{item.student_name}</td>
                          <td className="px-6 py-4">{item.department} - Sec {item.section}</td>
                          <td className="px-6 py-4 font-bold text-slate-700 dark:text-slate-300">{item.contest_name}</td>
                          <td className="px-6 py-4 font-medium">{new Date(item.contest_date).toLocaleDateString()}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              item.contest_status === 'RATED' ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400' :
                              item.contest_status === 'UNRATED' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' :
                              'bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400'
                            }`}>
                              {item.contest_status}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                              item.attendance_status === 'PRESENT' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400' :
                              item.attendance_status === 'NOT_APPLICABLE' ? 'bg-slate-50 text-slate-700 dark:bg-slate-950/20' :
                              'bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400'
                            }`}>
                              {item.attendance_status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 2. STUDENT-WISE ATTENDANCE SUMMARY */}
            {activeTab === 'students' && (
              <div className="space-y-4 animate-fade-in">
                {/* Search & Filter row inside Tab */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-slate-50/40 dark:bg-slate-800/10 border-b border-slate-100 dark:border-slate-800">
                  <div className="relative">
                    <Search className="absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                      placeholder="Search student or handle..."
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 py-2 pl-8 pr-3 text-xs outline-none focus:border-primary-500 dark:text-white"
                    />
                  </div>
                  <select
                    value={studentDept}
                    onChange={(e) => setStudentDept(e.target.value)}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-primary-500 dark:text-slate-200"
                  >
                    <option value="">All Departments</option>
                    {availableDepts.map(d => (
                      <option key={d.id} value={d.code}>{d.code}</option>
                    ))}
                  </select>
                  <select
                    value={studentSec}
                    onChange={(e) => setStudentSec(e.target.value)}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-primary-500 dark:text-slate-200"
                  >
                    <option value="">All Sections</option>
                    {availableSections.map(sec => (
                      <option key={sec} value={sec}>Section {sec}</option>
                    ))}
                  </select>
                  <select
                    value={studentYear}
                    onChange={(e) => setStudentYear(e.target.value)}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-primary-500 dark:text-slate-200"
                  >
                    <option value="">All Batches</option>
                    {availableBatches.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>

                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span>From:</span>
                    <input
                      type="date"
                      value={filterStartDate}
                      onChange={(e) => setFilterStartDate(e.target.value)}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-2 py-1.5 outline-none focus:border-primary-500 dark:text-white"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span>To:</span>
                    <input
                      type="date"
                      value={filterEndDate}
                      onChange={(e) => setFilterEndDate(e.target.value)}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-2 py-1.5 outline-none focus:border-primary-500 dark:text-white"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="px-6 py-4">Roll Number</th>
                        <th className="px-6 py-4">Name</th>
                        <th className="px-6 py-4">Dept / Sec</th>
                        <th className="px-6 py-4">Batch</th>
                        <th className="px-6 py-4">LeetCode Username</th>
                        <th className="px-6 py-4">Rated Contests</th>
                        <th className="px-6 py-4">Unrated Contests</th>
                        <th className="px-6 py-4">Present</th>
                        <th className="px-6 py-4">Attendance %</th>
                        <th className="px-6 py-4">Rating</th>
                        <th className="px-6 py-4">Best Rating</th>
                        <th className="px-6 py-4">Rank History</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs text-slate-600 dark:text-slate-300">
                      {filteredStudentsReport.length === 0 ? (
                        <tr><td colSpan="12" className="text-center py-12 text-slate-400">No student performance records found.</td></tr>
                      ) : (
                        filteredStudentsReport.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                            <td className="px-6 py-4 font-bold text-slate-800 dark:text-slate-200">{s.register_number}</td>
                            <td className="px-6 py-4 font-semibold">{s.name}</td>
                            <td className="px-6 py-4">{s.department} • Sec {s.section}</td>
                            <td className="px-6 py-4">{s.academic_year}</td>
                            <td className="px-6 py-4 font-mono font-bold text-slate-500">{s.leetcode_username}</td>
                            <td className="px-6 py-4 font-bold">{s.rated_contests}</td>
                            <td className="px-6 py-4 font-bold">{s.unrated_contests}</td>
                            <td className="px-6 py-4 text-emerald-600 font-bold">{s.present_count}</td>
                            <td className="px-6 py-4">
                              <span className={`font-extrabold ${s.attendance_percentage < 75 ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200'}`}>
                                {s.attendance_percentage}%
                              </span>
                              {s.attendance_percentage < 75 && (
                                <span className="ml-2 inline-flex items-center rounded-md bg-rose-50 dark:bg-rose-950/20 px-1.5 py-0.5 text-[9px] font-bold text-rose-500 uppercase tracking-wide">
                                  Low
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 font-extrabold text-primary-600 dark:text-primary-400">{s.current_rating}</td>
                            <td className="px-6 py-4 font-semibold text-slate-500">{s.best_rating}</td>
                            <td className="px-6 py-4 max-w-[150px] truncate" title={s.rank_history}>{s.rank_history}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 3. DEPARTMENT-WISE STATISTICS */}
            {activeTab === 'departments' && (
              <div className="overflow-x-auto animate-fade-in">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="px-6 py-4">Department</th>
                      <th className="px-6 py-4">Registered Students</th>
                      <th className="px-6 py-4">Aggregated Present Records</th>
                      <th className="px-6 py-4">Total Logs</th>
                      <th className="px-6 py-4">Aggregated Attendance %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs text-slate-600 dark:text-slate-300">
                    {data.length === 0 ? (
                      <tr><td colSpan="5" className="text-center py-12 text-slate-400">No department statistics available.</td></tr>
                    ) : (
                      data.map((d, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                          <td className="px-6 py-4.5 font-bold text-slate-800 dark:text-slate-200">{d.department}</td>
                          <td className="px-6 py-4.5">{d.total_students}</td>
                          <td className="px-6 py-4.5 text-emerald-600 font-bold">{d.present_count}</td>
                          <td className="px-6 py-4.5">{d.total_records}</td>
                          <td className="px-6 py-4.5">
                            <span className="font-extrabold text-slate-800 dark:text-white">{d.attendance_percentage}%</span>
                            <div className="w-24 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
                              <div className="bg-indigo-500 h-full" style={{ width: `${d.attendance_percentage}%` }}></div>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 4. SECTION-WISE STATISTICS */}
            {activeTab === 'sections' && (
              <div className="overflow-x-auto animate-fade-in">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="px-6 py-4">Department</th>
                      <th className="px-6 py-4">Section</th>
                      <th className="px-6 py-4">Registered Students</th>
                      <th className="px-6 py-4">Aggregated Present Records</th>
                      <th className="px-6 py-4">Total Logs</th>
                      <th className="px-6 py-4">Aggregated Attendance %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs text-slate-600 dark:text-slate-300">
                    {data.length === 0 ? (
                      <tr><td colSpan="6" className="text-center py-12 text-slate-400">No section-wise statistics available.</td></tr>
                    ) : (
                      data.map((s, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                          <td className="px-6 py-4.5 font-bold text-slate-800 dark:text-slate-200">{s.department}</td>
                          <td className="px-6 py-4.5 font-semibold">Section {s.section}</td>
                          <td className="px-6 py-4.5">{s.total_students}</td>
                          <td className="px-6 py-4.5 text-emerald-600 font-bold">{s.present_count}</td>
                          <td className="px-6 py-4.5">{s.total_records}</td>
                          <td className="px-6 py-4.5 font-extrabold">{s.attendance_percentage}%</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 5. ATTENDANCE HEATMAP GRID */}
            {activeTab === 'heatmap' && heatmapData && (
              <div className="p-5 space-y-4 overflow-x-auto animate-fade-in">
                <div className="flex items-center gap-4 justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-2">
                  <div>
                    <h3 className="font-bold text-sm text-slate-800 dark:text-white">Recent 8 Contests Participation Matrix</h3>
                    <p className="text-[11px] text-slate-400">Visual breakdown of student presence in recent contests.</p>
                  </div>
                  {/* Legend */}
                  <div className="flex gap-3 text-[10px] font-bold">
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-500 shadow-sm inline-block"></span> Present</span>
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-rose-500 shadow-sm inline-block"></span> Absent</span>
                  </div>
                </div>

                <div className="min-w-[800px]">
                  {/* Headers */}
                  <div className="grid grid-cols-12 border-b border-slate-100 dark:border-slate-800 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">
                    <div className="col-span-3 text-left pl-3">Student Details</div>
                    {heatmapData.contests.map((c) => (
                      <div key={c.id} className="col-span-1 truncate px-1" title={c.name}>
                        {c.name.replace('Contest', '')}
                      </div>
                    ))}
                  </div>

                  {/* Matrix Rows */}
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
                    {heatmapData.students.length === 0 ? (
                      <p className="text-center py-10 text-slate-400 text-xs">No active students recorded.</p>
                    ) : (
                      heatmapData.students.map((student) => (
                        <div key={student.studentId} className="grid grid-cols-12 items-center py-2.5 text-xs text-center hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                          <div className="col-span-3 text-left pl-3 overflow-hidden">
                            <span className="font-bold block text-slate-800 dark:text-slate-200 truncate">{student.name}</span>
                            <span className="text-[10px] text-slate-400 tracking-wide font-medium uppercase">{student.registerNumber} • {student.leetcode_username || student.leetcodeUsername}</span>
                          </div>
                          {student.timeline.map((status, sidx) => (
                            <div key={sidx} className="col-span-1 flex justify-center">
                              <span 
                                className={`h-6 w-6 rounded-md flex items-center justify-center font-bold text-[10px] transition-all hover:scale-105 cursor-help ${
                                  status === 'present' 
                                    ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20' 
                                    : status === 'not_applicable'
                                    ? 'bg-slate-300 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                                    : 'bg-rose-500 text-white shadow-sm shadow-rose-500/20'
                                }`}
                                title={`${heatmapData.contests[sidx].name}: ${status.toUpperCase().replace('_', ' ')}`}
                              >
                                {status === 'present' ? 'P' : status === 'not_applicable' ? 'N/A' : 'A'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Reports;
