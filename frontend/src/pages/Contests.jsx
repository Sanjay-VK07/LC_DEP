import React, { useState } from 'react';
import * as XLSX from 'xlsx';

// Custom Hooks
import { useContestFilters } from '../hooks/contestmaster/useContestFilters';
import { useContestList } from '../hooks/contestmaster/useContestList';
import { useContestSummary } from '../hooks/contestmaster/useContestSummary';
import { useParticipants } from '../hooks/contestmaster/useParticipants';
import { useAttendance } from '../hooks/contestmaster/useAttendance';
import { useContestAnalytics } from '../hooks/contestmaster/useContestAnalytics';
import { useContestDetails } from '../hooks/contestmaster/useContestDetails';

// UI Components
import { ContestHeader } from '../components/contestmaster/ContestHeader';
import { PlatformSelector } from '../components/contestmaster/PlatformSelector';
import { ContestSummaryCards } from '../components/contestmaster/ContestSummaryCards';
import { ContestFilterBar } from '../components/contestmaster/ContestFilterBar';
import { ContestTable } from '../components/contestmaster/ContestTable';
import { Pagination } from '../components/contestmaster/Pagination';
import { AnalyticsPanel } from '../components/contestmaster/AnalyticsPanel';
import { ContestDetailsModal } from '../components/contestmaster/ContestDetailsModal';
import { LoadingSkeleton } from '../components/contestmaster/LoadingSkeleton';
import { ErrorState } from '../components/contestmaster/ErrorState';
import { EmptyState } from '../components/contestmaster/EmptyState';

const platformStyles = {
  leetcode: {
    gradient: 'from-orange-500 to-amber-500',
    gradientButton: 'from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400',
    shadow: 'shadow-orange-500/20',
    chartColor: '#f97316'
  },
  codechef: {
    gradient: 'from-amber-800 to-amber-600',
    gradientButton: 'from-amber-800 to-amber-700 hover:from-amber-700 hover:to-amber-600',
    shadow: 'shadow-amber-800/20',
    chartColor: '#b45309'
  },
  codeforces: {
    gradient: 'from-rose-600 to-red-500',
    gradientButton: 'from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400',
    shadow: 'shadow-rose-500/20',
    chartColor: '#e11d48'
  }
};

export default function Contests() {
  const [adminMode, setAdminMode] = useState(false);
  const [expandedContestId, setExpandedContestId] = useState(null);
  const [syncingPlatform, setSyncingPlatform] = useState(false);

  // Filters Hook
  const {
    activePlatform,
    setActivePlatform,
    selectedStudentId,
    setSelectedStudentId,
    selectedBatch,
    setSelectedBatch,
    filterType,
    setFilterType,
    filterStatus,
    setFilterStatus,
    currentPage,
    setCurrentPage
  } = useContestFilters();

  // Summary & Available Batches
  const { metrics, availableBatches, students } = useContestSummary(activePlatform, selectedStudentId, selectedBatch);

  // Contests List Hook
  const { contests, loading, error, pagination, refetch } = useContestList({
    activePlatform,
    selectedStudentId,
    selectedBatch,
    filterType,
    filterStatus,
    currentPage
  });

  // Analytics Visualization Hook
  const { monthlyTrendData, semesterAnalyticsData, batchComparisonData } = useContestAnalytics(activePlatform, selectedStudentId, selectedBatch);

  // Participants Lazy Loading Hook
  const { participantsMap, loadingMap, fetchParticipants } = useParticipants();

  // Attendance Actions Hook
  const { registerStudent, joinContest, submitOverride } = useAttendance(refetch);

  // Contest Details & Modal Hook
  const {
    isOpenModal,
    setIsOpenModal,
    modalMode,
    formData,
    setFormData,
    formLoading,
    formError,
    openAddModal,
    openEditModal,
    handleFormSubmit,
    deleteContest
  } = useContestDetails(refetch);

  const style = platformStyles[activePlatform] || platformStyles.leetcode;

  // Export Excel Report
  const handleExportReport = () => {
    const pLabel = activePlatform === 'leetcode' ? 'LeetCode' : activePlatform === 'codechef' ? 'CodeChef' : 'Codeforces';
    const exportData = contests.map(c => ({
      'Contest ID': c.contest_id || c.id,
      'Contest Name': c.name,
      'Platform': pLabel,
      'Type': c.type,
      'Date': new Date(c.date).toLocaleDateString('en-GB'),
      'Registrations': c.registration_count || 0,
      'Attended Count': c.attendance_count || 0
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ContestReport');
    XLSX.writeFile(wb, `${pLabel}_ContestMaster_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleSyncPlatformData = async () => {
    setSyncingPlatform(true);
    try {
      await refetch();
    } finally {
      setSyncingPlatform(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <ContestHeader
        activePlatform={activePlatform}
        adminMode={adminMode}
        setAdminMode={setAdminMode}
        openAddModal={openAddModal}
        platformStyle={style}
      />

      <PlatformSelector
        activePlatform={activePlatform}
        setActivePlatform={setActivePlatform}
      />

      <ContestSummaryCards metrics={metrics} />

      <ContestFilterBar
        selectedBatch={selectedBatch}
        setSelectedBatch={setSelectedBatch}
        availableBatches={availableBatches}
        selectedStudentId={selectedStudentId}
        setSelectedStudentId={setSelectedStudentId}
        students={students}
        filterType={filterType}
        setFilterType={setFilterType}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        activePlatform={activePlatform}
        handleSyncPlatformData={handleSyncPlatformData}
        syncingPlatform={syncingPlatform}
        handleExportReport={handleExportReport}
      />

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : contests.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ContestTable
            contests={contests}
            expandedContestId={expandedContestId}
            setExpandedContestId={setExpandedContestId}
            selectedStudentId={selectedStudentId}
            adminMode={adminMode}
            openEditModal={openEditModal}
            deleteContest={deleteContest}
            handleRegister={registerStudent}
            handleJoin={joinContest}
            openOverride={(c) => submitOverride({ studentId: selectedStudentId, contestId: c.id, status: 'present' })}
            activePlatform={activePlatform}
            participantsMap={participantsMap}
            loadingMap={loadingMap}
            fetchParticipants={fetchParticipants}
            selectedBatch={selectedBatch}
          />

          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={setCurrentPage}
            totalItems={pagination.total}
          />
        </>
      )}

      <AnalyticsPanel
        monthlyTrendData={monthlyTrendData}
        semesterAnalyticsData={semesterAnalyticsData}
        batchComparisonData={batchComparisonData}
        platformStyle={style}
      />

      <ContestDetailsModal
        isOpenModal={isOpenModal}
        setIsOpenModal={setIsOpenModal}
        modalMode={modalMode}
        formData={formData}
        setFormData={setFormData}
        formLoading={formLoading}
        formError={formError}
        handleFormSubmit={handleFormSubmit}
      />
    </div>
  );
}
