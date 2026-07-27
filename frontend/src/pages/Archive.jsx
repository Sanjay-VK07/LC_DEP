import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api';
import { 
  Archive as ArchiveIcon, 
  RotateCcw, 
  AlertTriangle, 
  CheckCircle2, 
  ShieldAlert, 
  Loader2, 
  CalendarRange
} from 'lucide-react';

function Archive() {
  const [archivedBatches, setArchivedBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form states
  const [dept, setDept] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [section, setSection] = useState('');
  const [processing, setProcessing] = useState(false);

  // Filter/Preview states
  const [availableDepts, setAvailableDepts] = useState([]);
  const [availableBatches, setAvailableBatches] = useState([]);
  const [availableSections, setAvailableSections] = useState([]);
  const [previewCount, setPreviewCount] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

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

  // Fetch summary of archived batches
  const fetchArchiveSummary = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/students/archive-summary`);
      if (res.data.success) {
        setArchivedBatches(res.data.data);
      }
    } catch (err) {
      setError('Failed to fetch archived history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAvailableDepts();
    fetchAvailableBatches();
    fetchArchiveSummary();
  }, []);

  // Fetch available sections dynamically when department or batch changes
  useEffect(() => {
    const fetchAvailableSections = async () => {
      try {
        const params = { status: 'active' };
        if (dept) params.department = dept;
        if (academicYear) params.academicBatch = academicYear;
        const res = await axios.get(`${API_URL}/students/sections`, { params });
        if (res.data.success) {
          const sections = res.data.data;
          setAvailableSections(sections);
          if (section && !sections.includes(section)) {
            setSection('');
          }
        }
      } catch (err) {
        console.error('Failed to fetch sections:', err);
      }
    };
    fetchAvailableSections();
  }, [dept, academicYear]);

  // Fetch active student count preview
  useEffect(() => {
    const fetchPreviewCount = async () => {
      if (!dept || !academicYear) {
        setPreviewCount(null);
        return;
      }
      setLoadingPreview(true);
      try {
        const params = {
          department: dept,
          academicBatch: academicYear,
          status: 'active'
        };
        if (section) {
          params.section = section;
        }
        const res = await axios.get(`${API_URL}/students`, { params });
        if (res.data.success) {
          setPreviewCount(res.data.data.length);
        }
      } catch (err) {
        console.error('Failed to fetch preview student count:', err);
        setPreviewCount(null);
      } finally {
        setLoadingPreview(false);
      }
    };
    fetchPreviewCount();
  }, [dept, academicYear, section]);

  // Archive action
  const handleArchive = async (e) => {
    e.preventDefault();
    if (!dept || !academicYear) return;

    const sectionMsg = section ? ` (Section ${section})` : '';
    const countMsg = previewCount !== null ? ` ${previewCount} active` : ' all ACTIVE';
    if (!window.confirm(`Warning: You are about to archive${countMsg} students in department "${dept}"${sectionMsg} for the batch "${academicYear}". Students will no longer appear in directories or new contests. All attendance history remains preserved. Do you wish to proceed?`)) {
      return;
    }

    setProcessing(true);
    setError('');
    setSuccess('');

    try {
      const res = await axios.post(`${API_URL}/students/archive`, {
        department: dept,
        academicYear,
        section
      });
      if (res.data.success) {
        setSuccess(res.data.message);
        setDept('');
        setAcademicYear('');
        setSection('');
        setPreviewCount(null);
        fetchArchiveSummary();
        fetchAvailableBatches();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Archiving batch failed. Verify inputs.');
    } finally {
      setProcessing(false);
    }
  };

  // Restore action
  const handleRestore = async (batchDept, batchYear, batchSec) => {
    const secMsg = batchSec ? ` - Section "${batchSec}"` : '';
    if (!window.confirm(`Restore: You are about to reactivate all archived students for "${batchDept}" - Batch "${batchYear}"${secMsg}. They will reappear in the student directory. Do you want to proceed?`)) {
      return;
    }

    setProcessing(true);
    setError('');
    setSuccess('');

    try {
      const res = await axios.post(`${API_URL}/students/restore`, {
        department: batchDept,
        academicYear: batchYear,
        section: batchSec
      });
      if (res.data.success) {
        setSuccess(res.data.message);
        fetchArchiveSummary();
        fetchAvailableBatches();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to restore archived students.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Graduation Archive Control</h1>
        <p className="text-sm text-slate-400">Archive completed academic batches while preserving historical participation audits.</p>
      </div>

      {/* Alerts */}
      {success && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 p-4 text-xs font-semibold text-emerald-600 dark:text-emerald-400 animate-fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 p-4 text-xs font-semibold text-rose-600 dark:text-rose-400 animate-fade-in">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Execution Form */}
        <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <h3 className="font-bold text-slate-800 dark:text-white mb-3">Archive Graduating Batch</h3>
          
          <div className="p-3.5 bg-rose-50/50 dark:bg-rose-950/10 border border-rose-100 dark:border-rose-900/20 rounded-xl mb-4 text-xs text-rose-800 dark:text-rose-400 flex gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <p>Archiving sets student status to <b>Archived</b>. Archived students are excluded from directories and new uploads, but their attendance logs are kept permanently.</p>
          </div>

          <form onSubmit={handleArchive} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Department</label>
              <select
                required
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-primary-500 dark:text-slate-200"
              >
                <option value="">Select Department...</option>
                {availableDepts.map(d => (
                  <option key={d.id} value={d.code}>{d.code} - {d.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Academic Year (Batch)</label>
              <select
                required
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-955/40 px-3 py-2 text-xs outline-none focus:border-primary-500 dark:text-slate-200"
              >
                <option value="">Select Batch...</option>
                {availableBatches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Section (Optional)</label>
              <select
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-primary-500 dark:text-slate-200"
              >
                <option value="">All Sections</option>
                {availableSections.map(sec => (
                  <option key={sec} value={sec}>Section {sec}</option>
                ))}
              </select>
            </div>

            {loadingPreview && (
              <div className="flex items-center justify-center py-2 text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span>Fetching student count...</span>
              </div>
            )}

            {previewCount !== null && (
              <div className={`p-4 rounded-xl border flex flex-col gap-1 text-[11px] leading-relaxed ${
                previewCount > 0 
                  ? 'bg-amber-50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900/20 text-amber-800 dark:text-amber-400'
                  : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
              }`}>
                <div className="flex items-center gap-2 font-bold">
                  {previewCount > 0 ? (
                    <>
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                      <span>Archive Preview: {previewCount} Active Student{previewCount !== 1 ? 's' : ''} Found</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 text-slate-400 shrink-0" />
                      <span>Archive Preview: No Active Students Found</span>
                    </>
                  )}
                </div>
                <p className="mt-1 text-slate-600 dark:text-slate-400">
                  {previewCount > 0 
                    ? `Proceeding will archive all ${previewCount} active student profiles. They will be marked as graduated and excluded from active directories.`
                    : 'No active student records match the selected department and batch. The archive action will have no effect.'
                  }
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={processing || !dept || !academicYear || previewCount === 0}
              className="w-full rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-semibold py-2.5 text-xs transition-all shadow-sm flex items-center justify-center gap-1.5"
            >
              {processing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ArchiveIcon className="h-4 w-4" />
                  <span>Archive Batch Profiles</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right: Archived History */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <h3 className="font-bold text-slate-800 dark:text-white mb-3">Archived Batches & Re-activation</h3>
          <p className="text-xs text-slate-400 mb-4">View currently archived batches. You can restore archived records to active state at any time.</p>

          <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Batch Details</th>
                  <th className="px-5 py-3">Archived Date</th>
                  <th className="px-5 py-3">Students Count</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs text-slate-600 dark:text-slate-300">
                {loading ? (
                  <tr>
                    <td colSpan="4" className="text-center py-8">
                      <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
                    </td>
                  </tr>
                ) : archivedBatches.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="text-center py-8 text-slate-400">
                      No archived batches recorded.
                    </td>
                  </tr>
                ) : (
                  archivedBatches.map((batch, idx) => (
                    <tr key={`${batch.department}_${batch.academic_batch}_${batch.section || 'all'}`} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10 transition-colors">
                      <td className="px-5 py-3">
                        <span className="font-bold text-slate-800 dark:text-slate-200 block">
                          {batch.department} Department {batch.section ? `• Section ${batch.section}` : ''}
                        </span>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wide flex items-center gap-1 mt-0.5">
                          <CalendarRange className="h-3 w-3" />
                          Batch: {batch.academic_batch}
                        </span>
                      </td>
                      <td className="px-5 py-3">{batch.archived_at ? new Date(batch.archived_at).toLocaleDateString() : '-'}</td>
                      <td className="px-5 py-3 font-semibold text-slate-700 dark:text-slate-200">{batch.student_count} Students</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => handleRestore(batch.department, batch.academic_batch, batch.section)}
                          disabled={processing}
                          className="inline-flex items-center gap-1 rounded-lg border border-primary-200 dark:border-primary-900/30 px-3 py-1 font-bold text-[10px] text-primary-600 dark:text-primary-400 bg-primary-50/30 hover:bg-primary-50 hover:scale-[1.02] active:scale-95 transition-all"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Restore Batch
                        </button>
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
  );
}

export default Archive;
