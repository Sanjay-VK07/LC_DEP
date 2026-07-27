import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api';
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

  // Bulk delete state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(null); // { mode: 'selected' | 'filter', count, description }

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
  const [importBatch, setImportBatch] = useState('');
  const [updateExisting, setUpdateExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);
  const [importProgress, setImportProgress] = useState(null); // { batch, totalBatches, rowsDone, totalRows }

  // Lock body scrolling when any modal is open
  useEffect(() => {
    if (isImportModalOpen || isAddModalOpen || isEditModalOpen || bulkDeleteConfirm) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isImportModalOpen, isAddModalOpen, isEditModalOpen, bulkDeleteConfirm]);

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
      const res = await axios.get(`${API_URL}/students`, { params });
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
      const res = await axios.get(`${API_URL}/departments`);
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
      const res = await axios.get(`${API_URL}/students/batches`);
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
        const res = await axios.get(`${API_URL}/students/sections`, { params });
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
      const res = await axios.get(`${API_URL}/students/verify-platform/${platform}/${encodeURIComponent(username)}`);
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
      const res = await axios.get(`${API_URL}/students/verify-leetcode/${username}`);
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
      const res = await axios.post(`${API_URL}/students`, payload);
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
      const res = await axios.put(`${API_URL}/students/${selectedStudent.id}`, payload);
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
      const res = await axios.delete(`${API_URL}/students/${id}`);
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

  // Row selection for bulk delete
  const toggleSelectId = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds(prev => {
      const allVisibleSelected = students.length > 0 && students.every(s => prev.has(s.id));
      if (allVisibleSelected) return new Set();
      return new Set(students.map(s => s.id));
    });
  };

  const openBulkDeleteSelectedConfirm = () => {
    if (selectedIds.size === 0) return;
    setBulkDeleteConfirm({
      mode: 'selected',
      count: selectedIds.size,
      description: `${selectedIds.size} selected student(s)`
    });
  };

  const openBulkDeleteByFilterConfirm = () => {
    if (!filterDept || !filterYear) return;
    const count = students.length;
    setBulkDeleteConfirm({
      mode: 'filter',
      count,
      description: `all students matching Department "${filterDept}", Batch "${filterYear}"${filterSec ? `, Section "${filterSec}"` : ''} (${count} student(s) currently listed)`
    });
  };

  const executeBulkDelete = async () => {
    if (!bulkDeleteConfirm) return;
    setBulkDeleting(true);
    try {
      const payload = bulkDeleteConfirm.mode === 'selected'
        ? { studentIds: Array.from(selectedIds) }
        : { department: filterDept, academicBatch: filterYear, section: filterSec || undefined };

      const res = await axios.post(`${API_URL}/students/bulk-delete`, payload);
      if (res.data.success) {
        setSuccessMsg(res.data.message || `Deleted ${res.data.deletedCount} student(s).`);
        setSelectedIds(new Set());
        fetchStudents();
        fetchAvailableBatches();
        setTimeout(() => setSuccessMsg(''), 4000);
      } else {
        setError(res.data.message || 'Bulk delete failed.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Bulk delete failed.');
    } finally {
      setBulkDeleting(false);
      setBulkDeleteConfirm(null);
    }
  };

  // File import — parsed client-side and sent in small batches so a single network drop
  // only costs one batch's progress instead of the whole file (each batch is its own
  // DB transaction on the backend).
  const IMPORT_BATCH_SIZE = 100;
  const IMPORT_BATCH_RETRIES = 2;

  const handleImportSubmit = async (e) => {
    e.preventDefault();
    if (!importFile || !importBatch.trim()) return;

    setImporting(true);
    setImportResults(null);
    setError('');

    let rows;
    try {
      const buffer = await importFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet);
    } catch (parseErr) {
      setError('Could not read the Excel file. Check its structure.');
      setImporting(false);
      return;
    }

    if (rows.length === 0) {
      setError('Excel file is empty.');
      setImporting(false);
      return;
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const totalBatches = Math.ceil(rows.length / IMPORT_BATCH_SIZE);
    const aggregate = {
      totalRows: rows.length,
      importedCount: 0,
      invalidLeetCodeCount: 0,
      duplicateCount: 0,
      pendingCount: 0,
      skippedCount: 0,
      imported: [],
      invalidLeetCode: [],
      duplicates: [],
      invalidHandles: [],
      errors: [],
      processingTimeMs: 0,
      reportFilename: '',
      invalidFilename: ''
    };

    setImportProgress({ batch: 0, totalBatches, rowsDone: 0, totalRows: rows.length });

    for (let b = 0; b < totalBatches; b++) {
      const chunk = rows.slice(b * IMPORT_BATCH_SIZE, (b + 1) * IMPORT_BATCH_SIZE);
      let lastErr = null;
      let succeeded = false;

      for (let attempt = 0; attempt <= IMPORT_BATCH_RETRIES && !succeeded; attempt++) {
        try {
          const res = await axios.post(`${API_URL}/students/import`, {
            students: chunk,
            academicBatch: importBatch.trim(),
            duplicateStrategy: updateExisting ? 'update' : 'skip',
            importSessionId: sessionId,
            batchIndex: b
          });
          if (res.data.success) {
            const d = res.data.details || {};
            aggregate.importedCount += d.importedCount || 0;
            if (d.imported) aggregate.imported.push(...d.imported);
            aggregate.invalidLeetCodeCount += d.invalidLeetCodeCount || 0;
            if (d.invalidLeetCode) aggregate.invalidLeetCode.push(...d.invalidLeetCode);
            aggregate.duplicateCount += d.duplicateCount || 0;
            if (d.duplicates) aggregate.duplicates.push(...d.duplicates);
            aggregate.pendingCount += d.pendingCount || 0;
            aggregate.skippedCount += d.skippedCount || 0;
            if (d.invalidHandles) aggregate.invalidHandles.push(...d.invalidHandles);
            if (d.errors) aggregate.errors.push(...d.errors);
            aggregate.processingTimeMs += d.processingTimeMs || 0;
            if (d.reportFilename) aggregate.reportFilename = d.reportFilename;
            if (d.invalidFilename) aggregate.invalidFilename = d.invalidFilename;
            succeeded = true;
          } else {
            lastErr = res.data.message || 'Unknown error';
          }
        } catch (err) {
          lastErr = err.response?.data?.message || err.message || 'Network error';
        }
      }

      if (!succeeded) {
        aggregate.errors.push(`Batch ${b + 1} (rows ${b * IMPORT_BATCH_SIZE + 1}-${Math.min((b + 1) * IMPORT_BATCH_SIZE, rows.length)}): ${lastErr}`);
      }

      setImportProgress({ batch: b + 1, totalBatches, rowsDone: Math.min((b + 1) * IMPORT_BATCH_SIZE, rows.length), totalRows: rows.length });
      fetchStudents();
    }

    aggregate.processingTime = `${(aggregate.processingTimeMs / 1000).toFixed(2)}s`;

    setImportResults({
      success: true,
      message: `Processed ${rows.length} rows across ${totalBatches} batch(es). Imported: ${aggregate.importedCount}, Invalid LeetCode IDs: ${aggregate.invalidLeetCodeCount}, Duplicates: ${aggregate.duplicateCount}`,
      details: aggregate
    });
    fetchStudents();
    fetchAvailableBatches();
    setImportProgress(null);
    setImporting(false);
  };

  // Download Full 2-Sheet Excel Report (BulkImportReport_YYYY-MM-DD_HH-mm.xlsx)
  const downloadFullReport = (details) => {
    if (!details) return;
    const importedList = details.imported || [];
    const invalidList = details.invalidLeetCode || [];

    const wb = XLSX.utils.book_new();

    // Sheet 1: Imported Students
    const sheet1Rows = importedList.map(item => ({
      'Roll Number': item.rollNo || item.roll_no || '',
      'Student Name': item.name || '',
      'Department': item.department || '',
      'Section': item.section || '',
      'LeetCode Username': item.leetcodeUsername || item.leetcode_username || '',
      'CodeChef Username': item.codechefUsername || item.codechef_username || '-',
      'Codeforces Username': item.codeforcesUsername || item.codeforces_username || '-',
      'HackerRank Username': item.hackerrankUsername || item.hackerrank_username || '-',
      'Status': item.status || 'Imported'
    }));
    const ws1 = XLSX.utils.json_to_sheet(sheet1Rows.length > 0 ? sheet1Rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws1, 'Imported Students');

    // Sheet 2: Invalid LeetCode IDs
    const sheet2Rows = invalidList.map(item => ({
      'Roll Number': item.rollNo || item.roll_no || '',
      'Student Name': item.name || '',
      'Department': item.department || '',
      'Section': item.section || '',
      'LeetCode Username': item.leetcodeUsername || item.leetcode_username || '',
      'Reason': item.reason || ''
    }));
    const ws2 = XLSX.utils.json_to_sheet(sheet2Rows.length > 0 ? sheet2Rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws2, 'Invalid LeetCode IDs');

    const filename = details.reportFilename || `BulkImportReport_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  // Download Only Invalid LeetCode IDs Excel Report (InvalidLeetCodeIDs_YYYY-MM-DD_HH-mm.xlsx)
  const downloadInvalidIDsReport = (details) => {
    if (!details) return;
    const invalidList = details.invalidLeetCode || [];

    const wb = XLSX.utils.book_new();
    const sheetRows = invalidList.map(item => ({
      'Roll Number': item.rollNo || item.roll_no || '',
      'Student Name': item.name || '',
      'Department': item.department || '',
      'Section': item.section || '',
      'LeetCode Username': item.leetcodeUsername || item.leetcode_username || '',
      'Reason': item.reason || ''
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows.length > 0 ? sheetRows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, 'Invalid LeetCode IDs');

    const filename = details.invalidFilename || `InvalidLeetCodeIDs_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  // Download template
  const downloadTemplate = () => {
    const headers = [
      { 'S.No.': 1, 'Reg No.': '311520104001', 'Student Name': 'John Doe', 'Dept': 'CSE', 'Sec': 'A', 'LeetCode ID': 'johndoe_lc', 'CodeChef ID': 'johndoe_cc', 'Codeforces ID': 'johndoe_cf', 'hackerrank_username': 'johndoe_hr' }
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
          {selectedIds.size > 0 && (
            <button
              onClick={openBulkDeleteSelectedConfirm}
              className="flex items-center gap-1.5 px-4.5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-all shadow-md shadow-rose-500/10"
            >
              <Trash2 className="h-4 w-4" /> Delete Selected ({selectedIds.size})
            </button>
          )}
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

      {filterDept && filterYear && (
        <div className="flex items-center justify-between rounded-xl border border-rose-200/60 dark:border-rose-900/30 bg-rose-50/50 dark:bg-rose-950/10 px-4 py-3">
          <span className="text-xs text-rose-700 dark:text-rose-400">
            Deleting by filter permanently removes every student matching Department "{filterDept}", Batch "{filterYear}"{filterSec ? `, Section "${filterSec}"` : ''} ({students.length} currently listed).
          </span>
          <button
            onClick={openBulkDeleteByFilterConfirm}
            disabled={students.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold transition-all shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete All Matching Filters
          </button>
        </div>
      )}

      {/* Directory Table */}
      <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-6 py-4.5 w-10">
                  <input
                    type="checkbox"
                    checked={students.length > 0 && students.every(s => selectedIds.has(s.id))}
                    onChange={toggleSelectAllVisible}
                  />
                </th>
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
                  <td colSpan="10" className="text-center py-12">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan="10" className="text-center py-12 text-slate-400">
                    No active students found.
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr key={student.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(student.id)}
                        onChange={() => toggleSelectId(student.id)}
                      />
                    </td>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 py-6 overflow-hidden">
          <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in overflow-hidden">
            {/* Header - Fixed */}
            <div className="flex-shrink-0 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Bulk Import Student Profiles</h3>
                <p className="text-xs text-slate-400 mt-0.5">Upload a sheet to import multiple students at once.</p>
              </div>
              <button
                onClick={() => { setIsImportModalOpen(false); setImportFile(null); setImportBatch(''); setUpdateExisting(false); setImportResults(null); }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-1 space-y-4">
              {/* Template instructions */}
              <div className="flex items-center justify-between p-3.5 bg-primary-50/50 dark:bg-primary-950/20 border border-primary-100/60 dark:border-primary-900/20 rounded-xl text-xs">
                <div>
                  <span className="font-semibold text-primary-800 dark:text-primary-400 block">Download Template</span>
                  <span className="text-slate-500 dark:text-slate-400 text-[11px]">Download our pre-structured Excel template to prevent mapping errors.</span>
                </div>
                <button
                  onClick={downloadTemplate}
                  className="flex items-center gap-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold text-primary-600 dark:text-primary-400 shadow-sm shrink-0"
                >
                  <Download className="h-4 w-4" /> template.xlsx
                </button>
              </div>

              {/* Form or Results */}
              {!importResults ? (
                <form id="bulk-import-form" onSubmit={handleImportSubmit} className="space-y-4">
                  {error && (
                    <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/25 border border-rose-100 dark:border-rose-900/30 p-3 text-xs font-semibold text-rose-600 dark:text-rose-400">
                      <AlertCircle className="h-4 w-4" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Academic Batch (applies to all rows in this file)</label>
                    <input
                      type="text"
                      required
                      placeholder="2024-2028"
                      value={importBatch}
                      onChange={(e) => setImportBatch(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-700 dark:text-slate-200"
                    />
                  </div>

                  <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-3.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={updateExisting}
                      onChange={(e) => setUpdateExisting(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      <span className="font-semibold block">Update existing students instead of skipping them</span>
                      Re-imports rows whose Reg No. already exists, overwriting their stored fields with this file's values. Use this to backfill/correct data from a re-run (e.g. after fixing a column mapping) — leave unchecked for a normal first-time import.
                    </span>
                  </label>

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

                  {importProgress && (
                    <div className="rounded-xl border border-primary-100 dark:border-primary-900/40 bg-primary-50/50 dark:bg-primary-950/20 p-3.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-primary-800 dark:text-primary-400 mb-1.5">
                        <span>Batch {importProgress.batch} of {importProgress.totalBatches}</span>
                        <span>{importProgress.rowsDone} / {importProgress.totalRows} rows</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-primary-100 dark:bg-primary-900/40 overflow-hidden">
                        <div
                          className="h-full bg-primary-500 transition-all duration-300"
                          style={{ width: `${Math.round((importProgress.rowsDone / importProgress.totalRows) * 100)}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">Each batch commits independently — a network drop only costs the current batch, not what's already imported.</p>
                    </div>
                  )}
                </form>
              ) : (
                /* Display import report summary results */
                <div className="space-y-4 animate-fade-in">
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 rounded-2xl flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <h4 className="font-bold text-emerald-800 dark:text-emerald-400">Import Process Completed!</h4>
                      <p className="text-emerald-600 dark:text-emerald-500 mt-1">
                        Processed <b>{importResults.details.totalRows || 0}</b> rows in <b>{importResults.details.processingTime || '0.00s'}</b>. Successfully imported <b>{importResults.details.importedCount || 0}</b> student profiles.
                      </p>
                    </div>
                  </div>

                  {/* Summary Card Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs">
                    <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm">
                      <span className="text-slate-400 font-semibold block text-[11px]">Total Rows</span>
                      <span className="text-base font-bold text-slate-800 dark:text-slate-100">{importResults.details.totalRows || 0}</span>
                    </div>
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl border border-emerald-100 dark:border-emerald-900/30 shadow-sm">
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold block text-[11px]">Imported</span>
                      <span className="text-base font-bold text-emerald-700 dark:text-emerald-300">{importResults.details.importedCount || 0}</span>
                    </div>
                    <div className="p-3 bg-rose-50 dark:bg-rose-950/20 rounded-xl border border-rose-100 dark:border-rose-900/30 shadow-sm">
                      <span className="text-rose-600 dark:text-rose-400 font-semibold block text-[11px]">Invalid IDs</span>
                      <span className="text-base font-bold text-rose-700 dark:text-rose-300">{importResults.details.invalidLeetCodeCount || 0}</span>
                    </div>
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-100 dark:border-amber-900/30 shadow-sm">
                      <span className="text-amber-600 dark:text-amber-400 font-semibold block text-[11px]">Duplicates</span>
                      <span className="text-base font-bold text-amber-700 dark:text-amber-300">{importResults.details.duplicateCount || 0}</span>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-100 dark:border-blue-900/30 shadow-sm">
                      <span className="text-blue-600 dark:text-blue-400 font-semibold block text-[11px]">Verification Pending</span>
                      <span className="text-base font-bold text-blue-700 dark:text-blue-300">{importResults.details.pendingCount || 0}</span>
                    </div>
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-950/20 rounded-xl border border-indigo-100 dark:border-indigo-900/30 shadow-sm">
                      <span className="text-indigo-600 dark:text-indigo-400 font-semibold block text-[11px]">Processing Time</span>
                      <span className="text-base font-bold text-indigo-700 dark:text-indigo-300">{importResults.details.processingTime || '0.00s'}</span>
                    </div>
                  </div>

                  {/* Invalid LeetCode IDs List Table */}
                  {importResults.details.invalidLeetCode && importResults.details.invalidLeetCode.length > 0 && (
                    <div className="rounded-xl border border-rose-100 dark:border-rose-900/40 bg-rose-50/30 dark:bg-rose-950/10 p-3.5 text-xs">
                      <span className="font-bold text-rose-800 dark:text-rose-400 block mb-2">Invalid / Rejected LeetCode IDs ({importResults.details.invalidLeetCode.length})</span>
                      <div className="max-h-56 overflow-y-auto rounded-lg border border-rose-200/60 dark:border-rose-900/40">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead className="sticky top-0 bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-semibold z-10">
                            <tr className="border-b border-rose-200 dark:border-rose-900/40">
                              <th className="py-1.5 px-2">Row</th>
                              <th className="py-1.5 px-2">Roll No</th>
                              <th className="py-1.5 px-2">Name</th>
                              <th className="py-1.5 px-2">LeetCode Username</th>
                              <th className="py-1.5 px-2">Reason</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-rose-100 dark:divide-rose-900/20 text-slate-700 dark:text-slate-300 bg-white/50 dark:bg-slate-900/50">
                            {importResults.details.invalidLeetCode.map((item, idx) => (
                              <tr key={idx}>
                                <td className="py-1 px-2 font-mono text-[10px] text-rose-600 dark:text-rose-400 font-bold">{item.excelRow || item.rowNumber || item.excel_row || idx + 2}</td>
                                <td className="py-1 px-2 font-mono font-semibold">{item.rollNo}</td>
                                <td className="py-1 px-2">{item.name}</td>
                                <td className="py-1 px-2 font-mono">{item.leetcodeUsername || '(empty)'}</td>
                                <td className="py-1 px-2">
                                  <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">
                                    {item.reason}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer - Fixed */}
            <div className="flex-shrink-0 border-t border-slate-100 dark:border-slate-800 pt-4 mt-4">
              {!importResults ? (
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={importing}
                    onClick={() => { setIsImportModalOpen(false); setImportFile(null); setImportBatch(''); setUpdateExisting(false); }}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form="bulk-import-form"
                    disabled={importing || !importFile || !importBatch.trim()}
                    className="rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-5 py-2.5 text-xs font-semibold shadow-md shadow-primary-500/10 flex items-center gap-1.5"
                  >
                    {importing ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing...</> : 'Run Import'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => downloadFullReport(importResults.details)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold shadow-sm transition-all"
                    >
                      <Download className="h-4 w-4" /> Download Full Report (3 Sheets)
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadInvalidIDsReport(importResults.details)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-sm transition-all"
                    >
                      <Download className="h-4 w-4" /> Download Invalid IDs
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setIsImportModalOpen(false); setImportFile(null); setImportResults(null); }}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 px-5 py-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/30">
                <Trash2 className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">Permanently delete students?</h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
              This will permanently delete <strong>{bulkDeleteConfirm.count}</strong> student(s) — {bulkDeleteConfirm.description}.
            </p>
            <p className="text-xs text-rose-600 dark:text-rose-400 mb-5">
              This cannot be undone. All attendance records and platform profile data for these students will also be removed.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={bulkDeleting}
                onClick={() => setBulkDeleteConfirm(null)}
                className="rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkDeleting}
                onClick={executeBulkDelete}
                className="rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white px-5 py-2.5 text-xs font-semibold shadow-md shadow-rose-500/10 flex items-center gap-1.5"
              >
                {bulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : `Permanently Delete ${bulkDeleteConfirm.count}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Students;
