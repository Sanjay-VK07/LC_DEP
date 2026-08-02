import React from 'react';
import { X, Loader2 } from 'lucide-react';

export const ContestDetailsModal = React.memo(function ContestDetailsModal({
  isOpenModal,
  setIsOpenModal,
  modalMode,
  formData,
  setFormData,
  formLoading,
  formError,
  handleFormSubmit
}) {
  if (!isOpenModal) return null;

  const handleInputChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black text-slate-800 dark:text-white capitalize">
            {modalMode === 'add' ? 'Create New Contest' : 'Edit Contest Details'}
          </h2>
          <button
            onClick={() => setIsOpenModal(false)}
            className="p-1 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {formError && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 text-xs font-semibold">
            {formError}
          </div>
        )}

        <form onSubmit={handleFormSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 block">Contest ID / Slug</label>
            <input
              type="text"
              name="contestId"
              value={formData.contestId}
              onChange={handleInputChange}
              required
              disabled={modalMode === 'edit'}
              placeholder="e.g. weekly-contest-390"
              className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 block">Contest Title</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              required
              placeholder="e.g. Weekly Contest 390"
              className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 block">Date</label>
            <input
              type="date"
              name="date"
              value={formData.date}
              onChange={handleInputChange}
              required
              className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 block">Contest Type</label>
            <select
              name="type"
              value={formData.type}
              onChange={handleInputChange}
              className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white focus:outline-none capitalize"
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="starters">Starters</option>
              <option value="div1">Div 1</option>
              <option value="div2">Div 2</option>
              <option value="educational">Educational</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsOpenModal(false)}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={formLoading}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5"
            >
              {formLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {modalMode === 'add' ? 'Save Contest' : 'Update Contest'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});
