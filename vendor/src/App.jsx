import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './state/AuthContext.jsx'
import { ToastProvider } from './state/ToastContext.jsx'
import LoginPage from './pages/LoginPage.jsx'
import VendorLayout from './pages/VendorLayout.jsx'
import SystemIssuesPage from './pages/SystemIssuesPage.jsx'
import MerchantsPage from './pages/MerchantsPage.jsx'
import MerchantCreatePage from './pages/MerchantCreatePage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import FeesPage from './pages/FeesPage.jsx'
import PlaceholderPage from './pages/PlaceholderPage.jsx'

// 路由守卫：未登录一律打回 /login（照抄 admin/App.jsx）。
function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <VendorLayout />
              </RequireAuth>
            }
          >
            <Route index element={<SystemIssuesPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="merchants" element={<MerchantsPage />} />
            <Route path="merchants/new" element={<MerchantCreatePage />} />
            <Route path="merchants/:id/edit" element={<MerchantCreatePage />} />
            <Route path="skins" element={<PlaceholderPage title="换肤配置台" />} />
            <Route path="fees" element={<FeesPage />} />
            <Route path="risk" element={<PlaceholderPage title="跨商家风控" />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  )
}
