import React from 'react';
import { ContestRow } from './ContestRow';
import { ParticipantsDrawer } from './ParticipantsDrawer';

export const ContestTable = React.memo(function ContestTable({
  contests,
  expandedContestId,
  setExpandedContestId,
  selectedStudentId,
  adminMode,
  openEditModal,
  deleteContest,
  handleRegister,
  handleJoin,
  openOverride,
  activePlatform,
  participantsMap,
  loadingMap,
  fetchParticipants,
  selectedBatch
}) {
  const isAllStudents = selectedStudentId === 'all';

  const handleToggleExpand = (id) => {
    if (expandedContestId === id) {
      setExpandedContestId(null);
    } else {
      setExpandedContestId(id);
      if (isAllStudents) {
        fetchParticipants(id, selectedBatch);
      }
    }
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-850 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-[10px] uppercase font-black tracking-wider text-slate-400">
              <th className="py-3 px-4">Contest ID</th>
              <th className="py-3 px-4">Name & Date</th>
              <th className="py-3 px-4">Type</th>
              <th className="py-3 px-4">Sync Source</th>
              <th className="py-3 px-4">{isAllStudents ? 'Attendance Rate' : 'Status'}</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {contests.map(contest => {
              const isExpanded = expandedContestId === contest.id;
              const participantData = participantsMap[contest.id];
              const isLoadingParticipants = loadingMap[contest.id];

              return (
                <React.Fragment key={contest.id}>
                  <ContestRow
                    contest={contest}
                    isExpanded={isExpanded}
                    onToggleExpand={handleToggleExpand}
                    selectedStudentId={selectedStudentId}
                    adminMode={adminMode}
                    openEditModal={openEditModal}
                    deleteContest={deleteContest}
                    handleRegister={handleRegister}
                    handleJoin={handleJoin}
                    openOverride={openOverride}
                    activePlatform={activePlatform}
                  />

                  {isExpanded && (
                    <tr>
                      <td colSpan={6} className="bg-slate-50/50 dark:bg-slate-950/40 p-4 border-b border-slate-100 dark:border-slate-800">
                        <ParticipantsDrawer
                          contestId={contest.id}
                          participantData={participantData}
                          isLoading={isLoadingParticipants}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
