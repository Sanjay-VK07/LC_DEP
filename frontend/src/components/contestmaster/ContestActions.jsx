import React from 'react';
import { Edit, Trash2, CheckCircle2, UserPlus } from 'lucide-react';

export const ContestActions = React.memo(function ContestActions({
  contest,
  selectedStudentId,
  adminMode,
  openEditModal,
  deleteContest,
  handleRegister,
  handleJoin,
  openOverride,
  activePlatform
}) {
  const timing = contest.timing || 'past';
  const isAllStudents = selectedStudentId === 'all';

  return (
    <div className="flex items-center gap-1.5 justify-end" onClick={(e) => e.stopPropagation()}>
      {!isAllStudents && timing === 'upcoming' && (
        <button
          onClick={() => handleRegister(contest.id)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 text-xs font-bold hover:bg-sky-100"
        >
          <UserPlus className="h-3 w-3" /> Register
        </button>
      )}

      {!isAllStudents && timing === 'active' && (
        <button
          onClick={() => handleJoin(contest.id)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 text-xs font-bold hover:bg-emerald-100"
        >
          <CheckCircle2 className="h-3 w-3" /> Join
        </button>
      )}

      {adminMode && (
        <>
          {!isAllStudents && (
            <button
              onClick={() => openOverride(contest)}
              className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 text-[10px] font-bold"
            >
              Override
            </button>
          )}

          <button
            onClick={() => openEditModal(contest, activePlatform)}
            className="p-1 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30"
          >
            <Edit className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => deleteContest(contest.id)}
            className="p-1 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
});
