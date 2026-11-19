import { createBrowserRouter } from 'react-router-dom'
import { AccountPage } from '@/features/account/account-page'
import { ApprovalsPage } from '@/features/admin/approvals-page'
import { AttendancePage } from '@/features/admin/attendance-page'
import { AuditPage } from '@/features/admin/audit-page'
import { CorrectionsPage } from '@/features/admin/corrections-page'
import { AdminDashboardPage } from '@/features/admin/dashboard-page'
import { EmployeesPage } from '@/features/admin/employees-page'
import { SchedulesPage } from '@/features/admin/schedules-page'
import { DtrPage } from '@/features/attendance/dtr-page'
import { RequireApproved } from '@/features/auth/require-approved'
import { RequireAuth } from '@/features/auth/require-auth'
import { LoginPage } from '@/features/auth/login-page'
import { RegisterPage } from '@/features/auth/register-page'
import { MyCorrectionsPage } from '@/features/corrections/my-corrections-page'
import { MySchedulePage } from '@/features/schedule/my-schedule-page'
import { WorkspacePage } from '@/features/dashboard/workspace-page'
import { DesignSystemPage } from '@/features/design/design-system-page'
import { NotFoundPage } from '@/features/errors/not-found-page'
import { OnboardingPage } from '@/features/onboarding/onboarding-page'
import { PendingApprovalPage } from '@/features/onboarding/pending-approval-page'
import { SetupPage } from '@/features/setup/setup-page'
import { env } from '@/lib/env'
import { FeatureRoutes, ProtectedLayout } from './protected-layout'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/setup', element: <SetupPage /> },
  ...(env.isDev ? [{ path: '/design', element: <DesignSystemPage /> }] : []),
  {
    element: <RequireAuth />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/pending-approval', element: <PendingApprovalPage /> },
      {
        element: <RequireApproved />,
        children: [
          {
            element: <ProtectedLayout />,
            children: [
              {
                element: <FeatureRoutes />,
                children: [
                  { index: true, element: <WorkspacePage /> },
                  { path: 'account', element: <AccountPage /> },
                  { path: 'dtr', element: <DtrPage /> },
                  { path: 'my-schedule', element: <MySchedulePage /> },
                  { path: 'corrections', element: <MyCorrectionsPage /> },
                  {
                    path: 'admin/dashboard',
                    element: <RequireAuth roles={['admin', 'supervisor']} />,
                    children: [{ index: true, element: <AdminDashboardPage /> }],
                  },
                  {
                    path: 'admin/attendance',
                    element: <RequireAuth roles={['admin', 'supervisor']} />,
                    children: [{ index: true, element: <AttendancePage /> }],
                  },
                  {
                    path: 'admin/corrections',
                    element: <RequireAuth roles={['admin', 'supervisor']} />,
                    children: [{ index: true, element: <CorrectionsPage /> }],
                  },
                  {
                    path: 'admin/dtr',
                    element: <RequireAuth roles={['admin', 'supervisor']} />,
                    children: [{ index: true, element: <DtrPage adminMode /> }],
                  },
                  {
                    path: 'admin/employees',
                    element: <RequireAuth roles={['admin']} />,
                    children: [{ index: true, element: <EmployeesPage /> }],
                  },
                  {
                    path: 'admin/audit',
                    element: <RequireAuth roles={['admin']} />,
                    children: [{ index: true, element: <AuditPage /> }],
                  },
                  {
                    path: 'admin/approvals',
                    element: <RequireAuth roles={['admin']} />,
                    children: [{ index: true, element: <ApprovalsPage /> }],
                  },
                  {
                    path: 'admin/schedules',
                    element: <RequireAuth roles={['admin']} />,
                    children: [{ index: true, element: <SchedulesPage /> }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])
