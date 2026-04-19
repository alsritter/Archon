import { NavLink, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, MessageSquare, Workflow, Settings } from 'lucide-react';
import { listDashboardRuns, getUpdateCheck } from '@/lib/api';
import { cn } from '@/lib/utils';

const tabs = [
  { to: '/chat', end: false, icon: MessageSquare, label: 'Chat', mobileVisible: false },
  {
    to: '/dashboard',
    end: true,
    icon: LayoutDashboard,
    label: 'Dashboard',
    mobileVisible: true,
  },
  {
    to: '/workflows',
    end: false,
    icon: Workflow,
    label: 'Workflows',
    mobileVisible: true,
  },
  { to: '/settings', end: false, icon: Settings, label: 'Settings', mobileVisible: false },
] as const;

export function TopNav(): React.ReactElement {
  // We only need `counts.running` — a server-side aggregate independent of
  // the `runs` array. `limit: 1` minimises the `runs` payload that the API
  // returns alongside the counts (we discard it).
  const { data: dashboardRuns } = useQuery({
    queryKey: ['dashboardRuns', { status: 'running', forCount: true }],
    queryFn: () => listDashboardRuns({ status: 'running', limit: 1 }),
    refetchInterval: 10_000,
  });
  const runningCount = dashboardRuns?.counts.running ?? 0;

  const { data: updateCheck } = useQuery({
    queryKey: ['update-check'],
    queryFn: getUpdateCheck,
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    retry: false,
  });

  return (
    <nav className="overflow-x-auto border-b border-border bg-surface">
      <div className="flex min-w-max items-center gap-1 px-2 sm:px-4">
        {/* Brand logo */}
        <Link
          to="/chat"
          className="mr-1 flex items-center gap-2 py-2 pr-2 hover:opacity-80 transition-opacity sm:mr-4"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <span className="text-sm font-semibold text-primary-foreground">A</span>
          </div>
          <span className="hidden text-sm font-semibold text-text-primary sm:inline">Archon</span>
        </Link>

        {tabs.map(({ to, end, icon: Icon, label, mobileVisible }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }: { isActive: boolean }): string =>
              cn(
                'flex shrink-0 items-center gap-1.5 border-b-2 px-2 py-3 text-sm font-medium transition-colors sm:gap-2 sm:px-3',
                !mobileVisible && 'hidden sm:flex',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
            {to === '/dashboard' && runningCount > 0 && (
              <span
                className="ml-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-primary px-1 py-0.5 text-[10px] font-medium text-primary-foreground sm:ml-1 sm:min-w-[1.25rem] sm:px-1.5"
                aria-label={`${runningCount} workflows running`}
              >
                {runningCount}
              </span>
            )}
          </NavLink>
        ))}
        <span className="ml-auto hidden shrink-0 text-xs text-text-secondary sm:inline">
          v{import.meta.env.VITE_APP_VERSION as string}
          {updateCheck?.updateAvailable && updateCheck.releaseUrl && (
            <a
              href={updateCheck.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              title={`v${updateCheck.latestVersion} available`}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />v
              {updateCheck.latestVersion}
            </a>
          )}
        </span>
      </div>
    </nav>
  );
}
