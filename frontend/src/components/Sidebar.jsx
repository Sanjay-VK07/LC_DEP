import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  LayoutDashboard, 
  Users, 
  Award, 
  CloudUpload, 
  BarChart3, 
  Archive, 
  TrendingUp,
  Sparkles,
  FileText,
  Building2,
  Bell,
  Activity,
  Briefcase,
  Brain,
  ShieldCheck
} from 'lucide-react';

function Sidebar({ isOpen, toggleSidebar }) {
  const { user } = useAuth();

  const links = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/students', label: 'Student Directory', icon: Users },
    { to: '/contests', label: 'Contest Master', icon: Award },
    { to: '/attendance', label: 'Sync & Attendance', icon: CloudUpload },
    { to: '/notifications', label: 'Actionable Alerts', icon: Bell },
    { to: '/profile', label: 'Contest Participation Timeline', icon: TrendingUp },
    { to: '/analytics', label: 'Performance Analytics', icon: BarChart3 },
    { to: '/reports', label: 'Reports & Summary', icon: FileText },
    { to: '/archive', label: 'Graduation Archive', icon: Archive },
    { to: '/departments', label: 'Department Manager', icon: Building2 },
  ];

  if (user?.role === 'Super Admin') {
    links.push({ to: '/admin/data-health', label: 'Data Diagnostics', icon: ShieldCheck });
  }

  const activeClass = "flex items-center px-4 py-3 text-sm font-semibold text-white bg-primary-600 rounded-xl transition-all shadow-md shadow-primary-600/20";
  const inactiveClass = "flex items-center px-4 py-3 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all";

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar Panel */}
      <aside 
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:static lg:h-screen`}
      >
        {/* Header Logo */}
        <div className="flex h-16 items-center px-6 border-b border-slate-100 dark:border-slate-800">
          <NavLink to="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white shadow-md shadow-primary-600/30">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <span className="font-bold text-slate-800 dark:text-white tracking-wide">EnthraHub</span>
              <span className="text-xs block text-slate-400 font-semibold uppercase tracking-wider -mt-1">Participation & Analytics</span>
            </div>
          </NavLink>
        </div>

        {/* Brand Banner Badge (Replacing User Profile Badge) */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-950/60 text-primary-600 dark:text-primary-400 font-bold">
              🎓
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">College Portal</h4>
              <p className="text-[10px] text-slate-400 font-semibold">Coordination Center</p>
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-1.5 px-4 py-6 overflow-y-auto">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink 
                key={link.to} 
                to={link.to} 
                className={({ isActive }) => isActive ? activeClass : inactiveClass}
                onClick={() => {
                  if (window.innerWidth < 1024) toggleSidebar();
                }}
              >
                <Icon className="mr-3 h-5 w-5 shrink-0" />
                {link.label}
              </NavLink>
            );
          })}
        </nav>

        {/* General Portal Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 text-[10px] text-center text-slate-400 font-medium">
          EnthraHub Portal v3.0
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
