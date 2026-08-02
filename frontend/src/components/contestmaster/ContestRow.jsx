import React from 'react';
import { ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { TypeBadge, SyncSourceBadge, AttendanceBadge } from './ContestBadges';
import { AttendanceBar } from './AttendanceBar';
import { ContestActions } from './ContestActions';

export const ContestRow = React.memo(function ContestRow({
  contest,
  isExpanded,
  onToggleExpand,
  selectedStudentId,
  adminMode,
  openEditModal,
  deleteContest,
  handleRegister,
  handleJoin,
  openOverride,
  activePlatform
}) {
  const isAllStudents = selectedStudentId === 'all';
  const formattedDate = new Date(contest.date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  return (
    <tr
      onClick={() => onToggleExpand(contest.id)}
      className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
    >
      <td className="py-3 px-4 text-xs font-bold text-slate-400">
        <div className="flex items-center gap-1.5">
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {contest.contest_id || contest.id}
        </div>
      </td>

      <td className="py-3 px-4">
        <div className="flex flex-col">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{contest.name}</span>
          <span className="text-[10px] text-slate-400">{formattedDate}</span>
        </div>
      </td>

      <td className="py-3 px-4">
        <TypeBadge type={contest.type} />
      </td>

      <td className="py-3 px-4">
        <SyncSourceBadge source={contest.sync_source} status={contest.sync_status} />
      </td>

      <td className="py-3 px-4">
        {isAllStudents ? (
          <AttendanceBar attended={contest.attendance_count || 0} total={contest.registration_count || 1} />
        ) : (
          <AttendanceBadge contest={contest} />
        )}
      </td>

      <td className="py-3 px-4 text-right">
        <ContestActions
          contest={contest}
          selectedStudentId={selectedStudentId}
          adminMode={adminMode}
          openEditModal={openEditModal}
          deleteContest={deleteContest}
          handleRegister={handleRegister}
          handleJoin={handleJoin}
          openOverride={openOverride}
          activePlatform={activePlatform}
        />
      </td>
    </tr>
  );
});
