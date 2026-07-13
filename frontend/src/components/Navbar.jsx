import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { Menu, Sun, Moon, Bell, AlertTriangle } from 'lucide-react';
import axios from 'axios';

function Navbar({ toggleSidebar }) {
  const { darkMode, toggleDarkMode } = useTheme();
  const [alerts, setAlerts] = useState({ missingUploads: [], lowAttendanceStudents: [] });
  const [showAlertsMenu, setShowAlertsMenu] = useState(false);

  useEffect(() => {
    // Fetch notifications
    const fetchAlerts = async () => {
      try {
        const res = await axios.get('/api/analytics/dashboard-stats');
        if (res.data.success && res.data.alerts) {
          setAlerts(res.data.alerts);
        }
      } catch (err) {
        console.error('Failed to load global nav alerts:', err.message);
      }
    };

    fetchAlerts();
  }, []);

  const alertCount = alerts.missingUploads.length + (alerts.lowAttendanceStudents.length > 0 ? 1 : 0);

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-6 shadow-sm">
      {/* Left side: Hamburger and branding */}
      <div className="flex items-center gap-4">
        <button 
          onClick={toggleSidebar}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden transition-colors"
        >
          <Menu className="h-6 w-6" />
        </button>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-white hidden sm:block">
          Portal Control Centre
        </h2>
      </div>

      {/* Right side: Actions */}
      <div className="flex items-center gap-4">
        {/* Theme Toggle */}
        <button 
          onClick={toggleDarkMode}
          className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Toggle Dark Mode"
        >
          {darkMode ? <Sun className="h-5 w-5 text-amber-500" /> : <Moon className="h-5 w-5 text-slate-600" />}
        </button>

        {/* Notifications Alert Menu */}
        <div className="relative">
          <button 
            onClick={() => setShowAlertsMenu(!showAlertsMenu)}
            className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Notifications"
          >
            <Bell className="h-5 w-5" />
            {alertCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
                {alertCount}
              </span>
            )}
          </button>

          {/* Notifications Dropdown */}
          {showAlertsMenu && (
            <>
              {/* Backdrop overlay to close */}
              <div className="fixed inset-0 z-40" onClick={() => setShowAlertsMenu(false)} />
              
              <div className="absolute right-0 mt-2 z-50 w-80 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xl animate-fade-in">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 mb-2">
                  <span className="font-semibold text-sm text-slate-800 dark:text-white">Dashboard Alerts</span>
                  {alertCount > 0 && (
                    <span className="flex items-center text-[10px] text-amber-500 font-bold bg-amber-50 dark:bg-amber-950/20 px-2 py-0.5 rounded-full">
                      <AlertTriangle className="h-3 w-3 mr-1" /> Warnings
                    </span>
                  )}
                </div>

                <div className="space-y-2.5 max-h-64 overflow-y-auto">
                  {alertCount === 0 ? (
                    <div className="py-4 text-center text-xs text-slate-400">
                      No pending notifications or low-attendance alerts.
                    </div>
                  ) : (
                    <>
                      {alerts.missingUploads.map((c) => (
                        <div key={c.id} className="flex gap-2.5 p-2 bg-rose-50 dark:bg-rose-950/15 rounded-xl border border-rose-100/50 dark:border-rose-950/30">
                          <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                          <div className="text-xs">
                            <p className="font-semibold text-rose-800 dark:text-rose-400">Missing Upload</p>
                            <p className="text-rose-600 dark:text-rose-500">Attendance not uploaded for <b>{c.name}</b>.</p>
                          </div>
                        </div>
                      ))}

                      {alerts.lowAttendanceStudents.length > 0 && (
                        <div className="flex gap-2.5 p-2 bg-amber-50 dark:bg-amber-950/15 rounded-xl border border-amber-100/50 dark:border-amber-950/30">
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          <div className="text-xs">
                            <p className="font-semibold text-amber-800 dark:text-amber-400">Low Attendance Warning</p>
                            <p className="text-amber-600 dark:text-amber-500">
                              There are <b>{alerts.lowAttendanceStudents.length}</b> students with attendance under 10%.
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Brand/Label (Replacing User Profile Circle) */}
        <div className="flex items-center gap-2 border-l border-slate-200 dark:border-slate-800 pl-4">
          <div className="text-right">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Access Mode</p>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Open Dashboard
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
