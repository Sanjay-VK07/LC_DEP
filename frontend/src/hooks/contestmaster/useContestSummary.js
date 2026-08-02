import { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api';

export function useContestSummary(activePlatform, selectedStudentId, selectedBatch) {
  const [metrics, setMetrics] = useState({ eligible: 0, attended: 0, missed: 0, rate: 0.0, ongoing: 0 });
  const [availableBatches, setAvailableBatches] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API_URL}/students?status=active`)
      .then(res => { if (res.data.success) setStudents(res.data.data || []); })
      .catch(() => {});

    axios.get(`${API_URL}/contestmaster/batches`)
      .then(res => { setAvailableBatches(res.data || []); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    axios.get(`${API_URL}/contestmaster/${activePlatform}`, {
      params: { studentId: selectedStudentId, batch: selectedBatch }
    })
    .then(res => {
      if (res.data.success && res.data.metrics) {
        setMetrics(res.data.metrics);
      }
    })
    .catch(() => {})
    .finally(() => setLoading(false));
  }, [activePlatform, selectedStudentId, selectedBatch]);

  return { metrics, availableBatches, students, loading };
}
