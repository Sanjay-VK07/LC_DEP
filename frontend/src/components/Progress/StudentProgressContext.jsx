import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api';
import { useAuth } from '../../context/AuthContext';

const StudentProgressContext = createContext(null);

export function StudentProgressProvider({ children }) {
  const { user } = useAuth();
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // If the logged in user is a student, automatically select their own student record
    if (user?.role === 'student' && user?.studentId) {
      const studentObj = { id: user.studentId, name: user.name, role: 'student' };
      setSelectedStudent(studentObj);
      setLoading(false);
      return;
    }

    // For faculty/admin, fetch the list of active students
    const fetchStudents = async () => {
      try {
        const res = await axios.get(`${API_URL}/students?status=active`);
        if (res.data.success) {
          const activeStudents = res.data.data || [];
          setStudents(activeStudents);
          if (activeStudents.length > 0) {
            setSelectedStudent(activeStudents[0]);
          }
        } else {
          setError('Failed to fetch students list');
        }
      } catch (err) {
        setError('Error fetching students list');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchStudents();
  }, [user]);

  const [refreshVersion, setRefreshVersion] = useState(0);
  
  const triggerGlobalRefresh = React.useCallback(() => {
    setRefreshVersion(v => v + 1);
  }, []);

  const value = {
    selectedStudent,
    setSelectedStudent,
    students,
    currentRole: user?.role || null,
    isStudent: user?.role === 'student',
    loading,
    error,
    refreshVersion,
    triggerGlobalRefresh
  };

  return (
    <StudentProgressContext.Provider value={value}>
      {children}
    </StudentProgressContext.Provider>
  );
}

export function useStudentProgress() {
  const context = useContext(StudentProgressContext);
  if (!context) {
    throw new Error('useStudentProgress must be used within a StudentProgressProvider');
  }
  return context;
}
