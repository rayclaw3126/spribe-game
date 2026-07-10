import { Navigate, Route, Routes } from 'react-router-dom'
import { ToastProvider } from './state/ToastContext.jsx'
import VendorLayout from './pages/VendorLayout.jsx'
import SystemIssuesPage from './pages/SystemIssuesPage.jsx'
import PlaceholderPage from './pages/PlaceholderPage.jsx'

// 本单纯 UI，无登录守卫（接 boss 后端时再补 RequireAuth，参照 admin/App.jsx）。
export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<VendorLayout />}>
          <Route index element={<SystemIssuesPage />} />
          <Route path="dashboard" element={<PlaceholderPage title="全平台看板" />} />
          <Route path="merchants" element={<PlaceholderPage title="商家列表" />} />
          <Route path="merchants/new" element={<PlaceholderPage title="开商家" />} />
          <Route path="skins" element={<PlaceholderPage title="换肤配置台" />} />
          <Route path="fees" element={<PlaceholderPage title="平台费流水" />} />
          <Route path="risk" element={<PlaceholderPage title="跨商家风控" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  )
}
