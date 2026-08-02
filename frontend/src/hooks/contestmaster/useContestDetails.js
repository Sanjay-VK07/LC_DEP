import { useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api';

export function useContestDetails(onSuccess) {
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [modalMode, setModalMode] = useState('add');
  const [selectedContest, setSelectedContest] = useState(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [formData, setFormData] = useState({ contestId: '', name: '', date: '', type: 'weekly', platform: 'leetcode' });

  const openAddModal = useCallback((activePlatform) => {
    setFormData({ contestId: '', name: '', date: new Date().toISOString().split('T')[0], type: 'weekly', platform: activePlatform });
    setFormError('');
    setModalMode('add');
    setIsOpenModal(true);
  }, []);

  const openEditModal = useCallback((contest, activePlatform) => {
    setSelectedContest(contest);
    setFormData({
      contestId: contest.contest_id || contest.id,
      name: contest.name,
      date: new Date(contest.date).toISOString().split('T')[0],
      type: contest.type,
      platform: activePlatform
    });
    setFormError('');
    setModalMode('edit');
    setIsOpenModal(true);
  }, []);

  const handleFormSubmit = useCallback(async (e) => {
    e.preventDefault();
    setFormError('');
    setFormLoading(true);
    try {
      const res = modalMode === 'add'
        ? await axios.post(`${API_URL}/contests`, formData)
        : await axios.put(`${API_URL}/contests/${selectedContest.id}`, formData);
      if (res.data.success) {
        setIsOpenModal(false);
        if (onSuccess) onSuccess();
      }
    } catch (err) {
      setFormError(err.response?.data?.message || 'Error saving contest.');
    } finally {
      setFormLoading(false);
    }
  }, [modalMode, formData, selectedContest, onSuccess]);

  const deleteContest = useCallback(async (id) => {
    if (!window.confirm('Delete this contest? All attendance records will be permanently removed.')) return;
    try {
      const res = await axios.delete(`${API_URL}/contests/${id}`);
      if (res.data.success && onSuccess) {
        onSuccess();
      }
    } catch (err) {
      console.error('Delete contest error:', err);
    }
  }, [onSuccess]);

  return {
    isOpenModal,
    setIsOpenModal,
    modalMode,
    selectedContest,
    formData,
    setFormData,
    formLoading,
    formError,
    openAddModal,
    openEditModal,
    handleFormSubmit,
    deleteContest
  };
}
