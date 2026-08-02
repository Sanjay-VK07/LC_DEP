import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api';

export function useContestList({ activePlatform, selectedStudentId, selectedBatch, filterType, filterStatus, currentPage = 1 }) {
  const [contests, setContests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 10, totalPages: 1 });

  const fetchContests = useCallback(async () => {
    const controller = new AbortController();
    setLoading(true);
    setError('');

    try {
      const res = await axios.get(`${API_URL}/contestmaster/${activePlatform}`, {
        params: {
          studentId: selectedStudentId,
          batch: selectedBatch,
          type: filterType,
          status: filterStatus,
          page: currentPage,
          limit: 10
        },
        signal: controller.signal
      });

      if (res.data.success) {
        setContests(res.data.contests || []);
        if (res.data.pagination) {
          setPagination(res.data.pagination);
        }
      }
    } catch (err) {
      if (!axios.isCancel(err)) {
        setError(`Failed to fetch ${activePlatform} contests.`);
      }
    } finally {
      setLoading(false);
    }

    return () => controller.abort();
  }, [activePlatform, selectedStudentId, selectedBatch, filterType, filterStatus, currentPage]);

  useEffect(() => {
    fetchContests();
  }, [fetchContests]);

  return { contests, loading, error, pagination, refetch: fetchContests };
}
