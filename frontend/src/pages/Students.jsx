import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Plus, 
  Search, 
  Upload, 
  Edit, 
  Trash2, 
  X, 
  Check, 
  AlertCircle, 
  Download, 
  Loader2, 
  CheckCircle2 
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getLeetCodeProfileUrl } from '../utils/platformUrls';
import { logger } from '../utils/logger';
import { normalizeHandle } from '../utils/normalization';

function Students() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterSec, setFilterSec] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Dynamic filter states
  const [availableDepts, setAvailableDepts] = useState([]);
  const [availableBatches, setAvailableBatches] = useState([]);
  const [availableSections, setAvailableSections] = useState([]);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);

  // Form states
  const [formData, setFormData] = useState({
    rollNo: '',
    name: '',
    department: '',
    section: '',
    academicBatch: '',
    leetcodeUsername: '',
    codechefUsername: '',
    codeforcesUsername: '',
    hackerrankUsername: '',
    academicStartDate: '',
    academicEndDate: ''
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Handle verification state (bonus feature)
  const [lcChecking, setLcChecking] = useState(false);
  const [lcVerified, setLcVerified] = useState(null); // null, true, false
  const [lcCheckedUsername, setLcCheckedUsername] = useState('');
  const [lcStats, setLcStats] = useState({ rating: null, globalRanking: null });
  const [platformChecks, setPlatformChecks] = useState({
    codechef: { checking: false, verified: null, username: '', stats: {} },
    codeforces: { checking: false, verified: null, username: '', stats: {} },
    hackerrank: { checking: false, verified: null, username: '', stats: {} }
  });

  // Import states
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);

  console.count("Students Render");
  console.log('[Students State Audit]', {
    platformChecks,
    formData,
    selectedStudent,
    lcVerified
  });

  // Fetch student listings
  const fetchStudents = async () => {
    setLoading(true);
    try {
      const params = {
        search,
        department: filterDept,
        section: filterSec,
        academicBatch: filterYear,
        status: 'active'
      };
      const res = await axios.get('/api/students', { params });
      if (res.data.success) {
        logger.debug('Received students list:', res.data.data);
        setStudents(res.data.data);
      }
    } catch (err) {
      setError('Failed to fetch students list.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch departments list
  const fetchAvailableDepts = async () => {
    try {
      const res = await axios.get('/api/departments');
      if (res.data.success) {
        setAvailableDepts(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch departments:', err);
    }
  };

  // Fetch unique batches
  const fetchAvailableBatches = async () => {
    try {
      const res = await axios.get('/api/students/batches');
      if (res.data.success) {
        setAvailableBatches(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch batches:', err);
    }
  };

  useEffect(() => {
    fetchAvailableDepts();
    fetchAvailableBatches();
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [search, filterDept, filterSec, filterYear]);

  // Fetch available sections dynamically when department or batch filters change
  useEffect(() => {
    const fetchAvailableSections = async () => {
      try {
        const params = { status: 'active' };
        if (filterDept) params.department = filterDept;
        if (filterYear) params.academicBatch = filterYear;
        const res = await axios.get('/api/students/sections', { params });
        if (res.data.success) {
          const sections = res.data.data;
          setAvailableSections(sections);
          // If current selection is not in the new list, reset to empty (All Sections)
          if (filterSec && !sections.includes(filterSec)) {
            setFilterSec('');
          }
        }
      } catch (err) {
        console.error('Failed to fetch sections:', err);
      }
    };
    fetchAvailableSections();
  }, [filterDept, filterYear]);

  // Handle inputs
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    
    if (name === 'leetcodeUsername') {
      const isUnchanged = lcCheckedUsername && value.trim().toLowerCase() === lcCheckedUsername.trim().toLowerCase();
      setLcVerified(isUnchanged ? true : null);
    }
    if (name === 'codechefUsername') {
      setPlatformChecks(prev => {
        const isUnchanged = prev.codechef.username && value.trim().toLowerCase() === prev.codechef.username.trim().toLowerCase();
        return {
          ...prev,
          codechef: {
            ...prev.codechef,
            verified: isUnchanged ? true : null,
            verifiedAt: isUnchanged ? prev.codechef.verifiedAt : null
          }
        };
      });
    }
    if (name === 'codeforcesUsername') {
      setPlatformChecks(prev => {
        const isUnchanged = prev.codeforces.username && normalizeHandle(value) === normalizeHandle(prev.codeforces.username);
        return {
          ...prev,
          codeforces: {
            ...prev.codeforces,
            verified: isUnchanged ? true : null,
            verifiedAt: isUnchanged ? prev.codeforces.verifiedAt : null
          }
        };
      });
    }
    if (name === 'hackerrankUsername') {
      setPlatformChecks(prev => {
        const isUnchanged = prev.hackerrank.username && value.trim().toLowerCase() === prev.hackerrank.username.trim().toLowerCase();
        return {
          ...prev,
          hackerrank: {
            ...prev.hackerrank,
            verified: isUnchanged ? true : null,
            verifiedAt: isUnchanged ? prev.hackerrank.verifiedAt : null
          }
        };
      });
    }
  };

  const handleVerifyPlatform = async (platform) => {
    const key = `${platform}Username`;
    const username = formData[key]?.trim();
    if (!username) return;

    setPlatformChecks(prev => ({
      ...prev,
      [platform]: { ...prev[platform], checking: true, verified: null, username: '', platform, verifiedAt: null, stats: {} }
    }));

    try {
      const res = await axios.get(`/api/students/verify-platform/${platform}/${encodeURIComponent(username)}`);
      const verified = Boolean(res.data.exists);
      setPlatformChecks(prev => ({
        ...prev,
        [platform]: {
          ...prev[platform],
          checking: false,
          verified,
          platform,
          verifiedAt: verified ? Date.now() : null,
          username: res.data.username || username,
          stats: { rating: res.data.rating, globalRanking: res.data.globalRanking }
        }
      }));
      if (verified) {
        setFormData(prev => ({ ...prev, [key]: res.data.username || username }));
      }
    } catch (err) {
      setPlatformChecks(prev => ({
        ...prev,
        [platform]: { ...prev[platform], checking: false, verified: false, username: '', platform, verifiedAt: null, stats: {} }
      }));
    }
  };

  // Verify LeetCode Username (Bonus Feature API helper)
  const handleVerifyLeetCode = async () => {
    const username = formData.leetcodeUsername.trim();
    if (!username) return;

    setLcChecking(true);
    setLcVerified(null);
    setLcCheckedUsername(username);
    setLcStats({ rating: null, globalRanking: null });

    try {
      const res = await axios.get(`/api/students/verify-leetcode/${username}`);
      if (res.data.exists) {
        setLcVerified(true);
        setFormData(prev => ({ ...prev, leetcodeUsername: res.data.username })); // use formatted handle name
        setLcStats({
          rating: res.data.rating,
          globalRanking: res.data.globalRanking
        });
      } else {
        setLcVerified(false);
      }
    } catch (err) {
      setLcVerified(false);
    } finally {
      setLcChecking(false);
    }
  };

  // Open modals
  const openAddModal = () => {
    setFormData({
      rollNo: '',
      name: '',
      department: '',
      section: '',
      academicBatch: '',
      leetcodeUsername: '',
      codechefUsername: '',
      codeforcesUsername: '',
      hackerrankUsername: '',
      academicStartDate: '',
      academicEndDate: ''
    });
    setFormError('');
    setLcVerified(null);
    setLcStats({ rating: null, globalRanking: null });
    setPlatformChecks({
      codechef: { checking: false, verified: null, username: '', platform: 'codechef', verifiedAt: null, stats: {} },
      codeforces: { checking: false, verified: null, username: '', platform: 'codeforces', verifiedAt: null, stats: {} },
      hackerrank: { checking: false, verified: null, username: '', platform: 'hackerrank', verifiedAt: null, stats: {} }
    });
    setIsAddModalOpen(true);
  };

  const openEditModal = (student) => {
    setSelectedStudent(student);
    setFormData({
      rollNo: student.roll_no,
      name: student.name,
      department: student.department,
      section: student.section,
      academicBatch: student.academic_batch,
      leetcodeUsername: student.leetcode_username || '',
      codechefUsername: student.codechef_username || '',
      codeforcesUsername: student.codeforces_username || '',
      hackerrankUsername: student.hackerrank_username || '',
      academicStartDate: student.academic_start_date ? student.academic_start_date.split('T')[0] : '',
      academicEndDate: student.academic_end_date ? student.academic_end_date.split('T')[0] : ''
    });
    setFormError('');
    setLcVerified(true); // already verified on initial setup
    setLcCheckedUsername(student.leetcode_username);
    setLcStats({ rating: null, globalRanking: null });

    const hasChef = !!student.codechef_username;
    const hasRank = !!student.hackerrank_username;
    const isForcesVerified = student.codeforces_verified === 1 || student.codeforces_verified === true;
    setPlatformChecks({
      codechef: { checking: false, verified: hasChef ? true : null, username: student.codechef_username || '', platform: 'codechef', verifiedAt: hasChef ? Date.now() : null, stats: {} },
      codeforces: { 
        checking: false, 
        verified: isForcesVerified, 
        username: student.codeforces_username || '', 
        platform: 'codeforces', 
        verifiedAt: student.codeforces_verified_at || null, 
        stats: { rating: student.codeforces_rating || null, globalRanking: student.codeforces_rank || null } 
      },
      hackerrank: { checking: false, verified: hasRank ? true : null, username: student.hackerrank_username || '', platform: 'hackerrank', verifiedAt: hasRank ? Date.now() : null, stats: {} }
    });
    setIsEditModalOpen(true);
  };

  // Save student
  const handleAddStudent = async (e) => {
    e.preventDefault();
    setFormError('');

    console.log({
      codeforcesUsername: formData.codeforcesUsername,
      codeforcesVerified: platformChecks.codeforces.verified,
      previousVerifiedUsername: platformChecks.codeforces.username
    });

    if (lcVerified !== true) {
      setFormError('Please verify the LeetCode username before saving.');
      return;
    }

    if (formData.codechefUsername?.trim() && platformChecks.codechef.verified !== true) {
      setFormError('Please verify the CodeChef username before saving.');
      return;
    }

    if (formData.codeforcesUsername?.trim() && platformChecks.codeforces.verified !== true) {
      setFormError('Please verify the Codeforces handle before saving.');
      return;
    }

    if (formData.hackerrankUsername?.trim() && platformChecks.hackerrank.verified !== true) {
      setFormError('Please verify the HackerRank username before saving.');
      return;
    }

    setFormLoading(true);
    try {
      const payload = {
        ...formData,
        leetcodeVerified: lcVerified === true,
        codechefVerified: platformChecks.codechef.verified === true,
        codeforcesVerified: platformChecks.codeforces.verified === true,
        hackerrankVerified: platformChecks.hackerrank.verified === true
      };
      const res = await axios.post('/api/students', payload);
      if (res.data.success) {
        setIsAddModalOpen(false);
        setSuccessMsg('Student added successfully.');
        fetchStudents();
        fetchAvailableBatches();
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch (err) {
      setFormError(err.response?.data?.message || 'Error occurred while saving student.');
    } finally {
      setFormLoading(false);
    }
  };

  // Update student
  const handleEditStudent = async (e) => {
    e.preventDefault();
    setFormError('');

    console.log({
      codeforcesUsername: formData.codeforcesUsername,
      codeforcesVerified: platformChecks.codeforces.verified,
      previousVerifiedUsername: platformChecks.codeforces.username
    });

    if (lcVerified !== true) {
      setFormError('Please verify the LeetCode username before saving.');
      return;
    }

    if (formData.codechefUsername?.trim() && platformChecks.codechef.verified !== true) {
      setFormError('Please verify the CodeChef username before saving.');
      return;
    }

    if (formData.codeforcesUsername?.trim() && platformChecks.codeforces.verified !== true) {
      setFormError('Please verify the Codeforces handle before saving.');
      return;
    }

    if (formData.hackerrankUsername?.trim() && platformChecks.hackerrank.verified !== true) {
      setFormError('Please verify the HackerRank username before saving.');
      return;
    }

    setFormLoading(true);
    try {
      const payload = {
        ...formData,
        leetcodeVerified: lcVerified === true,
        codechefVerified: platformChecks.codechef.verified === true,
        codeforcesVerified: platformChecks.codeforces.verified === true,
        codeforcesRating: platformChecks.codeforces.stats?.rating ?? null,
        codeforcesRank: platformChecks.codeforces.stats?.globalRanking ?? null,
        hackerrankVerified: platformChecks.hackerrank.verified === true
      };
      const res = await axios.put(`/api/students/${selectedStudent.id}`, payload);
      if (res.data.success) {
        setIsEditModalOpen(false);
        setSuccessMsg('Student details updated.');
        fetchStudents();
        fetchAvailableBatches();
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch (err) {
      setFormError(err.response?.data?.message || 'Error updating student.');
    } finally {
      setFormLoading(false);
    }
  };

  // Delete student
  const handleDeleteStudent = async (id) => {
    if (!window.confirm('Are you sure you want to delete this student? All attendance history will be deleted!')) return;
    try {
      const res = await axios.delete(`/api/students/${id}`);
      if (res.data.success) {
        setSuccessMsg('Student deleted.');
        fetchStudents();
        fetchAvailableBatches();
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch (err) {
      setError('Failed to delete student.');
    }
  };

  // File import
  const handleImportSubmit = async (e) => {
    e.preventDefault();
    if (!importFile) return;

    setImporting(true);
    setImportResults(null);
    setError('');

    const form = new FormData();
    form.append('file', importFile);

    try {
      const res = await axios.post('/api/students/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.success) {
        setImportResults(res.data);
        fetchStudents();
        fetchAvailableBatches();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Import failed. Check Excel structure.');
    } finally {
      setImporting(false);
    }
  };

  // Download template
  const downloadTemplate = () => {
    const headers = [
      { 'Roll Number': '311520104001', 'Name': 'John Doe', 'Department': 'CSE', 'Section': 'A', 'Academic Batch': '2024-2028', 'LeetCode Username': 'johndoe_lc', 'Academic Start Date': '2024-07-01', 'Academic End Date': '2028-06-30' }
    ];
    const ws = XLSX.utils.json_to_sheet(headers);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'student_bulk_import_template.xlsx');
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Student Directory</h1>
          <p className="text-sm text-slate-400">Add, edit, or import student details.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-1.5 px-4.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-50 transition-all shadow-sm"
          >
            <Upload className="h-4 w-4" /> Bulk Import
          </button>
          <button
            onClick={openAddModal}
            className="flex items-center gap-1.5 px-4.5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold transition-all shadow-md shadow-primary-500/10"
          >
            <Plus className="h-4 w-4" /> Add Student
          </button>
        </div>
      </div>

      {/* Success alert */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 p-4 text-xs font-semibold text-emerald-600 dark:text-emerald-400 animate-fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Search & Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-4 shadow-sm">
        {/* Search */}
        <div className="relative lg:col-span-2">
          <Search className="absolute inset-y-0 left-3 my-auto h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, registration, or LeetCode..."
            className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-primary-500 focus:bg-white transition-all dark:text-white"
          />
        </div>

        {/* Dept filter */}
        <select
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-3 py-2.5 text-sm outline-none focus:border-primary-500 dark:text-slate-200"
        >
          <option value="">All Departments</option>
          {availableDepts.map(dept => (
            <option key={dept.id} value={dept.code}>{dept.code}</option>
          ))}
        </select>

        {/* Section filter */}
        <select
          value={filterSec}
          onChange={(e) => setFilterSec(e.target.value)}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-3 py-2.5 text-sm outline-none focus:border-primary-500 dark:text-slate-200"
        >
          <option value="">All Sections</option>
          {availableSections.map(sec => (
            <option key={sec} value={sec}>Section {sec}</option>
          ))}
        </select>

        {/* Batch filter */}
        <select
          value={filterYear}
          onChange={(e) => setFilterYear(e.target.value)}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 px-3 py-2.5 text-sm outline-none focus:border-primary-500 dark:text-slate-200"
        >
          <option value="">All Academic Batches</option>
          {availableBatches.map(batch => (
            <option key={batch} value={batch}>{batch}</option>
          ))}
        </select>
      </div>

      {/* Directory Table */}
      <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-6 py-4.5">Roll Number</th>
                <th className="px-6 py-4.5">Name</th>
                <th className="px-6 py-4.5">Department</th>
                <th className="px-6 py-4.5">Section</th>
                <th className="px-6 py-4.5">Academic Batch</th>
                <th className="px-6 py-4.5">Start Date</th>
                <th className="px-6 py-4.5">End Date</th>
                <th className="px-6 py-4.5">LeetCode handle</th>
                <th className="px-6 py-4.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm text-slate-600 dark:text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="9" className="text-center py-12">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center py-12 text-slate-400">
                    No active students found.
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr key={student.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-800 dark:text-slate-200">{student.roll_no}</td>
                    <td className="px-6 py-4 font-medium">{student.name}</td>
                    <td className="px-6 py-4">{student.department}</td>
                    <td className="px-6 py-4">{student.section}</td>
                    <td className="px-6 py-4">{student.academic_batch}</td>
                    <td className="px-6 py-4 font-mono text-xs">{student.academic_start_date ? new Date(student.academic_start_date).toLocaleDateString(undefined, {dateStyle: 'medium'}) : '-'}</td>
                    <td className="px-6 py-4 font-mono text-xs">{student.academic_end_date ? new Date(student.academic_end_date).toLocaleDateString(undefined, {dateStyle: 'medium'}) : '-'}</td>
                    <td className="px-6 py-4">
                      {student.leetcode_username ? (
                        <a 
                          href={getLeetCodeProfileUrl(student.leetcode_username)} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-primary-550 hover:underline font-semibold"
                        >
                          {student.leetcode_username}
                        </a>
                      ) : (
                        <span className="text-slate-400 italic">Not Registered</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right space-x-1.5">
                      <button 
                        onClick={() => openEditModal(student)}
                        className="inline-flex rounded-lg p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Edit Student"
                      >
                        <Edit className="h-4.5 w-4.5" />
                      </button>
                      <button 
                        onClick={() => handleDeleteStudent(student.id)}
                        className="inline-flex rounded-lg p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                        title="Delete Student"
                      >
                        <Trash2 className="h-4.5 w-4.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Student Modal */}
      {(isAddModalOpen || isEditModalOpen) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 py-4">
          <div className="relative flex w-full max-w-lg max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl animate-fade-in">
            {/* Modal Title */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                {isAddModalOpen ? 'Add Student Profile' : 'Edit Student Profile'}
              </h3>
              <button 
                onClick={() => { setIsAddModalOpen(false); setIsEditModalOpen(false); }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              <form id={isAddModalOpen ? 'add-student-form' : 'edit-student-form'} onSubmit={isAddModalOpen ? handleAddStudent : handleEditStudent} className="space-y-4">
                {formError && (
                  <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/25 border border-rose-100 dark:border-rose-900/30 p-3 text-xs font-semibold text-rose-600 dark:text-rose-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Roll Number</label>
                    <input
                      type="text"
                      name="rollNo"
                      required
                      disabled={isEditModalOpen} // lock in edit
                      value={formData.rollNo}
                      onChange={handleInputChange}
                      placeholder="311520104001"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:text-white disabled:opacity-50"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Full Name</label>
                    <input
                      type="text"
                      name="name"
                      required
                      value={formData.name}
                      onChange={handleInputChange}
                      placeholder="John Doe"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Department</label>
                    <select
                      name="department"
                      required
                      value={formData.department}
                      onChange={handleInputChange}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2.5 text-sm outline-none focus:border-primary-500 dark:text-white"
                    >
                      <option value="">Select Dept</option>
                      {availableDepts
                        .filter(d => d.status === 'active' || d.code === formData.department)
                        .map(dept => (
                          <option key={dept.id} value={dept.code}>
                            {dept.code} - {dept.name}
                          </option>
                        ))
                      }
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Section</label>
                    <input
                      type="text"
                      name="section"
                      required
                      value={formData.section}
                      onChange={handleInputChange}
                      placeholder="A"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Academic Batch</label>
                    <input
                      type="text"
                      name="academicBatch"
                      required
                      value={formData.academicBatch}
                      onChange={handleInputChange}
                      placeholder="2024-2028"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Academic Start Date</label>
                    <input
                      type="date"
                      name="academicStartDate"
                      required
                      value={formData.academicStartDate}
                      onChange={handleInputChange}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Academic End Date</label>
                    <input
                      type="date"
                      name="academicEndDate"
                      required
                      value={formData.academicEndDate}
                      onChange={handleInputChange}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:text-white"
                    />
                  </div>
                </div>

                {/* Handle verification form field */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">LeetCode Username</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        name="leetcodeUsername"
                        required
                        value={formData.leetcodeUsername}
                        onChange={handleInputChange}
                        placeholder="e.g. neetcode"
                        className={`w-full rounded-xl border bg-white dark:bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:text-white ${
                          lcVerified === true ? 'border-emerald-500 pr-9' : lcVerified === false ? 'border-rose-500 pr-9' : 'border-slate-200 dark:border-slate-800'
                        }`}
                      />
                      <div className="absolute inset-y-0 right-3 flex items-center">
                        {lcChecking && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                        {!lcChecking && lcVerified === true && <Check className="h-4 w-4 text-emerald-500 font-bold" />}
                        {!lcChecking && lcVerified === false && <X className="h-4 w-4 text-rose-500 font-bold" />}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleVerifyLeetCode}
                      disabled={lcChecking || !formData.leetcodeUsername.trim() || lcVerified === true}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 px-4 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-40"
                    >
                      {lcVerified === true ? '✓ Verified' : (lcCheckedUsername && formData.leetcodeUsername !== lcCheckedUsername ? 'Verify Again' : 'Verify Handle')}
                    </button>
                  </div>
                  {lcVerified === false && (
                    <p className="text-[10px] text-rose-500 font-semibold mt-1">
                      Handle does not exist on LeetCode.com. Verify spelling.
                    </p>
                  )}
                  {lcVerified === true && lcCheckedUsername === formData.leetcodeUsername && (
                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1.5 space-y-0.5 p-2.5 bg-emerald-50/40 dark:bg-emerald-950/10 border border-emerald-100/40 dark:border-emerald-900/30 rounded-xl">
                      <p className="font-bold">✓ Profile Found: Valid Username</p>
                      <p>Correctly capitalized: <b>{formData.leetcodeUsername}</b></p>
                      {lcStats.rating ? (
                        <p>Current Rating: <b>{lcStats.rating}</b> {lcStats.globalRanking && <>• Global Rank: <b>#{lcStats.globalRanking}</b></>}</p>
                      ) : (
                        <p>Current Rating: <i>No contest rating found (Unrated)</i></p>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-2xl border border-slate-200/70 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Additional Competitive Programming Profiles</p>
                      <p className="text-[11px] text-slate-400">Verify CodeChef, Codeforces, and HackerRank handles independently.</p>
                    </div>
                  </div>

                  {['codechef', 'codeforces', 'hackerrank'].map((platform) => {
                    const fieldName = `${platform === 'codechef' ? 'codechef' : platform === 'codeforces' ? 'codeforces' : 'hackerrank'}Username`;
                    const label = platform === 'codechef' ? 'CodeChef Username' : platform === 'codeforces' ? 'Codeforces Username' : 'HackerRank Username';
                    const checkState = platformChecks[platform];
                    const inputName = fieldName;
                    return (
                      <div key={platform} className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input
                              type="text"
                              name={inputName}
                              value={formData[inputName]}
                              onChange={handleInputChange}
                              placeholder={platform === 'codechef' ? 'e.g. chef_123' : platform === 'codeforces' ? 'e.g. tourist' : 'e.g. hacker_rank'}
                              className={`w-full rounded-xl border bg-white dark:bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:text-white ${
                                checkState.verified === true ? 'border-emerald-500 pr-9' : checkState.verified === false ? 'border-rose-500 pr-9' : 'border-slate-200 dark:border-slate-800'
                              }`}
                            />
                            <div className="absolute inset-y-0 right-3 flex items-center">
                              {checkState.checking && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                              {!checkState.checking && checkState.verified === true && <Check className="h-4 w-4 text-emerald-500 font-bold" />}
                              {!checkState.checking && checkState.verified === false && <X className="h-4 w-4 text-rose-500 font-bold" />}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleVerifyPlatform(platform)}
                            disabled={checkState.checking || !formData[inputName]?.trim() || checkState.verified === true}
                            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 px-4 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-40"
                          >
                            {checkState.verified === true ? '✓ Verified' : (checkState.username && formData[inputName] !== checkState.username ? 'Verify Again' : 'Verify Handle')}
                          </button>
                        </div>
                        {checkState.verified === false && (
                          <p className="text-[10px] text-rose-500 font-semibold mt-1">
                            {platform === 'codeforces' ? 'Invalid Codeforces Handle' : `Handle could not be verified on ${platform === 'codechef' ? 'CodeChef' : 'HackerRank'}.`}
                          </p>
                        )}
                        {checkState.verified === true && checkState.username && (
                          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1.5">✓ {label.split(' ')[0]} profile verified{checkState.stats.rating ? ` • Rating ${checkState.stats.rating}` : ''}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </form>
            </div>

            {/* Action Buttons */}
            <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 bg-white/95 px-6 py-4 backdrop-blur-sm dark:bg-slate-900/95">
              <button
                type="button"
                onClick={() => { setIsAddModalOpen(false); setIsEditModalOpen(false); }}
                className="rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                form={isAddModalOpen ? 'add-student-form' : 'edit-student-form'}
                disabled={
                  formLoading ||
                  lcVerified !== true ||
                  (formData.codechefUsername?.trim() && platformChecks.codechef.verified !== true) ||
                  (formData.codeforcesUsername?.trim() && platformChecks.codeforces.verified !== true) ||
                  (formData.hackerrankUsername?.trim() && platformChecks.hackerrank.verified !== true)
                }
                className="rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-5 py-2.5 text-xs font-semibold shadow-md shadow-primary-500/10 flex items-center gap-1.5"
              >
                {formLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : isAddModalOpen ? 'Add Student' : 'Save Student'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-5">
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Bulk Import Student Profiles</h3>
                <p className="text-xs text-slate-400 mt-0.5">Upload a sheet to import multiple students at once.</p>
              </div>
              <button 
                onClick={() => { setIsImportModalOpen(false); setImportFile(null); setImportResults(null); }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Template instructions */}
            <div className="flex items-center justify-between p-3.5 bg-primary-50/50 dark:bg-primary-950/20 border border-primary-100/60 dark:border-primary-900/20 rounded-xl mb-5 text-xs">
              <div>
                <span className="font-semibold text-primary-800 dark:text-primary-400 block">Download Template</span>
                <span className="text-slate-500 dark:text-slate-400 text-[11px]">Download our pre-structured Excel template to prevent mapping errors.</span>
              </div>
              <button
                onClick={downloadTemplate}
                className="flex items-center gap-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold text-primary-600 dark:text-primary-400 shadow-sm"
              >
                <Download className="h-4 w-4" /> template.xlsx
              </button>
            </div>

            {/* Form */}
            {!importResults ? (
              <form onSubmit={handleImportSubmit} className="space-y-5">
                {error && (
                  <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/25 border border-rose-100 dark:border-rose-900/30 p-3 text-xs font-semibold text-rose-600 dark:text-rose-400">
                    <AlertCircle className="h-4 w-4" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-8 hover:bg-slate-50/40 dark:hover:bg-slate-800/10 transition-colors">
                  <Upload className="h-8 w-8 text-slate-400 mb-2" />
                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 block">Select Excel File</span>
                  <span className="text-xs text-slate-400 mt-1 mb-4">Supports .xlsx, .xls formats up to 5MB</span>
                  
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    required
                    onChange={(e) => setImportFile(e.target.files[0])}
                    className="text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 dark:file:bg-slate-800 dark:file:text-slate-200"
                  />
                  {importFile && (
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-3">Selected: {importFile.name}</p>
                  )}
                </div>

                <div className="flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4 mt-6">
                  <button
                    type="button"
                    onClick={() => { setIsImportModalOpen(false); setImportFile(null); }}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={importing || !importFile}
                    className="rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-5 py-2.5 text-xs font-semibold shadow-md shadow-primary-500/10 flex items-center gap-1.5"
                  >
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Run Import'}
                  </button>
                </div>
              </form>
            ) : (
              /* Display import report summary results */
              <div className="space-y-4 animate-fade-in">
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 rounded-2xl flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <h4 className="font-bold text-emerald-800 dark:text-emerald-400">Import Process Completed!</h4>
                    <p className="text-emerald-600 dark:text-emerald-500 mt-1">
                      Successfully imported <b>{importResults.details.importedCount}</b> student profiles into the database.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Duplicates block */}
                  <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3.5 text-xs">
                    <span className="font-bold text-slate-700 dark:text-slate-300 block mb-2">Duplicate Rows ({importResults.details.duplicates.length})</span>
                    {importResults.details.duplicates.length === 0 ? (
                      <p className="text-slate-400 italic">No duplicates detected.</p>
                    ) : (
                      <ul className="list-disc pl-4 space-y-1 text-slate-500 max-h-36 overflow-y-auto">
                        {importResults.details.duplicates.map((d, idx) => <li key={`${d}_${idx}`}>{d}</li>)}
                      </ul>
                    )}
                  </div>

                  {/* Invalid Handles block */}
                  <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3.5 text-xs">
                    <span className="font-bold text-slate-700 dark:text-slate-300 block mb-2">Invalid LeetCode Handles ({importResults.details.invalidHandles.length})</span>
                    {importResults.details.invalidHandles.length === 0 ? (
                      <p className="text-slate-400 italic">All LeetCode usernames verified.</p>
                    ) : (
                      <ul className="list-disc pl-4 space-y-1 text-slate-500 max-h-36 overflow-y-auto">
                        {importResults.details.invalidHandles.map((h, idx) => <li key={`${h}_${idx}`}>{h}</li>)}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={() => { setIsImportModalOpen(false); setImportFile(null); setImportResults(null); }}
                    className="rounded-xl bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 text-xs font-semibold shadow-sm"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Students;
