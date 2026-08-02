import { useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api';

export function useParticipants() {
  const [participantsMap, setParticipantsMap] = useState({});
  const [loadingMap, setLoadingMap] = useState({});

  const fetchParticipants = useCallback(async (contestId, selectedBatch) => {
    setLoadingMap(prev => ({ ...prev, [contestId]: true }));
    try {
      const res = await axios.get(`${API_URL}/attendance/contest/${contestId}`, {
        params: { batch: selectedBatch || undefined }
      });
      if (res.data.success) {
        setParticipantsMap(prev => ({
          ...prev,
          [contestId]: {
            attended: res.data.attended || [],
            missed: res.data.missed || [],
            raw: res.data.data || [],
            validationStatus: res.data.validationStatus,
            validationIssues: res.data.validationIssues
          }
        }));
      }
    } catch (err) {
      console.error(`Error fetching participants for contest ${contestId}:`, err);
    } finally {
      setLoadingMap(prev => ({ ...prev, [contestId]: false }));
    }
  }, []);

  return { participantsMap, loadingMap, fetchParticipants };
}
