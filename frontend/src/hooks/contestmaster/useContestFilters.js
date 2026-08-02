import { useState, useCallback } from 'react';

export function useContestFilters() {
  const [activePlatform, setActivePlatform] = useState('leetcode');
  const [selectedStudentId, setSelectedStudentId] = useState('all');
  const [selectedBatch, setSelectedBatch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const resetFilters = useCallback(() => {
    setFilterType('');
    setFilterStatus('');
    setSelectedStudentId('all');
    setSelectedBatch('');
    setStudentSearch('');
    setCurrentPage(1);
  }, []);

  const handlePlatformChange = useCallback((platform) => {
    setActivePlatform(platform);
    setFilterType('');
    setCurrentPage(1);
  }, []);

  return {
    activePlatform,
    setActivePlatform: handlePlatformChange,
    selectedStudentId,
    setSelectedStudentId,
    selectedBatch,
    setSelectedBatch,
    filterType,
    setFilterType,
    filterStatus,
    setFilterStatus,
    studentSearch,
    setStudentSearch,
    currentPage,
    setCurrentPage,
    resetFilters
  };
}
