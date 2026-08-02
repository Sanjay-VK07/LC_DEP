import { useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api';

export function useAttendance(onSuccess) {
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [error, setError] = useState('');

  const registerStudent = useCallback(async (userId, contestId) => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_URL}/contests/register`, { userId, contestId });
      if (res.data.success) {
        setSuccessMsg('Registered successfully!');
        if (onSuccess) onSuccess();
      }
    } catch (err) {
      setError('Failed to register student.');
    } finally {
      setLoading(false);
    }
  }, [onSuccess]);

  const joinContest = useCallback(async (userId, contestId) => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_URL}/contests/join`, { userId, contestId });
      if (res.data.success) {
        setSuccessMsg('Joined & marked present!');
        if (onSuccess) onSuccess();
      }
    } catch (err) {
      setError('Failed to join contest.');
    } finally {
      setLoading(false);
    }
  }, [onSuccess]);

  const submitOverride = useCallback(async ({ studentId, contestId, status, remarks }) => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_URL}/attendance/override`, { studentId, contestId, status, remarks });
      if (res.data.success) {
        setSuccessMsg('Attendance override saved.');
        if (onSuccess) onSuccess();
        return true;
      }
    } catch (err) {
      setError('Failed to save override.');
    } finally {
      setLoading(false);
    }
    return false;
  }, [onSuccess]);

  return { registerStudent, joinContest, submitOverride, loading, successMsg, setSuccessMsg, error, setError };
}
