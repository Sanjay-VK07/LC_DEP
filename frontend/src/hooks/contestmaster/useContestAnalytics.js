import { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api';

export function useContestAnalytics(activePlatform, selectedStudentId, selectedBatch) {
  const [monthlyTrendData, setMonthlyTrendData] = useState([]);
  const [semesterAnalyticsData, setSemesterAnalyticsData] = useState([]);
  const [batchComparisonData, setBatchComparisonData] = useState([]);
  const [studentSummaries, setStudentSummaries] = useState([]);
  const [platformRanking, setPlatformRanking] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    axios.get(`${API_URL}/contestmaster/${activePlatform}`, {
      params: { studentId: selectedStudentId, batch: selectedBatch }
    })
    .then(res => {
      if (res.data.success) {
        setMonthlyTrendData(res.data.monthlyTrendData || []);
        setSemesterAnalyticsData(res.data.semesterAnalyticsData || []);
        setBatchComparisonData(res.data.batchComparisonData || []);
        setStudentSummaries(res.data.studentSummaries || []);
        setPlatformRanking(res.data.platformRanking || null);
      }
    })
    .catch(() => {})
    .finally(() => setLoading(false));
  }, [activePlatform, selectedStudentId, selectedBatch]);

  return { monthlyTrendData, semesterAnalyticsData, batchComparisonData, studentSummaries, platformRanking, loading };
}
