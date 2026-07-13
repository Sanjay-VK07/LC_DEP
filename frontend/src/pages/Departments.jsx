import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Building2, 
  Plus, 
  Edit, 
  Trash2, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  Loader2,
  Bookmark,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';

function Departments() {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add'); // 'add' or 'edit'
  const [selectedDeptId, setSelectedDeptId] = useState(null);
  
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    status: 'active'
  });
  
  const [submitting, setSubmitting] = useState(false);

  // Fetch departments
  const fetchDepartments = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get('/api/departments');
      if (res.data.success) {
        setDepartments(res.data.data);
        console.log(`[Diagnostic] Departments count rendered in frontend: ${res.data.data.length}`);
      }
    } catch (err) {
      setError('Failed to fetch departments list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDepartments();
  }, []);

  // Form input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Open Modal
  const openModal = (mode, dept = null) => {
    setModalMode(mode);
    setError('');
    if (mode === 'edit' && dept) {
      setSelectedDeptId(dept.id);
      setFormData({
        name: dept.name,
        code: dept.code,
        status: dept.status
      });
    } else {
      setSelectedDeptId(null);
      setFormData({
        name: '',
        code: '',
        status: 'active'
      });
    }
    setIsModalOpen(true);
  };

  // Submit Form
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.code.trim()) return;

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      let res;
      if (modalMode === 'add') {
        res = await axios.post('/api/departments', formData);
      } else {
        res = await axios.put(`/api/departments/${selectedDeptId}`, formData);
      }

      if (res.data.success) {
        setSuccess(res.data.message);
        setIsModalOpen(false);
        fetchDepartments();
        setTimeout(() => setSuccess(''), 4000);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save department. Verify code uniqueness.');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Department
  const handleDelete = async (dept) => {
    if (!window.confirm(`Are you sure you want to delete the department "${dept.name}" (${dept.code})?`)) {
      return;
    }

    setError('');
    setSuccess('');

    try {
      const res = await axios.delete(`/api/departments/${dept.id}`);
      if (res.data.success) {
        setSuccess(res.data.message);
        fetchDepartments();
        setTimeout(() => setSuccess(''), 4000);
      }
    } catch (err) {
      setError(err.response?.data?.message || `Failed to delete department. ${err.message}`);
    }
  };

  // Status Metrics
  const totalCount = departments.length;
  const activeCount = departments.filter(d => d.status === 'active').length;
  const inactiveCount = totalCount - activeCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Department Management</h1>
          <p className="text-sm text-slate-400">Configure academic departments, codes, and activation statuses dynamically.</p>
        </div>
        <button
          onClick={() => openModal('add')}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white px-4 py-2.5 text-xs font-bold shadow-md shadow-primary-500/10 transition-all hover:scale-[1.02] active:scale-95"
        >
          <Plus className="h-4 w-4" />
          Add Department
        </button>
      </div>

      {/* Alerts */}
      {success && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 p-4 text-xs font-semibold text-emerald-600 dark:text-emerald-400 animate-fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 p-4 text-xs font-semibold text-rose-600 dark:text-rose-400 animate-fade-in">
          <AlertTriangle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Total Departments</span>
            <span className="text-2xl font-extrabold text-slate-800 dark:text-white">{loading ? '...' : totalCount}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Active Programs</span>
            <span className="text-2xl font-extrabold text-slate-800 dark:text-white">{loading ? '...' : activeCount}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Disabled Programs</span>
            <span className="text-2xl font-extrabold text-slate-800 dark:text-white">{loading ? '...' : inactiveCount}</span>
          </div>
        </div>
      </div>

      {/* Main List */}
      <div className="rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/10 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-800 dark:text-white">Configured Departments</h3>
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">{departments.length} records</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-6 py-4">Department Code</th>
                <th className="px-6 py-4">Department Name</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs text-slate-600 dark:text-slate-350">
              {loading ? (
                <tr>
                  <td colSpan="4" className="text-center py-12">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
                  </td>
                </tr>
              ) : departments.length === 0 ? (
                <tr>
                  <td colSpan="4" className="text-center py-12 text-slate-400">No departments configured in database. Click Add Department to create one.</td>
                </tr>
              ) : (
                departments.map((dept) => (
                  <tr key={dept.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                    <td className="px-6 py-4 font-mono font-bold text-slate-800 dark:text-white">
                      {dept.code}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-700 dark:text-slate-300">
                      {dept.name}
                    </td>
                    <td className="px-6 py-4">
                      {dept.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 px-2.5 py-0.5 font-bold uppercase text-[9px] border border-emerald-250/20">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-55 text-slate-500 dark:bg-slate-850 dark:text-slate-400 px-2.5 py-0.5 font-bold uppercase text-[9px] border border-slate-700/20">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2.5">
                        <button
                          onClick={() => openModal('edit', dept)}
                          className="inline-flex rounded-lg p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="Edit Department"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(dept)}
                          className="inline-flex rounded-lg p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                          title="Delete Department"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-5">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                {modalMode === 'add' ? 'Add Academic Department' : 'Edit Academic Department'}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Error alerts inside modal */}
            {error && (
              <div className="flex items-start gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/25 border border-rose-100 dark:border-rose-900/30 p-3 text-xs font-semibold text-rose-600 dark:text-rose-400 mb-4">
                <AlertTriangle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Department Code</label>
                <input
                  type="text"
                  name="code"
                  required
                  disabled={modalMode === 'edit'} // lock code in edit to keep ref stable or edit via db cascade
                  value={formData.code}
                  onChange={handleInputChange}
                  placeholder="e.g., CSE, AIDS, CYBER"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2.5 text-xs outline-none focus:border-primary-500 dark:text-white disabled:opacity-50"
                />
                {modalMode === 'edit' && (
                  <p className="text-[10px] text-slate-400">Department code is locked for edit to protect data associations. Code edits require database cascades.</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Department Name</label>
                <input
                  type="text"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="e.g., Computer Science Engineering"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2.5 text-xs outline-none focus:border-primary-500 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Status</label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleInputChange}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2.5 text-xs outline-none focus:border-primary-500 dark:text-slate-200"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4 mt-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-355 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !formData.name.trim() || !formData.code.trim()}
                  className="rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-5 py-2 text-xs font-semibold shadow-sm flex items-center gap-1.5"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span>Save Department</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Departments;
