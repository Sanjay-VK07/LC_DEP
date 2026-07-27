import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config/api';
import { 
  Bell, 
  Search, 
  Filter, 
  Archive, 
  Check, 
  CheckCheck, 
  Trash2, 
  AlertTriangle, 
  Info, 
  AlertOctagon,
  Inbox
} from 'lucide-react';

function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const params = {
        limit: 100,
        unreadOnly: unreadOnly ? 'true' : 'false',
        archived: showArchived ? 'true' : 'false'
      };
      if (severityFilter) {
        params.severity = severityFilter;
      }
      if (search) {
        params.search = search;
      }

      const res = await axios.get(`${API_URL}/notifications`, { params });
      setNotifications(res.data.success ? res.data.data : res.data);
    } catch (err) {
      setError('Failed to fetch notifications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchNotifications();
    }, 300); // debounce search
    return () => clearTimeout(timer);
  }, [search, severityFilter, unreadOnly, showArchived]);

  const handleMarkRead = async (id) => {
    try {
      const res = await axios.post(`${API_URL}/notifications/read/${id}`);
      if (res.data.success) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
      }
    } catch (err) {
      setError('Failed to mark notification as read.');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await axios.post(`${API_URL}/notifications/read-all`);
      if (res.data.success) {
        setSuccess('All notifications marked as read.');
        fetchNotifications();
      }
    } catch (err) {
      setError('Failed to mark all as read.');
    }
  };

  const handleArchive = async (id) => {
    try {
      const res = await axios.post(`${API_URL}/notifications/archive/${id}`);
      if (res.data.success) {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }
    } catch (err) {
      setError('Failed to archive notification.');
    }
  };

  const getSeverityStyles = (severity) => {
    switch (severity) {
      case 'CRITICAL':
        return {
          bg: 'bg-rose-50 dark:bg-rose-950/20 border-rose-100 dark:border-rose-950/40',
          text: 'text-rose-600 dark:text-rose-455',
          icon: <AlertOctagon className="h-5 w-5 text-rose-500 shrink-0" />
        };
      case 'WARNING':
        return {
          bg: 'bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-950/40',
          text: 'text-amber-600 dark:text-amber-455',
          icon: <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
        };
      case 'INFO':
      default:
        return {
          bg: 'bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-950/40',
          text: 'text-blue-600 dark:text-blue-455',
          icon: <Info className="h-5 w-5 text-blue-500 shrink-0" />
        };
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Actionable Notification Centre</h1>
          <p className="text-sm text-slate-400">Review critical warnings, platform outage updates, low-attendance alerts, and rating changes.</p>
        </div>
        <button
          onClick={handleMarkAllRead}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-semibold transition-all shadow-sm"
        >
          <CheckCheck className="h-4 w-4" /> Mark All as Read
        </button>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="h-4.5 w-4.5" />
          </div>
          <input
            type="text"
            placeholder="Search notifications..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 py-2 pl-9.5 pr-4 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-primary-500"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Severity:</label>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 px-3 py-2 text-xs font-semibold outline-none focus:border-primary-500 dark:text-slate-300"
            >
              <option value="">All Severities</option>
              <option value="INFO">Info</option>
              <option value="WARNING">Warning</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>

          <button
            onClick={() => setUnreadOnly(!unreadOnly)}
            className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all ${
              unreadOnly 
                ? 'bg-primary-50 border-primary-200 text-primary-600 dark:bg-primary-950/20 dark:border-primary-900' 
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-355'
            }`}
          >
            Unread Only
          </button>

          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all ${
              showArchived 
                ? 'bg-violet-50 border-violet-200 text-violet-600 dark:bg-violet-950/20 dark:border-violet-900' 
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-355'
            }`}
          >
            Show Archived
          </button>
        </div>
      </div>

      {/* Notifications List */}
      <div className="space-y-3">
        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-3 border-primary-500 border-t-transparent" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-16 text-center shadow-sm">
            <Inbox className="h-10 w-10 text-slate-300 dark:text-slate-700 mx-auto" />
            <p className="mt-4 text-sm font-semibold text-slate-500">No notifications found</p>
            <p className="text-xs text-slate-400 mt-1">Try clearing search filters or checking for archived items.</p>
          </div>
        ) : (
          notifications.map(n => {
            const styles = getSeverityStyles(n.severity);
            const isRead = n.is_read === 1 || n.is_read === true;
            return (
              <div 
                key={n.id} 
                className={`flex items-start justify-between p-4 rounded-2xl border ${styles.bg} ${
                  !isRead ? 'ring-1 ring-primary-500/20' : 'opacity-85'
                } shadow-sm transition-all duration-200`}
              >
                <div className="flex gap-3.5">
                  {styles.icon}
                  <div>
                    <h3 className="text-xs font-bold text-slate-850 dark:text-white flex items-center gap-2">
                      {n.title}
                      {!isRead && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary-600 shrink-0" />
                      )}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{n.message}</p>
                    <div className="flex gap-4 mt-2.5 text-[10px] text-slate-400 font-medium">
                      <span>{new Date(n.created_at).toLocaleString()}</span>
                      {n.student_name && (
                        <span>Student: <b>{n.student_name}</b> ({n.student_roll})</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {!isRead && (
                    <button
                      onClick={() => handleMarkRead(n.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-252 hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="Mark as Read"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                  {!n.archived && (
                    <button
                      onClick={() => handleArchive(n.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-252 hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="Archive Notification"
                    >
                      <Archive className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default Notifications;
