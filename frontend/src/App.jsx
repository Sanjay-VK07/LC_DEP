import React, { useState, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';

// Lazy Loaded Pages for Code Splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Students = lazy(() => import('./pages/Students'));
const Contests = lazy(() => import('./pages/Contests'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Archive = lazy(() => import('./pages/Archive'));
const Profile = lazy(() => import('./pages/Profile'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Departments = lazy(() => import('./pages/Departments'));
const Login = lazy(() => import('./pages/Login'));
const Notifications = lazy(() => import('./pages/Notifications'));
const LiveMonitor = lazy(() => import('./pages/LiveMonitor'));
const PlacementDashboard = lazy(() => import('./pages/PlacementDashboard'));
const AiInsights = lazy(() => import('./pages/AiInsights'));
const DataHealth = lazy(() => import('./pages/DataHealth'));

const PageFallback = () => (
  <div className="flex h-64 w-full items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
  </div>
);

function LayoutWrapper() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, loading } = useAuth();

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-900">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Login />
      </Suspense>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Sidebar Navigation */}
      <Sidebar isOpen={sidebarOpen} toggleSidebar={toggleSidebar} />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Navbar Header */}
        <Navbar toggleSidebar={toggleSidebar} />

        {/* Dynamic Page Views */}
        <main className="flex-1 overflow-y-auto p-6 focus:outline-none">
          <div className="mx-auto max-w-7xl">
            <Suspense fallback={<PageFallback />}>
              <Routes>
                {/* Direct Open Portal Routes */}
                <Route path="/" element={<Dashboard />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/students" element={<Students />} />
                <Route path="/contests" element={<Contests />} />
                <Route path="/attendance" element={<Attendance />} />
                <Route path="/live-monitor" element={<LiveMonitor />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/archive" element={<Archive />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/departments" element={<Departments />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/placement" element={<PlacementDashboard />} />
                <Route path="/ai-insights" element={<AiInsights />} />
                <Route path="/admin/data-health" element={user.role === 'Super Admin' ? <DataHealth /> : <Navigate to="/" replace />} />

                {/* Fallback routing */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <ThemeProvider>
          <Routes>
            {/* Layout Wrapper contains all routes directly */}
            <Route path="/*" element={<LayoutWrapper />} />
          </Routes>
        </ThemeProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
